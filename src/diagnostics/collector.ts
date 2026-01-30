import * as vscode from "vscode";
import { DiagnosticStore } from "./store.js";
import { debounce, logInfo } from "../utils/index.js";

export class DiagnosticCollector implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private debouncedHandler: ReturnType<typeof debounce>;
  private pendingUris = new Map<string, vscode.Uri>();

  constructor(private store: DiagnosticStore) {
    this.debouncedHandler = debounce(() => {
      if (this.pendingUris.size === 0) return;
      const uris = [...this.pendingUris.values()];
      this.pendingUris.clear();
      this.store.handleDiagnosticChange({ uris });
    }, 100);

    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
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
    for (const [uri, diagnostics] of all) {
      if (diagnostics.length > 0) {
        this.store.handleDiagnosticChange({ uris: [uri] });
        count += diagnostics.length;
      }
    }
    logInfo(`Loaded ${count} initial diagnostics`);
  }

  dispose(): void {
    this.debouncedHandler.cancel();
    this.disposables.forEach((d) => d.dispose());
  }
}
