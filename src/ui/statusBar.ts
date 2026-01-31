import * as vscode from "vscode";
import type { ProblemsMcpServer } from "../mcp/index.js";
import type { DiagnosticStore } from "../diagnostics/index.js";
import { logTrace } from "../utils/index.js";

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private server: ProblemsMcpServer,
    private store: DiagnosticStore
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "problemsPipe.showStatus";
    this.update();

    this.disposables.push(
      this.store.onDidChange(() => this.update())
    );

    this.item.show();
  }

  update(): void {
    const counts = this.store.getCounts();
    const running = this.server.isRunning;
    logTrace(`[StatusBar] update — running: ${running}, errors: ${counts.errors}, warnings: ${counts.warnings}, info: ${counts.info}, hints: ${counts.hints}`);

    if (!running) {
      this.item.text = "$(circle-slash) Problems Pipe: Off";
      this.item.tooltip = "Problems Pipe MCP server is stopped. Click to view status.";
      this.item.backgroundColor = undefined;
      return;
    }

    const parts: string[] = [];
    if (counts.errors > 0) parts.push(`$(error) ${counts.errors}`);
    if (counts.warnings > 0) parts.push(`$(warning) ${counts.warnings}`);

    if (parts.length === 0) {
      const infoHints = counts.info + counts.hints;
      if (infoHints === 0) {
        this.item.text = "$(check) Problems Pipe";
        this.item.tooltip = "Problems Pipe: No problems detected";
      } else {
        this.item.text = `$(info) ${infoHints}`;
        this.item.tooltip = `Problems Pipe: ${counts.info} info, ${counts.hints} hints (${this.server.sessionCount} client(s))`;
      }
    } else {
      this.item.text = `$(plug) ${parts.join(" ")}`;
      this.item.tooltip = `Problems Pipe: ${counts.errors} errors, ${counts.warnings} warnings (${this.server.sessionCount} client(s))`;
    }

    this.item.backgroundColor =
      counts.errors > 0
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined;
  }

  dispose(): void {
    this.item.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
