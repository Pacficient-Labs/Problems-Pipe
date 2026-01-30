import { describe, it, expect, beforeEach } from "vitest";
import { DiagnosticStore } from "../../src/diagnostics/store.js";
import type { ExtensionConfig } from "../../src/config/manager.js";
import {
  Uri,
  DiagnosticSeverity,
  DiagnosticTag,
  _diagnostics,
  _reset,
} from "../__mocks__/vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    enabled: true,
    autoStart: true,
    transport: "http",
    httpPort: 3030,
    httpHost: "127.0.0.1",
    includeSources: [],
    excludeSources: [],
    maxDiagnosticsPerFile: 100,
    contextLines: 3,
    enableCodeActions: true,
    logLevel: "off",
    ...overrides,
  };
}

/** Create a minimal mock vscode.Diagnostic-shaped object. */
function makeDiag(overrides: {
  message?: string;
  severity?: number;
  source?: string;
  code?: string | number | { value: string | number; target?: any };
  startLine?: number;
  startChar?: number;
  endLine?: number;
  endChar?: number;
  tags?: number[];
  relatedInformation?: any[];
} = {}) {
  return {
    range: {
      start: { line: overrides.startLine ?? 0, character: overrides.startChar ?? 0 },
      end: { line: overrides.endLine ?? 0, character: overrides.endChar ?? 10 },
    },
    message: overrides.message ?? "Test error",
    severity: overrides.severity ?? DiagnosticSeverity.Error,
    source: overrides.source ?? "typescript",
    code: overrides.code,
    tags: overrides.tags ?? [],
    relatedInformation: overrides.relatedInformation ?? [],
  };
}

const FILE_A = "file:///workspace/src/a.ts";
const FILE_B = "file:///workspace/src/b.ts";
const FILE_NESTED = "file:///workspace/src/utils/deep.ts";

function fireChange(store: DiagnosticStore, uris: string[]) {
  store.handleDiagnosticChange({
    uris: uris.map((u) => Uri.parse(u)),
  } as any);
}

function populate(store: DiagnosticStore) {
  _diagnostics.set(FILE_A, [
    makeDiag({ message: "Unused variable", severity: DiagnosticSeverity.Warning, source: "typescript", code: "TS6133" }),
    makeDiag({ message: "Type error", severity: DiagnosticSeverity.Error, source: "typescript", code: "TS2322" }),
  ]);
  _diagnostics.set(FILE_B, [
    makeDiag({ message: "Missing semicolon", severity: DiagnosticSeverity.Error, source: "eslint", code: "semi" }),
    makeDiag({ message: "Prefer const", severity: DiagnosticSeverity.Information, source: "eslint", code: "prefer-const" }),
    makeDiag({ message: "Deprecated API", severity: DiagnosticSeverity.Hint, source: "typescript", tags: [DiagnosticTag.Deprecated] }),
  ]);
  fireChange(store, [FILE_A, FILE_B]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiagnosticStore", () => {
  let store: DiagnosticStore;

  beforeEach(() => {
    _reset();
    store = new DiagnosticStore(defaultConfig());
  });

  // -----------------------------------------------------------------------
  // Basic storage
  // -----------------------------------------------------------------------

  it("starts empty", () => {
    expect(store.getAll()).toHaveLength(0);
  });

  it("stores diagnostics from handleDiagnosticChange", () => {
    populate(store);
    expect(store.getAll()).toHaveLength(5);
  });

  it("removes diagnostics when a file has none", () => {
    populate(store);
    // Clear file A
    _diagnostics.set(FILE_A, []);
    fireChange(store, [FILE_A]);

    expect(store.getAll()).toHaveLength(3); // only file B
  });

  // -----------------------------------------------------------------------
  // getForFile
  // -----------------------------------------------------------------------

  it("getForFile returns diagnostics for a specific URI", async () => {
    populate(store);
    const result = await store.getForFile(FILE_A);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.uri === FILE_A)).toBe(true);
  });

  it("getForFile returns empty array for unknown file", async () => {
    populate(store);
    const result = await store.getForFile("file:///workspace/src/nope.ts");
    expect(result).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // getById
  // -----------------------------------------------------------------------

  it("getById finds a diagnostic by its id", () => {
    populate(store);
    const all = store.getAll();
    const target = all[0];
    expect(store.getById(target.id)).toBe(target);
  });

  it("getById returns undefined for unknown id", () => {
    populate(store);
    expect(store.getById("nonexistent_id")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // getCounts
  // -----------------------------------------------------------------------

  it("getCounts reports correct tallies", () => {
    populate(store);
    const counts = store.getCounts();
    expect(counts.errors).toBe(2);
    expect(counts.warnings).toBe(1);
    expect(counts.info).toBe(1);
    expect(counts.hints).toBe(1);
  });

  it("getCounts is zero when empty", () => {
    const counts = store.getCounts();
    expect(counts).toEqual({ errors: 0, warnings: 0, info: 0, hints: 0 });
  });

  // -----------------------------------------------------------------------
  // getSummary
  // -----------------------------------------------------------------------

  it("getSummary groups by severity", () => {
    populate(store);
    const summary = store.getSummary("severity");
    expect(summary.total).toBe(5);
    expect(summary.byGroup["error"].count).toBe(2);
    expect(summary.byGroup["warning"].count).toBe(1);
    expect(summary.byGroup["information"].count).toBe(1);
    expect(summary.byGroup["hint"].count).toBe(1);
  });

  it("getSummary groups by source", () => {
    populate(store);
    const summary = store.getSummary("source");
    expect(summary.total).toBe(5);
    expect(summary.byGroup["typescript"].count).toBe(3);
    expect(summary.byGroup["eslint"].count).toBe(2);
  });

  it("getSummary groups by file", () => {
    populate(store);
    const summary = store.getSummary("file");
    expect(summary.total).toBe(5);
    // relativePath for FILE_A is "src/a.ts"
    expect(summary.byGroup["src/a.ts"].count).toBe(2);
    expect(summary.byGroup["src/b.ts"].count).toBe(3);
  });

  it("getSummary caches results and invalidates on change", () => {
    populate(store);
    const first = store.getSummary("severity");
    const second = store.getSummary("severity");
    expect(first).toBe(second); // same object reference = cached

    // Trigger a change to invalidate cache
    _diagnostics.set(FILE_A, []);
    fireChange(store, [FILE_A]);

    const third = store.getSummary("severity");
    expect(third).not.toBe(first);
    expect(third.total).toBe(3);
  });

  // -----------------------------------------------------------------------
  // getFilesWithProblems
  // -----------------------------------------------------------------------

  it("getFilesWithProblems returns sorted relative paths", () => {
    populate(store);
    const files = store.getFilesWithProblems();
    expect(files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  // -----------------------------------------------------------------------
  // query – filtering
  // -----------------------------------------------------------------------

  it("query with no params returns all diagnostics", async () => {
    populate(store);
    const results = await store.query();
    expect(results).toHaveLength(5);
  });

  it("query filters by severity", async () => {
    populate(store);
    const errors = await store.query({ severity: ["error"] });
    expect(errors).toHaveLength(2);
    expect(errors.every((d) => d.severity === "error")).toBe(true);
  });

  it("query filters by multiple severities", async () => {
    populate(store);
    const results = await store.query({ severity: ["error", "warning"] });
    expect(results).toHaveLength(3);
  });

  it("query filters by source", async () => {
    populate(store);
    const eslintDiags = await store.query({ source: ["eslint"] });
    expect(eslintDiags).toHaveLength(2);
    expect(eslintDiags.every((d) => d.source === "eslint")).toBe(true);
  });

  it("query filters by code", async () => {
    populate(store);
    const results = await store.query({ code: ["TS2322"] });
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe("Type error");
  });

  it("query filters by messagePattern (regex)", async () => {
    populate(store);
    const results = await store.query({ messagePattern: "^Missing" });
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe("Missing semicolon");
  });

  it("query messagePattern falls back to includes on invalid regex", async () => {
    _diagnostics.set(FILE_A, [makeDiag({ message: "Type error [" })]);
    fireChange(store, [FILE_A]);
    // "[" is an invalid regex, so it should fall back to substring matching
    const results = await store.query({ messagePattern: "[" });
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe("Type error [");
  });

  it("query filters by specific uri", async () => {
    populate(store);
    const results = await store.query({ uri: FILE_A });
    expect(results).toHaveLength(2);
    expect(results.every((d) => d.uri === FILE_A)).toBe(true);
  });

  it("query filters by uriPattern glob", async () => {
    _diagnostics.set(FILE_A, [makeDiag()]);
    _diagnostics.set(FILE_NESTED, [makeDiag()]);
    fireChange(store, [FILE_A, FILE_NESTED]);

    const results = await store.query({ uriPattern: "src/utils/**" });
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe("src/utils/deep.ts");
  });

  it("query uriPattern *.ts matches top-level ts files", async () => {
    _diagnostics.set(FILE_A, [makeDiag()]);
    _diagnostics.set(FILE_NESTED, [makeDiag()]);
    fireChange(store, [FILE_A, FILE_NESTED]);

    // "**/*.ts" matches any .ts file
    const results = await store.query({ uriPattern: "**/*.ts" });
    expect(results).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // query – sorting
  // -----------------------------------------------------------------------

  it("query sorts by severity ascending (errors first)", async () => {
    populate(store);
    const results = await store.query({ sortBy: "severity", sortOrder: "asc" });
    const severities = results.map((d) => d.severity);
    // error < warning < information < hint
    for (let i = 1; i < severities.length; i++) {
      expect(severityRank(severities[i])).toBeGreaterThanOrEqual(severityRank(severities[i - 1]));
    }
  });

  it("query sorts by severity descending (hints first)", async () => {
    populate(store);
    const results = await store.query({ sortBy: "severity", sortOrder: "desc" });
    const severities = results.map((d) => d.severity);
    for (let i = 1; i < severities.length; i++) {
      expect(severityRank(severities[i])).toBeLessThanOrEqual(severityRank(severities[i - 1]));
    }
  });

  it("query sorts by file", async () => {
    populate(store);
    const results = await store.query({ sortBy: "file", sortOrder: "asc" });
    const paths = results.map((d) => d.relativePath);
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i].localeCompare(paths[i - 1])).toBeGreaterThanOrEqual(0);
    }
  });

  it("query sorts by source", async () => {
    populate(store);
    const results = await store.query({ sortBy: "source", sortOrder: "asc" });
    const sources = results.map((d) => d.source ?? "");
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i].localeCompare(sources[i - 1])).toBeGreaterThanOrEqual(0);
    }
  });

  // -----------------------------------------------------------------------
  // query – pagination
  // -----------------------------------------------------------------------

  it("query limit caps results", async () => {
    populate(store);
    const results = await store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("query offset skips results", async () => {
    populate(store);
    const all = await store.query();
    const paged = await store.query({ offset: 2, limit: 2 });
    expect(paged).toHaveLength(2);
    expect(paged[0].id).toBe(all[2].id);
    expect(paged[1].id).toBe(all[3].id);
  });

  // -----------------------------------------------------------------------
  // resolveUriOrPath (tested via getForFile with relative path)
  // -----------------------------------------------------------------------

  it("resolves by relative path", async () => {
    populate(store);
    const results = await store.getForFile("src/a.ts");
    expect(results).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Config-based filtering
  // -----------------------------------------------------------------------

  it("includeSources filters to specified sources only", () => {
    const s = new DiagnosticStore(defaultConfig({ includeSources: ["eslint"] }));
    _diagnostics.set(FILE_A, [
      makeDiag({ source: "typescript" }),
      makeDiag({ source: "eslint" }),
    ]);
    fireChange(s, [FILE_A]);

    const all = s.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].source).toBe("eslint");
  });

  it("excludeSources removes specified sources", () => {
    const s = new DiagnosticStore(defaultConfig({ excludeSources: ["typescript"] }));
    _diagnostics.set(FILE_A, [
      makeDiag({ source: "typescript" }),
      makeDiag({ source: "eslint" }),
    ]);
    fireChange(s, [FILE_A]);

    const all = s.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].source).toBe("eslint");
  });

  it("maxDiagnosticsPerFile limits per-file count", () => {
    const s = new DiagnosticStore(defaultConfig({ maxDiagnosticsPerFile: 1 }));
    _diagnostics.set(FILE_A, [
      makeDiag({ message: "first" }),
      makeDiag({ message: "second" }),
      makeDiag({ message: "third" }),
    ]);
    fireChange(s, [FILE_A]);

    expect(s.getAll()).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Enrichment – diagnostic fields
  // -----------------------------------------------------------------------

  it("enriches diagnostics with correct fields", () => {
    _diagnostics.set(FILE_A, [
      makeDiag({
        message: "Cannot find name 'x'",
        severity: DiagnosticSeverity.Error,
        source: "typescript",
        code: "TS2304",
        startLine: 5,
        startChar: 10,
        endLine: 5,
        endChar: 11,
      }),
    ]);
    fireChange(store, [FILE_A]);

    const [d] = store.getAll();
    expect(d.uri).toBe(FILE_A);
    expect(d.relativePath).toBe("src/a.ts");
    expect(d.message).toBe("Cannot find name 'x'");
    expect(d.severity).toBe("error");
    expect(d.source).toBe("typescript");
    expect(d.code).toBe("TS2304");
    expect(d.range).toEqual({
      startLine: 5,
      startCharacter: 10,
      endLine: 5,
      endCharacter: 11,
    });
    expect(d.id).toMatch(/^diag_/);
    expect(d.timestamp).toBeTruthy();
  });

  it("maps diagnostic tags", () => {
    _diagnostics.set(FILE_A, [
      makeDiag({ tags: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated] }),
    ]);
    fireChange(store, [FILE_A]);

    const [d] = store.getAll();
    expect(d.tags).toContain("unnecessary");
    expect(d.tags).toContain("deprecated");
  });

  it("resolves object-style code with href", () => {
    _diagnostics.set(FILE_A, [
      makeDiag({
        code: {
          value: "no-unused-vars",
          target: Uri.parse("https://eslint.org/docs/rules/no-unused-vars"),
        },
      }),
    ]);
    fireChange(store, [FILE_A]);

    const [d] = store.getAll();
    expect(d.code).toBe("no-unused-vars");
    expect(d.codeDescription?.href).toContain("eslint.org");
  });

  // -----------------------------------------------------------------------
  // onDidChange event
  // -----------------------------------------------------------------------

  it("fires onDidChange when diagnostics are updated", () => {
    const changed: string[][] = [];
    store.onDidChange((uris) => changed.push(uris));

    _diagnostics.set(FILE_A, [makeDiag()]);
    fireChange(store, [FILE_A]);

    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain(FILE_A);
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  it("dispose clears all data", () => {
    populate(store);
    expect(store.getAll().length).toBeGreaterThan(0);

    store.dispose();
    expect(store.getAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const SEV_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
};

function severityRank(sev: string): number {
  return SEV_RANK[sev] ?? 99;
}
