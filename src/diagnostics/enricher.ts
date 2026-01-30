import * as vscode from "vscode";
import type { ContextLines } from "../types/index.js";
import { LRUCache } from "../utils/index.js";

export class ContextEnricher {
  private fileCache = new LRUCache<string[]>(100);

  async getContextLines(
    uri: vscode.Uri,
    line: number,
    count: number
  ): Promise<ContextLines | undefined> {
    if (count <= 0) return undefined;

    const lines = await this.getFileLines(uri);
    if (!lines || line < 0 || line >= lines.length) return undefined;

    const start = Math.max(0, line - count);
    const end = Math.min(lines.length - 1, line + count);

    return {
      before: lines.slice(start, line),
      line: lines[line],
      after: lines.slice(line + 1, end + 1),
    };
  }

  invalidate(uri: string): void {
    this.fileCache.delete(uri);
  }

  clear(): void {
    this.fileCache.clear();
  }

  private async getFileLines(uri: vscode.Uri): Promise<string[] | undefined> {
    const key = uri.toString();
    const cached = this.fileCache.get(key);
    if (cached) return cached;

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const lines = doc.getText().split("\n");
      this.fileCache.set(key, lines);
      return lines;
    } catch {
      return undefined;
    }
  }
}
