import * as vscode from "vscode";
import { ConfigurationManager } from "./config/index.js";
import { DiagnosticStore, DiagnosticCollector } from "./diagnostics/index.js";
import { ProblemsMcpServer } from "./mcp/index.js";
import { StatusBarManager, registerCommands } from "./ui/index.js";
import {
  initLogger,
  setLogLevel,
  logInfo,
  logError,
  logDebug,
  logDebugData,
} from "./utils/index.js";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const configManager = new ConfigurationManager();
  let currentConfig = configManager.get();

  initLogger(currentConfig.logLevel);

  // Auto-enable debug logging in Extension Development Host
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    setLogLevel("debug");
    logInfo(
      "Debug logging auto-enabled (Extension Development Host detected)"
    );
  }

  logInfo("Problems Pipe extension activating");
  logDebugData("[Extension] loaded config", currentConfig);

  // Core components
  logDebug("[Extension] creating DiagnosticStore");
  const store = new DiagnosticStore(currentConfig);

  logDebug("[Extension] creating DiagnosticCollector");
  const collector = new DiagnosticCollector(store);

  logDebug("[Extension] creating ProblemsMcpServer");
  const server = new ProblemsMcpServer(store, currentConfig);

  // UI
  logDebug("[Extension] creating StatusBarManager");
  const statusBar = new StatusBarManager(server, store);

  logDebug("[Extension] registering commands");
  registerCommands(context, server, store, statusBar, () => currentConfig);

  const safeStart = async (reason: string): Promise<void> => {
    logDebug(`[Extension] safeStart called — reason: ${reason}`);
    try {
      await server.start();
      statusBar.update();
    } catch (err) {
      logError(`${reason} failed`, err);
    }
  };

  // React to config changes
  logDebug("[Extension] registering config change listener");
  const configListener = configManager.onDidChange((newConfig) => {
    const previousConfig = currentConfig;
    currentConfig = newConfig;
    logDebug("[Extension] config changed");
    logDebugData("[Extension] new config", newConfig);

    setLogLevel(newConfig.logLevel);
    // Re-override to debug if in development mode
    if (context.extensionMode === vscode.ExtensionMode.Development) {
      setLogLevel("debug");
    }

    store.updateConfig(newConfig);
    server.updateConfig(newConfig);

    if (!newConfig.enabled) {
      logDebug("[Extension] extension disabled via config");
      if (server.isRunning) {
        server.stop().catch((err) => { logError("Failed to stop server", err); });
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
      logDebug(
        `[Extension] transport settings changed (${previousConfig.httpHost}:${previousConfig.httpPort} -> ${newConfig.httpHost}:${newConfig.httpPort}), restarting server`
      );
      server.restart().catch((err) => { logError("Failed to restart server", err); });
    } else if (!server.isRunning && newConfig.autoStart) {
      logDebug("[Extension] server not running and autoStart enabled, starting");
      void safeStart("Auto-start");
    }

    statusBar.update();
  });

  // Register disposables
  context.subscriptions.push(
    configManager,
    { dispose: () => { store.dispose(); } },
    collector,
    server,
    statusBar,
    configListener
  );

  // Auto-start if configured
  if (!currentConfig.enabled) {
    logInfo("Problems Pipe is disabled via settings");
  } else if (currentConfig.autoStart) {
    logDebug("[Extension] autoStart enabled, starting server");
    await safeStart("Auto-start");
    if (!server.isRunning) {
      vscode.window.showWarningMessage(
        "Problems Pipe: Failed to auto-start MCP server. Use the command palette to start manually."
      );
    }
  } else {
    logDebug("[Extension] autoStart disabled, waiting for manual start");
  }

  logInfo("Problems Pipe extension activated");
  logDebug(`[Extension] extension mode: ${vscode.ExtensionMode[context.extensionMode]}`);
}

export function deactivate(): void {
  logDebug("[Extension] deactivating");
  // Cleanup handled by disposables
}
