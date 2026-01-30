import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../diagnostics/index.js";
import type { ExtensionConfig } from "../config/index.js";
import { HttpTransport } from "./transport/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { logInfo, logError, logDebug } from "../utils/index.js";

export class ProblemsMcpServer implements vscode.Disposable {
  private mcpServer: McpServer;
  private transport: HttpTransport | undefined;
  private changeListener: vscode.Disposable | undefined;
  private running = false;
  private codeActionsTool: RegisteredTool;

  constructor(
    private store: DiagnosticStore,
    private config: ExtensionConfig
  ) {
    this.mcpServer = new McpServer(
      { name: "problems-pipe", version: "0.1.0" },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
          logging: {},
        },
      }
    );

    const tools = registerAllTools(this.mcpServer, this.store);
    registerAllResources(this.mcpServer, this.store);
    registerAllPrompts(this.mcpServer, this.store);

    this.codeActionsTool = tools.codeActionsTool;
    if (!this.config.enableCodeActions) {
      this.codeActionsTool.disable();
    }
  }

  updateConfig(config: ExtensionConfig): void {
    this.config = config;
    if (this.config.enableCodeActions) {
      if (!this.codeActionsTool.enabled) {
        this.codeActionsTool.enable();
      }
    } else if (this.codeActionsTool.enabled) {
      this.codeActionsTool.disable();
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      logInfo("MCP server is already running");
      return;
    }

    try {
      this.transport = new HttpTransport(
        this.mcpServer,
        this.config.httpHost,
        this.config.httpPort
      );
      await this.transport.start();
      this.running = true;

      // Notify clients when diagnostics change
      this.changeListener = this.store.onDidChange(() => {
        this.mcpServer.sendResourceListChanged();
      });

      logInfo("Problems Pipe MCP server started");
    } catch (err) {
      this.running = false;
      logError("Failed to start MCP server", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.changeListener?.dispose();
    this.changeListener = undefined;

    if (this.transport) {
      await this.transport.stop();
      this.transport = undefined;
    }

    this.running = false;
    logInfo("Problems Pipe MCP server stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get url(): string | undefined {
    return this.transport?.url;
  }

  get sessionCount(): number {
    return this.transport?.sessionCount ?? 0;
  }

  getClientConfig(): object {
    const clientHost =
      this.config.httpHost === "0.0.0.0" ? "127.0.0.1" : this.config.httpHost;
    return {
      mcpServers: {
        "problems-pipe": {
          url: `http://${clientHost}:${this.config.httpPort}/mcp`,
        },
      },
    };
  }

  dispose(): void {
    this.stop().catch((err) => logError("Error during shutdown", err));
  }
}
