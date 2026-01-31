import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import type { EnrichedDiagnostic } from "../../types/index.js";
import { logDebug } from "../../utils/index.js";

function formatErrorsForPrompt(errors: EnrichedDiagnostic[]): string {
  if (errors.length === 0) return "No errors found in the workspace.";

  const byFile = new Map<string, EnrichedDiagnostic[]>();
  for (const e of errors) {
    const list = byFile.get(e.relativePath) ?? [];
    list.push(e);
    byFile.set(e.relativePath, list);
  }

  const lines: string[] = [];
  for (const [file, diags] of byFile) {
    lines.push(`### ${file}`);
    for (const d of diags) {
      const loc = `Line ${d.range.startLine + 1}:${d.range.startCharacter + 1}`;
      const code = d.code != null ? ` [${d.code}]` : "";
      const source = d.source ? ` (${d.source})` : "";
      lines.push(`- **${loc}**${code}${source}: ${d.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerFixAllErrorsPrompt(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.prompt(
    "fix-all-errors",
    "Generate a prompt to fix all errors in the workspace",
    async () => {
      logDebug("[Prompt:fix-all-errors] invoked");
      const errors = await store.query({
        severity: ["error"],
        limit: Number.MAX_SAFE_INTEGER,
      });
      logDebug(`[Prompt:fix-all-errors] found ${errors.length} error(s)`);
      const formatted = formatErrorsForPrompt(errors);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Please help me fix the following ${errors.length} error(s) in my codebase:\n\n` +
                formatted +
                "\n\nFor each error, explain the issue and provide the fix.",
            },
          },
        ],
      };
    }
  );
}
