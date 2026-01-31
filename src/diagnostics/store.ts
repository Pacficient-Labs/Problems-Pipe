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
import { logDebug, logTrace, isDebugEnabled } from "../utils/index.js";

/**
 * Safe glob matcher for paths.
 *
 * Supported tokens:
 * - `*`  : matches any number of characters within a single path segment (not `/`)
 * - `?`  : matches a single character within a segment (not `/`)
 * - `**` : matches zero or more path segments
 *
 * We intentionally avoid dynamic RegExp construction here to satisfy security
 * tooling (Semgrep/ESLint) and reduce ReDoS risk.
 */
function globMatch(glob: string, value: string): boolean {
  // Both inputs are assumed to be normalized to use forward slashes.
  const patternParts = glob.split("/").filter((p) => p.length > 0);
  const valueParts = value.split("/").filter((p) => p.length > 0);

  const matchSegment = (pattern: string, segment: string): boolean => {
    // Iterative wildcard matching (linear-ish in segment length).
    let pi = 0;
    let si = 0;
    let starPi = -1;
    let starSi = -1;

    while (si < segment.length) {
      const pc = pattern[pi];
      if (pi < pattern.length && (pc === "?" || pc === segment[si])) {
        pi++;
        si++;
        continue;
      }
      if (pi < pattern.length && pc === "*") {
        starPi = pi;
        pi++; // consume '*'
        starSi = si;
        continue;
      }
      if (starPi !== -1) {
        // Backtrack: extend the last '*' match by one.
        pi = starPi + 1;
        starSi++;
        si = starSi;
        continue;
      }
      return false;
    }

    // Trailing '*' can match empty suffix.
    while (pi < pattern.length && pattern[pi] === "*") pi++;
    return pi === pattern.length;
  };

  const handleDoubleStarPattern = (pIndex: number, vIndex: number): boolean => {
    // Collapse consecutive '**'
    while (pIndex + 1 < patternParts.length && patternParts[pIndex + 1] === "**") {
      pIndex++;
    }
    // '**' at end matches the rest.
    if (pIndex === patternParts.length - 1) return true;

    // Try to match the remaining pattern at every possible segment boundary.
    for (let skip = vIndex; skip <= valueParts.length; skip++) {
      if (matchParts(pIndex + 1, skip)) return true;
    }
    return false;
  };

  const matchParts = (pIndex: number, vIndex: number): boolean => {
    while (true) {
      if (pIndex === patternParts.length) return vIndex === valueParts.length;

      const p = patternParts[pIndex];
      if (p === "**") {
        return handleDoubleStarPattern(pIndex, vIndex);
      }

      if (vIndex === valueParts.length) return false;
      if (!matchSegment(p, valueParts[vIndex])) return false;

      pIndex++;
      vIndex++;
    }
  };

  return matchParts(0, 0);
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', "/");
}

/**
 * Match a user-provided message pattern against a diagnostic message.
 *
 * NOTE: We intentionally do NOT treat `pattern` as a full regular expression
 * to avoid dynamic RegExp construction (flagged by security tooling).
 *
 * Supported syntax:
 * - `^text`    : case-insensitive startsWith
 * - `text$`    : case-insensitive endsWith
 * - `^text$`   : case-insensitive exact match
 * - otherwise  : case-insensitive substring match
 *
 * Escapes supported: `\^`, `\$`, `\\`
 */
function matchMessagePattern(message: string, pattern: string): boolean {
  let p = pattern;
  let anchoredStart = false;
  let anchoredEnd = false;

  if (p.startsWith("^")) {
    anchoredStart = true;
    p = p.slice(1);
  }

  if (p.endsWith("$")) {
    anchoredEnd = true;
    p = p.slice(0, -1);
  }

  // Minimal unescape for the supported anchor characters.
  // Use literal string replacement to avoid any dynamic RegExp construction.
  p = p.split("\\\\").join("\x00").split(String.raw`\^`).join("^").split(String.raw`\$`).join("$").split("\x00").join("\\");

  const msg = message.toLowerCase();
  const needle = p.toLowerCase();

  if (anchoredStart && anchoredEnd) return msg === needle;
  if (anchoredStart) return msg.startsWith(needle);
  if (anchoredEnd) return msg.endsWith(needle);
  return msg.includes(needle);
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
  private readonly byUri = new Map<string, EnrichedDiagnostic[]>();
  private readonly bySeverity = new Map<Severity, Set<string>>();
  private readonly bySource = new Map<string, Set<string>>();
  private readonly cachedSummaries = new Map<SummaryGroupBy, DiagnosticSummary>();
  private readonly enricher = new ContextEnricher();
  private readonly changeEmitter = new vscode.EventEmitter<string[]>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor(private config: ExtensionConfig) {
    logDebug("[Store] initializing DiagnosticStore");
    for (const sev of ["error", "warning", "information", "hint"] as Severity[]) {
      this.bySeverity.set(sev, new Set());
    }
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const uri = event.document.uri;
        if (uri.scheme === "output") return;
        this.enricher.invalidate(uri.toString());
      })
    );
  }

  updateConfig(config: ExtensionConfig): void {
    logDebug(`[Store] updateConfig called — rebuilding indexes for ${this.byUri.size} URI(s)`);
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
      logDebug(`[Store] config update affected ${changedUris.size} URI(s)`);
      this.changeEmitter.fire([...changedUris]);
    }
  }

  handleDiagnosticChange(event: vscode.DiagnosticChangeEvent): void {
    logDebug(`[Store] handleDiagnosticChange — ${event.uris.length} URI(s)`);
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
    const relPath = relativePath(uri);

    // Remove old index entries
    const old = this.byUri.get(uriStr);
    if (old) {
      this.removeFromIndexes(uriStr, old);
    }

    // Filter diagnostics based on config
    let filtered = [...diagnostics];
    const rawCount = filtered.length;
    if (this.config.includeSources.length > 0) {
      filtered = filtered.filter(
        (d) => d.source && this.config.includeSources.includes(d.source)
      );
      if (filtered.length !== rawCount) {
        logTrace(
          `[Store] source include filter: ${rawCount} -> ${filtered.length} for ${relPath}`
        );
      }
    }
    if (this.config.excludeSources.length > 0) {
      const beforeExclude = filtered.length;
      filtered = filtered.filter(
        (d) => !d.source || !this.config.excludeSources.includes(d.source)
      );
      if (filtered.length !== beforeExclude) {
        logTrace(
          `[Store] source exclude filter: ${beforeExclude} -> ${filtered.length} for ${relPath}`
        );
      }
    }
    if (filtered.length > this.config.maxDiagnosticsPerFile) {
      logTrace(
        `[Store] capping diagnostics: ${filtered.length} -> ${this.config.maxDiagnosticsPerFile} for ${relPath}`
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
    logDebug(`[Store] updated ${enriched.length} diagnostics for ${relPath}`);
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
        this.bySource.get(d.source)?.add(uri);
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

  private getCandidateUris(params: DiagnosticQuery): Set<string> {
    if (params.uri) {
      const resolved = this.resolveUriOrPath(params.uri);
      return resolved ? new Set([resolved]) : new Set();
    }
    if (params.severity?.length === 1) {
      return new Set(this.bySeverity.get(params.severity[0]) ?? []);
    }
    if (params.source?.length === 1) {
      return new Set(this.bySource.get(params.source[0]) ?? []);
    }
    return new Set(this.byUri.keys());
  }

  private filterByUriPattern(
    candidateUris: Set<string>,
    pattern: string
  ): Set<string> {
    const normalizedPattern = normalizePath(pattern);
    const filtered = new Set<string>();
    for (const uri of candidateUris) {
      const rel = this.byUri.get(uri)?.[0]?.relativePath;
      if (rel && globMatch(normalizedPattern, normalizePath(rel))) {
        filtered.add(uri);
      }
    }
    return filtered;
  }

  private filterByWorkspaceFolder(
    candidateUris: Set<string>,
    workspaceFolder: string
  ): Set<string> {
    const filtered = new Set<string>();
    for (const uri of candidateUris) {
      const diags = this.byUri.get(uri);
      if (diags && diags[0]?.workspaceFolder === workspaceFolder) {
        filtered.add(uri);
      }
    }
    return filtered;
  }

  private collectDiagnosticsFromUris(
    candidateUris: Set<string>,
    params: DiagnosticQuery
  ): EnrichedDiagnostic[] {
    const results: EnrichedDiagnostic[] = [];
    for (const uri of candidateUris) {
      const diags = this.byUri.get(uri);
      if (!diags) continue;
      for (const d of diags) {
        if (this.matchesDiagnostic(d, params)) {
          results.push(d);
        }
      }
    }
    return results;
  }

  async query(params: DiagnosticQuery = {}): Promise<EnrichedDiagnostic[]> {
    if (isDebugEnabled()) {
      const filters = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      logDebug(`[Store] query — ${filters || "no filters"}`);
    }

    let candidateUris = this.getCandidateUris(params);

    if (params.uriPattern) {
      candidateUris = this.filterByUriPattern(candidateUris, params.uriPattern);
    }

    if (params.workspaceFolder) {
      candidateUris = this.filterByWorkspaceFolder(
        candidateUris,
        params.workspaceFolder
      );
    }

    let results = this.collectDiagnosticsFromUris(candidateUris, params);

    results = this.sortResults(
      results,
      params.sortBy ?? "severity",
      params.sortOrder ?? "asc"
    );

    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    results = results.slice(offset, offset + limit);

    if (params.includeContext) {
      const contextCount = params.contextLines ?? this.config.contextLines;
      logDebug(`[Store] enriching ${results.length} result(s) with ${contextCount} context lines`);
      results = await this.addContext(results, contextCount);
    }

    logDebug(`[Store] query returned ${results.length} result(s)`);
    return results;
  }

  async getForFile(
    uriOrPath: string,
    options?: { includeContext?: boolean; contextLines?: number }
  ): Promise<EnrichedDiagnostic[]> {
    logDebug(`[Store] getForFile — path: ${uriOrPath}, includeContext: ${options?.includeContext ?? false}`);
    const uri = this.resolveUriOrPath(uriOrPath) ?? uriOrPath;

    const diags = this.byUri.get(uri) ?? [];
    logDebug(`[Store] getForFile found ${diags.length} diagnostic(s)`);
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
    return files.sort((a, b) => a.localeCompare(b));
  }

  getSummary(groupBy: SummaryGroupBy): DiagnosticSummary {
    const cached = this.cachedSummaries.get(groupBy);
    if (cached) {
      logDebug(`[Store] getSummary(${groupBy}) — returning cached`);
      return cached;
    }
    logDebug(`[Store] getSummary(${groupBy}) — computing`);

    const all = this.getAll();
    const byGroup = new Map<string, { count: number; files: Set<string> }>();

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
      if (!byGroup.has(key)) {
        byGroup.set(key, { count: 0, files: new Set() });
      }
      byGroup.get(key)!.count++;
      byGroup.get(key)!.files.add(d.relativePath);
    }

    const summary: DiagnosticSummary = {
      total: all.length,
      byGroup: Object.fromEntries(
        Array.from(byGroup).map(([k, v]) => [
          k,
          { count: v.count, files: [...v.files].sort((a, b) => a.localeCompare(b)) },
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
      if (!matchMessagePattern(d.message, params.messagePattern)) return false;
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
    logDebug(`[Store] disposing — ${this.byUri.size} URI(s) in store`);
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
    
    const exactMatch = this.findExactPathMatch(normalizedInput);
    if (exactMatch !== undefined) return exactMatch;

    return this.findMultiRootMatch(normalizedInput);
  }

  private findExactPathMatch(normalizedInput: string): string | undefined {
    let match: string | undefined;
    for (const [key, diags] of this.byUri) {
      const relPath = diags[0]?.relativePath;
      if (relPath && normalizePath(relPath) === normalizedInput) {
        if (match) return undefined;
        match = key;
      }
    }
    return match;
  }

  private findMultiRootMatch(normalizedInput: string): string | undefined {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    if (!multiRoot) return undefined;

    const candidates: string[] = [];
    for (const [key, diags] of this.byUri) {
      const rel = diags[0]?.relativePath;
      if (rel && normalizePath(rel).endsWith(`/${normalizedInput}`)) {
        candidates.push(key);
      }
    }
    return candidates.length === 1 ? candidates[0] : undefined;
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
