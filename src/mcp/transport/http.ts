import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logInfo, logError, logDebug, logTrace } from "../../utils/index.js";

export class HttpTransport {
  private httpServer: http.Server | undefined;
  private transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private mcpServer: McpServer,
    private host: string,
    private port: number
  ) {
    logDebug(`[HttpTransport] created — ${host}:${port}`);
  }

  async start(): Promise<void> {
    logDebug("[HttpTransport] starting HTTP server");
    this.httpServer = http.createServer(async (req, res) => {
      logTrace(`[HttpTransport] ${req.method} ${req.url} — session: ${req.headers["mcp-session-id"] ?? "none"}`);

      // CORS headers for local clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id, Last-Event-ID"
      );
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        logTrace("[HttpTransport] CORS preflight response");
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/health") {
        logDebug(`[HttpTransport] health check — ${this.transports.size} active session(s)`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            sessions: this.transports.size,
          })
        );
        return;
      }

      if (req.url !== "/mcp") {
        logDebug(`[HttpTransport] 404 — unknown path: ${req.url}`);
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        await this.handleMcpRequest(req, res);
      } catch (err) {
        logError("Error handling MCP request", err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal server error");
        }
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logError(`Port ${this.port} is already in use`);
        }
        reject(err);
      });

      this.httpServer!.listen(this.port, this.host, () => {
        logInfo(`MCP HTTP server listening on http://${this.host}:${this.port}/mcp`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    logDebug(`[HttpTransport] stopping — closing ${this.transports.size} session(s)`);
    // Close all transports
    for (const [id, transport] of this.transports) {
      try {
        await transport.close();
        logDebug(`[HttpTransport] closed session ${id}`);
      } catch {
        // ignore close errors
      }
    }
    this.transports.clear();

    // Close HTTP server
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.httpServer = undefined;
          logInfo("MCP HTTP server stopped");
          resolve();
        });
      });
    }
  }

  get isRunning(): boolean {
    return this.httpServer?.listening === true;
  }

  get url(): string {
    return `http://${this.host}:${this.port}/mcp`;
  }

  get sessionCount(): number {
    return this.transports.size;
  }

  private async handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "GET") {
      // SSE stream for notifications
      logDebug(`[HttpTransport] GET SSE stream — session: ${sessionId ?? "none"}`);
      const transport = sessionId ? this.transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
      } else {
        logDebug(`[HttpTransport] GET rejected — invalid session: ${sessionId}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
      }
      return;
    }

    if (req.method === "DELETE") {
      // Session cleanup
      logDebug(`[HttpTransport] DELETE session cleanup — session: ${sessionId ?? "none"}`);
      const transport = sessionId ? this.transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
        this.transports.delete(sessionId!);
        logDebug(`[HttpTransport] session ${sessionId} closed — ${this.transports.size} remaining`);
      } else {
        logDebug(`[HttpTransport] DELETE rejected — invalid session: ${sessionId}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
      }
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      logTrace(`[HttpTransport] POST body (${body.length} bytes)`);
      const parsed = JSON.parse(body);

      let transport = sessionId ? this.transports.get(sessionId) : undefined;

      if (!transport && this.isInitializeRequest(parsed)) {
        logDebug("[HttpTransport] initialize request detected — creating new session");
        // New session
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            this.transports.set(id, transport!);
            logDebug(`[HttpTransport] new MCP session initialized: ${id} — ${this.transports.size} total`);
          },
        });

        transport.onclose = () => {
          if (transport!.sessionId) {
            this.transports.delete(transport!.sessionId);
            logDebug(`[HttpTransport] session transport closed: ${transport!.sessionId}`);
          }
        };

        await this.mcpServer.connect(transport);
      }

      if (transport) {
        await transport.handleRequest(req, res, parsed);
      } else {
        logDebug("[HttpTransport] POST rejected — no valid session and not an initialize request");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Bad request: no valid session. Send an initialize request first.",
            },
            id: null,
          })
        );
      }
      return;
    }

    logDebug(`[HttpTransport] 405 — unsupported method: ${req.method}`);
    res.writeHead(405);
    res.end("Method not allowed");
  }

  private isInitializeRequest(body: unknown): boolean {
    if (Array.isArray(body)) {
      return body.some(
        (msg) =>
          typeof msg === "object" &&
          msg !== null &&
          "method" in msg &&
          msg.method === "initialize"
      );
    }
    return (
      typeof body === "object" &&
      body !== null &&
      "method" in body &&
      (body as { method: string }).method === "initialize"
    );
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
