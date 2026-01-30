import * as vscode from "vscode";

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

export class ConfigurationManager implements vscode.Disposable {
  private config: ExtensionConfig;
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<ExtensionConfig>();

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.config = loadConfig();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
          this.config = loadConfig();
          this.changeEmitter.fire(this.config);
        }
      })
    );
  }

  get(): ExtensionConfig {
    return this.config;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
  }
}
