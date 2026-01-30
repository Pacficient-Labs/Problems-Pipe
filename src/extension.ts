import * as vscode from "vscode";
import { ConfigurationManager } from "./config/index.js";
import { DiagnosticStore, DiagnosticCollector } from "./diagnostics/index.js";
import { ProblemsMcpServer } from "./mcp/index.js";
import { StatusBarManager, registerCommands } from "./ui/index.js";
import { initLogger, setLogLevel, logInfo, logError } from "./utils/index.js";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const configManager = new ConfigurationManager();
  let currentConfig = configManager.get();

  initLogger(currentConfig.logLevel);
  logInfo("Problems Pipe extension activating");

  // Core components
  const store = new DiagnosticStore(currentConfig);
  const collector = new DiagnosticCollector(store);
  const server = new ProblemsMcpServer(store, currentConfig);

  // UI
  const statusBar = new StatusBarManager(server, store);
  registerCommands(context, server, store, statusBar, () => currentConfig);

  const safeStart = async (reason: string): Promise<void> => {
    try {
      await server.start();
      statusBar.update();
    } catch (err) {
      logError(`${reason} failed`, err);
    }
  };

  // React to config changes
  const configListener = configManager.onDidChange((newConfig) => {
    const previousConfig = currentConfig;
    currentConfig = newConfig;
    setLogLevel(newConfig.logLevel);
    store.updateConfig(newConfig);
    server.updateConfig(newConfig);

    if (!newConfig.enabled) {
      if (server.isRunning) {
        server.stop().catch((err) => logError("Failed to stop server", err));
      }
      statusBar.update();
      return;
    }

    // Restart server if transport settings changed
    if (
      server.isRunning &&
      (newConfig.httpPort !== previousConfig.httpPort ||
        newConfig.httpHost !== previousConfig.httpHost)
    ) {
      server.restart().catch((err) => logError("Failed to restart server", err));
    } else if (!server.isRunning && newConfig.autoStart) {
      safeStart("Auto-start");
    }

    statusBar.update();
  });

  // Register disposables
  context.subscriptions.push(
    configManager,
    { dispose: () => store.dispose() },
    collector,
    server,
    statusBar,
    configListener
  );

  // Auto-start if configured
  if (!currentConfig.enabled) {
    logInfo("Problems Pipe is disabled via settings");
  } else if (currentConfig.autoStart) {
    await safeStart("Auto-start");
    if (!server.isRunning) {
      vscode.window.showWarningMessage(
        "Problems Pipe: Failed to auto-start MCP server. Use the command palette to start manually."
      );
    }
  }

  logInfo("Problems Pipe extension activated");
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
