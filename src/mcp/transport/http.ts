import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  logInfo,
  logError,
  logDebug,
  logTrace,
  logDebugData,
} from "../../utils/index.js";

export class HttpTransport {
  private httpServer: http.Server | undefined;
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private readonly mcpServer: McpServer,
    private readonly host: string,
    private readonly port: number
  ) {
    logDebug(`[HttpTransport] created — ${host}:${port}`);
  }

  async start(): Promise<void> {
    logDebug("[HttpTransport] starting HTTP server");
    this.httpServer = http.createServer(async (req, res) => {
      // Note: `mcp-session-id` is untrusted input. Sanitize/mask before logging.
      const sessionIdForLog = maskSessionId(
        sanitizeSessionId(req.headers["mcp-session-id"] as string | undefined)
      );
      // Prefer structured logs to avoid string patterns that static analyzers may
      // misinterpret as SQL string construction (e.g. "DELETE ... ${input}").
      logDebugData("[HttpTransport] request", {
        method: req.method,
        url: req.url,
        session: sessionIdForLog,
      });

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
        logDebugData("[HttpTransport] 404 — unknown path", { url: req.url });
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
        this.httpServer?.close(() => {
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
    // Treat `mcp-session-id` as untrusted input. Validate + sanitize before use.
    const rawSessionId = req.headers["mcp-session-id"] as string | undefined;
    const sessionId = sanitizeSessionId(rawSessionId);
    const sessionIdForLog = maskSessionId(sessionId);

    if (req.method === "GET") {
      await this.handleGetRequest(sessionId, sessionIdForLog, req, res);
      return;
    }

    if (req.method === "DELETE") {
      await this.handleDeleteRequest(sessionId, sessionIdForLog, req, res);
      return;
    }

    if (req.method === "POST") {
      await this.handlePostRequest(sessionId, req, res);
      return;
    }

    logDebugData("[HttpTransport] 405 — unsupported method", {
      method: req.method,
    });
    res.writeHead(405);
    res.end("Method not allowed");
  }

  private async handleGetRequest(
    sessionId: string | undefined,
    sessionIdForLog: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // SSE stream for notifications
    logDebugData("[HttpTransport] GET SSE stream", {
      session: sessionIdForLog,
    });
    const transport = sessionId ? this.transports.get(sessionId) : undefined;
    if (transport) {
      await transport.handleRequest(req, res);
    } else {
      logDebugData("[HttpTransport] GET rejected — invalid session", {
        session: sessionIdForLog,
      });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    }
  }

  private async handleDeleteRequest(
    sessionId: string | undefined,
    sessionIdForLog: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Session cleanup
    // Avoid "DELETE ... ${userInput}" style strings (can be misdetected as SQL injection);
    // log structured data and only after sanitizing/masking.
    logDebugData("[HttpTransport] session cleanup", {
      method: "DELETE",
      session: sessionIdForLog,
    });
    const transport = sessionId ? this.transports.get(sessionId) : undefined;
    if (transport) {
      await transport.handleRequest(req, res);
      this.transports.delete(sessionId!);
      logDebugData("[HttpTransport] session closed", {
        session: sessionIdForLog,
        remaining: this.transports.size,
      });
    } else {
      logDebugData("[HttpTransport] DELETE rejected", {
        reason: "invalid session",
        session: sessionIdForLog,
      });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    }
  }

  private async handlePostRequest(
    sessionId: string | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await readBody(req);
    logTrace(`[HttpTransport] POST body (${body.length} bytes)`);
    const parsed = JSON.parse(body);

    let transport = sessionId ? this.transports.get(sessionId) : undefined;

    if (!transport && this.isInitializeRequest(parsed)) {
      transport = await this.createNewSession();
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
  }

  private async createNewSession(): Promise<StreamableHTTPServerTransport> {
    logDebug("[HttpTransport] initialize request detected — creating new session");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport);
        logDebug(`[HttpTransport] new MCP session initialized: ${id} — ${this.transports.size} total`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        this.transports.delete(transport.sessionId);
        logDebug(`[HttpTransport] session transport closed: ${transport.sessionId}`);
      }
    };

    await this.mcpServer.connect(transport);
    return transport;
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

/**
 * Session IDs are generated by `randomUUID()` in this transport. Accept only UUIDs.
 * Returning undefined causes the request to be treated as "no session".
 */
function sanitizeSessionId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Accept a canonical UUID (case-insensitive).
  const uuidV4Like =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidV4Like.test(value) ? value : undefined;
}

function maskSessionId(value: string | undefined): string {
  if (!value) return "none";
  // Keep a short prefix/suffix for correlation without exposing full identifier.
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => { resolve(Buffer.concat(chunks).toString()); });    req.on("error", reject);
  });
}
