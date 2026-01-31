import * as vscode from "vscode";
import type { ProblemsMcpServer } from "../mcp/index.js";
import type { DiagnosticStore } from "../diagnostics/index.js";
import type { StatusBarManager } from "./statusBar.js";
import type { ExtensionConfig } from "../config/index.js";
import { logInfo, logError, logDebug } from "../utils/index.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  server: ProblemsMcpServer,
  store: DiagnosticStore,
  statusBar: StatusBarManager,
  getConfig: () => ExtensionConfig
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("problemsPipe.start", async () => {
      logDebug("[Command:start] invoked");
      if (!getConfig().enabled) {
        logDebug("[Command:start] extension is disabled, aborting");
        vscode.window.showWarningMessage(
          "Problems Pipe is disabled in settings. Enable it to start the server."
        );
        return;
      }
      try {
        await server.start();
        statusBar.update();
        logDebug(`[Command:start] server started at ${server.url}`);
        vscode.window.showInformationMessage(
          `Problems Pipe MCP server started at ${server.url}`
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        vscode.window.showErrorMessage(
          `Failed to start Problems Pipe: ${msg}`
        );
      }
    }),

    vscode.commands.registerCommand("problemsPipe.stop", async () => {
      logDebug("[Command:stop] invoked");
      await server.stop();
      statusBar.update();
      vscode.window.showInformationMessage("Problems Pipe MCP server stopped");
    }),

    vscode.commands.registerCommand("problemsPipe.showStatus", async () => {
      logDebug("[Command:showStatus] invoked");
      const counts = store.getCounts();
      const total = counts.errors + counts.warnings + counts.info + counts.hints;

      const lines = [
        `**Problems Pipe Status**`,
        "",
        `Server: ${server.isRunning ? "Running" : "Stopped"}`,
      ];

      if (server.isRunning) {
        lines.push(`URL: ${server.url}`);
        lines.push(`Connected clients: ${server.sessionCount}`);
      }

      lines.push("");
      lines.push(`**Diagnostics:** ${total} total`);
      lines.push(`  Errors: ${counts.errors}`);
      lines.push(`  Warnings: ${counts.warnings}`);
      lines.push(`  Info: ${counts.info}`);
      lines.push(`  Hints: ${counts.hints}`);

      const action = server.isRunning
        ? await vscode.window.showInformationMessage(
            lines.join("\n"),
            { modal: true },
            "Stop Server",
            "Copy Config"
          )
        : await vscode.window.showInformationMessage(
            lines.join("\n"),
            { modal: true },
            "Start Server"
          );

      logDebug(`[Command:showStatus] user action: ${action ?? "dismissed"}`);
      if (action === "Start Server") {
        await vscode.commands.executeCommand("problemsPipe.start");
      } else if (action === "Stop Server") {
        await vscode.commands.executeCommand("problemsPipe.stop");
      } else if (action === "Copy Config") {
        await vscode.commands.executeCommand("problemsPipe.copyServerConfig");
      }
    }),

    vscode.commands.registerCommand("problemsPipe.copyServerConfig", async () => {
      logDebug("[Command:copyServerConfig] invoked");
      if (!server.isRunning) {
        vscode.window.showWarningMessage(
          "Start the MCP server first to copy its configuration"
        );
        return;
      }

      const config = JSON.stringify(server.getClientConfig(), null, 2);
      await vscode.env.clipboard.writeText(config);
      vscode.window.showInformationMessage(
        "MCP server configuration copied to clipboard"
      );
      logInfo("Server config copied to clipboard");
    })
  );
}
