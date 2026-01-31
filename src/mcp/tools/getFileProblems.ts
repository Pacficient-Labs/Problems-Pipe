import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import type { EnrichedDiagnostic } from "../../types/index.js";
import { logDebug } from "../../utils/index.js";

function formatDiagnosticHeader(d: EnrichedDiagnostic, loc: string): string {
  const code = d.code == null ? "" : ` [${d.code}]`;
  const source = d.source ? ` (${d.source})` : "";
  return `### ${d.severity.toUpperCase()}${code}${source} at ${loc}`;
}

function pushContextBlock(lines: string[], d: EnrichedDiagnostic): void {
  if (!d.contextLines) {
    return;
  }

  lines.push("", "```");

  const startLine = d.range.startLine - d.contextLines.before.length;
  for (let i = 0; i < d.contextLines.before.length; i++) {
    lines.push(
      `${String(startLine + i + 1).padStart(4)} | ${d.contextLines.before[i]}`
    );
  }

  lines.push(
    `${String(d.range.startLine + 1).padStart(4)} | ${d.contextLines.line}  <-- HERE`
  );

  for (let i = 0; i < d.contextLines.after.length; i++) {
    lines.push(
      `${String(d.range.startLine + 2 + i).padStart(4)} | ${d.contextLines.after[i]}`
    );
  }

  lines.push("```");
}

function pushRelatedInformation(lines: string[], d: EnrichedDiagnostic): void {
  if (d.relatedInformation.length === 0) {
    return;
  }

  lines.push(
    "",
    "Related:",
    ...d.relatedInformation.map(
      (ri) => `  - ${ri.relativePath}:${ri.range.startLine + 1}: ${ri.message}`
    )
  );
}

function formatFileProblems(
  filePath: string,
  diagnostics: EnrichedDiagnostic[]
): string {
  if (diagnostics.length === 0) {
    return `No problems found in ${filePath}`;
  }

  const lines: string[] = [`## Problems in ${filePath}`, ""];

  for (const d of diagnostics) {
    const loc = `Line ${d.range.startLine + 1}:${d.range.startCharacter + 1}`;

    lines.push(
      formatDiagnosticHeader(d, loc),
      d.message
    );

    pushContextBlock(lines, d);
    pushRelatedInformation(lines, d);

    lines.push("");
  }

  return lines.join("\n");
}

export function registerGetFileProblems(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.registerTool(
    "get_file_problems",
    "Get all problems for a specific file with formatted context",
    {
      uri: z.string().describe("File URI or relative path to get problems for"),
      includeContext: z
        .boolean()
        .default(true)
        .describe("Include surrounding code lines"),
      contextLines: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe("Number of context lines (defaults to config)"),
    },
    async (params) => {
      logDebug(`[Tool:get_file_problems] invoked — uri: ${params.uri}, includeContext: ${params.includeContext}`);
      const diagnostics = await store.getForFile(params.uri, {
        includeContext: params.includeContext,
        contextLines: params.contextLines,
      });
      logDebug(`[Tool:get_file_problems] returning ${diagnostics.length} diagnostic(s)`);
      return {
        content: [
          {
            type: "text" as const,
            text: formatFileProblems(params.uri, diagnostics),
          },
        ],
      };
    }
  );
}
