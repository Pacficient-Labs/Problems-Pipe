import * as vscode from "vscode";
import type { ContextLines } from "../types/index.js";
import { LRUCache, logDebug, logTrace } from "../utils/index.js";

export class ContextEnricher {
  private readonly fileCache = new LRUCache<string[]>(100);

  async getContextLines(
    uri: vscode.Uri,
    line: number,
    count: number
  ): Promise<ContextLines | undefined> {
    if (count <= 0) return undefined;

    logTrace(`[Enricher] getContextLines — uri: ${uri.fsPath}, line: ${line}, count: ${count}`);
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
    logTrace(`[Enricher] cache invalidated — ${uri}`);
    this.fileCache.delete(uri);
  }

  clear(): void {
    logDebug("[Enricher] cache cleared");
    this.fileCache.clear();
  }

  private async getFileLines(uri: vscode.Uri): Promise<string[] | undefined> {
    const key = uri.toString();
    const cached = this.fileCache.get(key);
    if (cached) {
      logTrace(`[Enricher] cache hit — ${uri.fsPath}`);
      return cached;
    }

    logTrace(`[Enricher] cache miss — loading ${uri.fsPath}`);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const lines = doc.getText().split("\n");
      this.fileCache.set(key, lines);
      logTrace(`[Enricher] loaded ${lines.length} lines from ${uri.fsPath}`);
      return lines;
    } catch {
      logDebug(`[Enricher] failed to load file: ${uri.fsPath}`);
      return undefined;
    }
  }
}
