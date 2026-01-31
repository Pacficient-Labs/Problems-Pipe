import * as vscode from "vscode";
import { logDebug, logDebugData } from "../utils/index.js";

export interface ExtensionConfig {
  enabled: boolean;
  autoStart: boolean;
  transport: "http";
  httpPort: number;
  httpHost: string;
  includeSources: string[];
  excludeSources: string[];
  maxDiagnosticsPerFile: number;
  contextLines: number;
  enableCodeActions: boolean;
  logLevel: "off" | "error" | "warn" | "info" | "debug";
}

const SECTION = "problemsPipe";

function loadConfig(): ExtensionConfig {
  const ws = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: ws.get("enabled", true),
    autoStart: ws.get("autoStart", true),
    transport: ws.get("transport", "http") as "http",
    httpPort: ws.get("httpPort", 3030),
    httpHost: ws.get("httpHost", "127.0.0.1"),
    includeSources: ws.get("includeSources", []),
    excludeSources: ws.get("excludeSources", []),
    maxDiagnosticsPerFile: ws.get("maxDiagnosticsPerFile", 100),
    contextLines: ws.get("contextLines", 3),
    enableCodeActions: ws.get("enableCodeActions", true),
    logLevel: ws.get("logLevel", "info") as ExtensionConfig["logLevel"],
  };
}

function diffConfig(
  prev: ExtensionConfig,
  next: ExtensionConfig
): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(next) as (keyof ExtensionConfig)[]) {
    const oldVal = JSON.stringify(prev[key]);
    const newVal = JSON.stringify(next[key]);
    if (oldVal !== newVal) {
      changes.push(`${key}: ${oldVal} -> ${newVal}`);
    }
  }
  return changes;
}

export class ConfigurationManager implements vscode.Disposable {
  private config: ExtensionConfig;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionConfig>();

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.config = loadConfig();
    logDebug("[Config] initial config loaded");
    logDebugData("[Config] values", this.config);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
          const previous = this.config;
          this.config = loadConfig();
          const changes = diffConfig(previous, this.config);
          logDebug(
            `[Config] configuration changed — ${changes.length} field(s): ${changes.join("; ") || "none"}`
          );
          this.changeEmitter.fire(this.config);
        }
      })
    );
  }

  get(): ExtensionConfig {
    return this.config;
  }

  dispose(): void {
    logDebug("[Config] disposing ConfigurationManager");
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
  }
}
