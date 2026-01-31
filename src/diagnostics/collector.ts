import * as vscode from "vscode";
import { DiagnosticStore } from "./store.js";
import { debounce, logInfo, logDebug } from "../utils/index.js";

export class DiagnosticCollector implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debouncedHandler: ReturnType<typeof debounce>;
  private readonly pendingUris = new Map<string, vscode.Uri>();

  constructor(private readonly store: DiagnosticStore) {
    logDebug("[Collector] initializing DiagnosticCollector");

    this.debouncedHandler = debounce(() => {
      if (this.pendingUris.size === 0) return;
      const uris = [...this.pendingUris.values()];
      logDebug(
        `[Collector] debounce flush — ${uris.length} URI(s): ${uris.map((u) => u.fsPath).join(", ")}`
      );
      this.pendingUris.clear();
      this.store.handleDiagnosticChange({ uris });
    }, 100);

    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        logDebug(
          `[Collector] onDidChangeDiagnostics fired — ${event.uris.length} URI(s)`
        );
        for (const uri of event.uris) {
          this.pendingUris.set(uri.toString(), uri);
        }
        this.debouncedHandler();
      })
    );

    // Load initial diagnostics
    this.loadInitial();
  }

  private loadInitial(): void {
    const all = vscode.languages.getDiagnostics();
    let count = 0;
    let fileCount = 0;
    for (const [uri, diagnostics] of all) {
      if (diagnostics.length > 0) {
        this.store.handleDiagnosticChange({ uris: [uri] });
        count += diagnostics.length;
        fileCount++;
      }
    }
    logInfo(`Loaded ${count} initial diagnostics`);
    logDebug(`[Collector] initial load — ${count} diagnostics across ${fileCount} file(s)`);
  }

  dispose(): void {
    logDebug("[Collector] disposing DiagnosticCollector");
    this.debouncedHandler.cancel();
    this.disposables.forEach((d) => d.dispose());
  }
}
