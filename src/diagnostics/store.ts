import * as vscode from "vscode";
import type {
  EnrichedDiagnostic,
  DiagnosticQuery,
  DiagnosticSummary,
  SummaryGroupBy,
  Severity,
  DiagnosticTag,
} from "../types/index.js";
import { ContextEnricher } from "./enricher.js";
import type { ExtensionConfig } from "../config/index.js";
import { logDebug } from "../utils/index.js";

function globToRegex(glob: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // ** matches any number of path segments
      regex += ".*";
      i += 2;
      if (glob[i] === "/") i++; // skip trailing /
    } else if (c === "*") {
      regex += "[^/]*";
      i++;
    } else if (c === "?") {
      regex += "[^/]";
      i++;
    } else if (c === ".") {
      regex += String.raw`\.`;
      i++;
    } else if ("+^$()[]{}|\\".includes(c)) {
      regex += `\\${c}`;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp("^" + regex + "$");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

const SEVERITY_MAP: Record<vscode.DiagnosticSeverity, Severity> = {
  [vscode.DiagnosticSeverity.Error]: "error",
  [vscode.DiagnosticSeverity.Warning]: "warning",
  [vscode.DiagnosticSeverity.Information]: "information",
  [vscode.DiagnosticSeverity.Hint]: "hint",
};

const SEVERITY_PRIORITY: Record<Severity, number> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
};

function toTag(tag: vscode.DiagnosticTag): DiagnosticTag | undefined {
  if (tag === vscode.DiagnosticTag.Unnecessary) return "unnecessary";
  if (tag === vscode.DiagnosticTag.Deprecated) return "deprecated";
  return undefined;
}

function resolveCode(
  diagnostic: vscode.Diagnostic
): { code?: string | number; href?: string } {
  const raw = diagnostic.code;
  if (raw == null) return {};
  if (typeof raw === "string" || typeof raw === "number") return { code: raw };
  if (typeof raw === "object" && "value" in raw) {
    return {
      code: raw.value,
      href: raw.target?.toString(),
    };
  }
  return {};
}

function relativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    return vscode.workspace.asRelativePath(uri, multiRoot);
  }
  return uri.fsPath;
}

function workspaceFolderName(uri: vscode.Uri): string | undefined {
  return vscode.workspace.getWorkspaceFolder(uri)?.name;
}

let idCounter = 0;

function nextId(): string {
  return `diag_${Date.now()}_${idCounter++}`;
}

export class DiagnosticStore {
  private byUri = new Map<string, EnrichedDiagnostic[]>();
  private bySeverity = new Map<Severity, Set<string>>();
  private bySource = new Map<string, Set<string>>();
  private cachedSummaries = new Map<SummaryGroupBy, DiagnosticSummary>();
  private enricher = new ContextEnricher();
  private changeEmitter = new vscode.EventEmitter<string[]>();
  private disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor(private config: ExtensionConfig) {
    for (const sev of ["error", "warning", "information", "hint"] as Severity[]) {
      this.bySeverity.set(sev, new Set());
    }
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.enricher.invalidate(event.document.uri.toString());
      })
    );
  }

  updateConfig(config: ExtensionConfig): void {
    const previousUris = new Set(this.byUri.keys());
    this.config = config;
    this.resetIndexes();

    const changedUris = new Set<string>(previousUris);
    const all = vscode.languages.getDiagnostics();
    for (const [uri, diagnostics] of all) {
      this.updateUri(uri, diagnostics);
      changedUris.add(uri.toString());
    }

    if (changedUris.size > 0) {
      this.changeEmitter.fire([...changedUris]);
    }
  }

  handleDiagnosticChange(event: vscode.DiagnosticChangeEvent): void {
    const changedUris: string[] = [];
    for (const uri of event.uris) {
      const raw = vscode.languages.getDiagnostics(uri);
      this.updateUri(uri, raw);
      changedUris.push(uri.toString());
    }
    if (changedUris.length > 0) {
      this.changeEmitter.fire(changedUris);
    }
  }

  private updateUri(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void {
    const uriStr = uri.toString();

    // Remove old index entries
    const old = this.byUri.get(uriStr);
    if (old) {
      this.removeFromIndexes(uriStr, old);
    }

    // Filter diagnostics based on config
    let filtered = [...diagnostics];
    if (this.config.includeSources.length > 0) {
      filtered = filtered.filter(
        (d) => d.source && this.config.includeSources.includes(d.source)
      );
    }
    if (this.config.excludeSources.length > 0) {
      filtered = filtered.filter(
        (d) => !d.source || !this.config.excludeSources.includes(d.source)
      );
    }
    filtered = filtered.slice(0, this.config.maxDiagnosticsPerFile);

    // Enrich
    const enriched = filtered.map((d) => this.enrich(uri, d));

    if (enriched.length === 0) {
      this.byUri.delete(uriStr);
    } else {
      this.byUri.set(uriStr, enriched);
      this.addToIndexes(uriStr, enriched);
    }

    this.enricher.invalidate(uriStr);
    this.cachedSummaries.clear();
    logDebug(`Updated ${enriched.length} diagnostics for ${relativePath(uri)}`);
  }

  private enrich(uri: vscode.Uri, d: vscode.Diagnostic): EnrichedDiagnostic {
    const { code, href } = resolveCode(d);
    const tags: DiagnosticTag[] = [];
    if (d.tags) {
      for (const t of d.tags) {
        const mapped = toTag(t);
        if (mapped) tags.push(mapped);
      }
    }

    return {
      id: nextId(),
      uri: uri.toString(),
      relativePath: relativePath(uri),
      range: {
        startLine: d.range.start.line,
        startCharacter: d.range.start.character,
        endLine: d.range.end.line,
        endCharacter: d.range.end.character,
      },
      message: d.message,
      severity: SEVERITY_MAP[d.severity],
      source: d.source,
      code,
      codeDescription: href ? { href } : undefined,
      tags,
      relatedInformation: (d.relatedInformation ?? []).map((ri) => ({
        uri: ri.location.uri.toString(),
        relativePath: relativePath(ri.location.uri),
        range: {
          startLine: ri.location.range.start.line,
          startCharacter: ri.location.range.start.character,
          endLine: ri.location.range.end.line,
          endCharacter: ri.location.range.end.character,
        },
        message: ri.message,
      })),
      timestamp: new Date().toISOString(),
      workspaceFolder: workspaceFolderName(uri),
    };
  }

  private addToIndexes(uri: string, diagnostics: EnrichedDiagnostic[]): void {
    for (const d of diagnostics) {
      this.bySeverity.get(d.severity)?.add(uri);
      if (d.source) {
        if (!this.bySource.has(d.source)) {
          this.bySource.set(d.source, new Set());
        }
        this.bySource.get(d.source)!.add(uri);
      }
    }
  }

  private removeFromIndexes(uri: string, diagnostics: EnrichedDiagnostic[]): void {
    for (const sev of this.bySeverity.values()) {
      sev.delete(uri);
    }
    for (const src of this.bySource.values()) {
      src.delete(uri);
    }
  }

  async query(params: DiagnosticQuery = {}): Promise<EnrichedDiagnostic[]> {
    let candidateUris: Set<string>;

    if (params.uri) {
      const resolved = this.resolveUriOrPath(params.uri);
      candidateUris = resolved ? new Set([resolved]) : new Set();
    } else if (params.severity && params.severity.length === 1) {
      candidateUris = new Set(this.bySeverity.get(params.severity[0]) ?? []);
    } else if (params.source && params.source.length === 1) {
      candidateUris = new Set(this.bySource.get(params.source[0]) ?? []);
    } else {
      candidateUris = new Set(this.byUri.keys());
    }

    // Apply URI pattern filter
    if (params.uriPattern) {
      const pattern = normalizePath(params.uriPattern);
      const regex = globToRegex(pattern);
      const filtered = new Set<string>();
      for (const uri of candidateUris) {
        const rel = this.byUri.get(uri)?.[0]?.relativePath;
        if (rel && regex.test(normalizePath(rel))) {
          filtered.add(uri);
        }
      }
      candidateUris = filtered;
    }

    // Workspace folder filter
    if (params.workspaceFolder) {
      const wsf = params.workspaceFolder;
      const filtered = new Set<string>();
      for (const uri of candidateUris) {
        const diags = this.byUri.get(uri);
        if (diags && diags[0]?.workspaceFolder === wsf) {
          filtered.add(uri);
        }
      }
      candidateUris = filtered;
    }

    let results: EnrichedDiagnostic[] = [];
    for (const uri of candidateUris) {
      const diags = this.byUri.get(uri);
      if (!diags) continue;
      for (const d of diags) {
        if (!this.matchesDiagnostic(d, params)) continue;
        results.push(d);
      }
    }

    // Sort
    results = this.sortResults(
      results,
      params.sortBy ?? "severity",
      params.sortOrder ?? "asc"
    );

    // Paginate
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    results = results.slice(offset, offset + limit);

    // Optionally enrich with context
    if (params.includeContext) {
      const contextCount = params.contextLines ?? this.config.contextLines;
      results = await this.addContext(results, contextCount);
    }

    return results;
  }

  async getForFile(
    uriOrPath: string,
    options?: { includeContext?: boolean; contextLines?: number }
  ): Promise<EnrichedDiagnostic[]> {
    const uri = this.resolveUriOrPath(uriOrPath) ?? uriOrPath;

    const diags = this.byUri.get(uri) ?? [];
    if (options?.includeContext) {
      return this.addContext(diags, options.contextLines ?? this.config.contextLines);
    }
    return diags;
  }

  getById(id: string): EnrichedDiagnostic | undefined {
    for (const diags of this.byUri.values()) {
      const found = diags.find((d) => d.id === id);
      if (found) return found;
    }
    return undefined;
  }

  getAll(): EnrichedDiagnostic[] {
    const all: EnrichedDiagnostic[] = [];
    for (const diags of this.byUri.values()) {
      all.push(...diags);
    }
    return all;
  }

  getFilesWithProblems(): string[] {
    const files: string[] = [];
    for (const diags of this.byUri.values()) {
      if (diags.length > 0) {
        files.push(diags[0].relativePath);
      }
    }
    return files.sort();
  }

  getSummary(groupBy: SummaryGroupBy): DiagnosticSummary {
    const cached = this.cachedSummaries.get(groupBy);
    if (cached) return cached;

    const all = this.getAll();
    const byGroup: Record<string, { count: number; files: Set<string> }> = {};

    for (const d of all) {
      let key: string;
      switch (groupBy) {
        case "severity":
          key = d.severity;
          break;
        case "source":
          key = d.source ?? "unknown";
          break;
        case "file":
          key = d.relativePath;
          break;
        case "workspace":
          key = d.workspaceFolder ?? "default";
          break;
      }
      if (!byGroup[key]) {
        byGroup[key] = { count: 0, files: new Set() };
      }
      byGroup[key].count++;
      byGroup[key].files.add(d.relativePath);
    }

    const summary: DiagnosticSummary = {
      total: all.length,
      byGroup: Object.fromEntries(
        Object.entries(byGroup).map(([k, v]) => [
          k,
          { count: v.count, files: [...v.files].sort() },
        ])
      ),
      timestamp: new Date().toISOString(),
    };

    this.cachedSummaries.set(groupBy, summary);
    return summary;
  }

  getCounts(): { errors: number; warnings: number; info: number; hints: number } {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let hints = 0;
    for (const diags of this.byUri.values()) {
      for (const d of diags) {
        switch (d.severity) {
          case "error":
            errors++;
            break;
          case "warning":
            warnings++;
            break;
          case "information":
            info++;
            break;
          case "hint":
            hints++;
            break;
        }
      }
    }
    return { errors, warnings, info, hints };
  }

  private matchesDiagnostic(d: EnrichedDiagnostic, params: DiagnosticQuery): boolean {
    if (params.severity && !params.severity.includes(d.severity)) return false;
    if (params.source && (!d.source || !params.source.includes(d.source))) return false;
    if (params.code && (d.code == null || !params.code.includes(d.code))) return false;
    if (params.messagePattern) {
      try {
        const re = new RegExp(params.messagePattern, "i");
        if (!re.test(d.message)) return false;
      } catch {
        if (!d.message.includes(params.messagePattern)) return false;
      }
    }
    return true;
  }

  private sortResults(
    results: EnrichedDiagnostic[],
    sortBy: string,
    order: string
  ): EnrichedDiagnostic[] {
    const dir = order === "desc" ? -1 : 1;
    return results.sort((a, b) => {
      switch (sortBy) {
        case "severity":
          return (SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity]) * dir;
        case "file":
          return a.relativePath.localeCompare(b.relativePath) * dir;
        case "timestamp":
          return a.timestamp.localeCompare(b.timestamp) * dir;
        case "source":
          return (a.source ?? "").localeCompare(b.source ?? "") * dir;
        default:
          return 0;
      }
    });
  }

  private async addContext(
    diagnostics: EnrichedDiagnostic[],
    contextLines: number
  ): Promise<EnrichedDiagnostic[]> {
    return Promise.all(
      diagnostics.map(async (d) => {
        const ctx = await this.enricher.getContextLines(
          vscode.Uri.parse(d.uri),
          d.range.startLine,
          contextLines
        );
        return ctx ? { ...d, contextLines: ctx } : d;
      })
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
    this.enricher.clear();
    this.byUri.clear();
    this.bySeverity.clear();
    this.bySource.clear();
    this.cachedSummaries.clear();
  }

  private resolveUriOrPath(uriOrPath: string): string | undefined {
    if (this.byUri.has(uriOrPath)) return uriOrPath;

    const normalizedInput = normalizePath(uriOrPath);

    let match: string | undefined;
    for (const [key, diags] of this.byUri) {
      const relPath = diags[0]?.relativePath;
      if (relPath && normalizePath(relPath) === normalizedInput) {
        if (match) return undefined;
        match = key;
      }
    }
    if (match) return match;

    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    if (multiRoot) {
      const candidates: string[] = [];
      for (const [key, diags] of this.byUri) {
        const rel = diags[0]?.relativePath;
        if (rel && normalizePath(rel).endsWith(`/${normalizedInput}`)) {
          candidates.push(key);
        }
      }
      if (candidates.length === 1) return candidates[0];
    }
    return undefined;
  }

  private resetIndexes(): void {
    this.byUri.clear();
    this.bySource.clear();
    this.bySeverity.clear();
    for (const sev of ["error", "warning", "information", "hint"] as Severity[]) {
      this.bySeverity.set(sev, new Set());
    }
    this.cachedSummaries.clear();
  }
}
