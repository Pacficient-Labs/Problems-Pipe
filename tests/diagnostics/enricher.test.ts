import { describe, it, expect, beforeEach } from "vitest";
import { ContextEnricher } from "../../src/diagnostics/enricher.js";
import { Uri, _fileContents, _reset } from "../__mocks__/vscode";

const FILE_URI = "file:///workspace/src/example.ts";

const SAMPLE_FILE = [
  "import { foo } from './foo';",
  "",
  "function main() {",
  "  const x = foo();",
  "  console.log(x);",
  "  return x + 1;",
  "}",
].join("\n");

describe("ContextEnricher", () => {
  let enricher: ContextEnricher;

  beforeEach(() => {
    _reset();
    enricher = new ContextEnricher();
    _fileContents.set(FILE_URI, SAMPLE_FILE);
  });

  it("returns context lines around the target line", async () => {
    const uri = Uri.parse(FILE_URI);
    // Line 3 = "  const x = foo();"
    const ctx = await enricher.getContextLines(uri, 3, 1);

    expect(ctx).not.toBeUndefined();
    expect(ctx!.line).toBe("  const x = foo();");
    expect(ctx!.before).toEqual(["function main() {"]);
    expect(ctx!.after).toEqual(["  console.log(x);"]);
  });

  it("returns wider context with larger count", async () => {
    const uri = Uri.parse(FILE_URI);
    // Line 3, context 2 lines
    const ctx = await enricher.getContextLines(uri, 3, 2);

    expect(ctx!.before).toEqual(["", "function main() {"]);
    expect(ctx!.after).toEqual(["  console.log(x);", "  return x + 1;"]);
  });

  it("clamps context at file boundaries", async () => {
    const uri = Uri.parse(FILE_URI);
    // Line 0 (first line), request 3 lines of context
    const ctx = await enricher.getContextLines(uri, 0, 3);

    expect(ctx!.before).toHaveLength(0); // nothing before first line
    expect(ctx!.line).toBe("import { foo } from './foo';");
    expect(ctx!.after).toHaveLength(3);
  });

  it("clamps context at end of file", async () => {
    const uri = Uri.parse(FILE_URI);
    // Last line (6 = "}")
    const ctx = await enricher.getContextLines(uri, 6, 3);

    expect(ctx!.after).toHaveLength(0); // nothing after last line
    expect(ctx!.line).toBe("}");
    expect(ctx!.before).toHaveLength(3);
  });

  it("returns undefined when count is 0", async () => {
    const uri = Uri.parse(FILE_URI);
    const ctx = await enricher.getContextLines(uri, 3, 0);
    expect(ctx).toBeUndefined();
  });

  it("returns undefined for out-of-bounds line", async () => {
    const uri = Uri.parse(FILE_URI);
    const ctx = await enricher.getContextLines(uri, 999, 2);
    expect(ctx).toBeUndefined();
  });

  it("returns undefined for negative line", async () => {
    const uri = Uri.parse(FILE_URI);
    const ctx = await enricher.getContextLines(uri, -1, 2);
    expect(ctx).toBeUndefined();
  });

  it("returns undefined when file does not exist", async () => {
    const uri = Uri.parse("file:///workspace/src/missing.ts");
    // _fileContents has no entry for this URI, so openTextDocument returns ""
    // which splits into [""], a single-line file — line 5 is out of bounds
    const ctx = await enricher.getContextLines(uri, 5, 2);
    expect(ctx).toBeUndefined();
  });

  it("caches file content across calls", async () => {
    const uri = Uri.parse(FILE_URI);

    const first = await enricher.getContextLines(uri, 3, 1);
    // Change the underlying content — the enricher should still use cached version
    _fileContents.set(FILE_URI, "completely different content");
    const second = await enricher.getContextLines(uri, 3, 1);

    expect(first).toEqual(second);
  });

  it("invalidate clears cache for a specific URI", async () => {
    const uri = Uri.parse(FILE_URI);
    await enricher.getContextLines(uri, 0, 1); // populate cache

    _fileContents.set(FILE_URI, "line zero\nline one\nline two");
    enricher.invalidate(FILE_URI);

    const ctx = await enricher.getContextLines(uri, 0, 1);
    expect(ctx!.line).toBe("line zero");
  });

  it("clear removes all cached content", async () => {
    const uri = Uri.parse(FILE_URI);
    await enricher.getContextLines(uri, 0, 1); // populate cache

    _fileContents.set(FILE_URI, "replaced\nfile");
    enricher.clear();

    const ctx = await enricher.getContextLines(uri, 0, 1);
    expect(ctx!.line).toBe("replaced");
  });
});
