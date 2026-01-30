import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

export function registerGetProblemSummary(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.tool(
    "get_problem_summary",
    "Get aggregated statistics about problems in the workspace",
    {
      groupBy: z
        .enum(["severity", "source", "file", "workspace"])
        .default("severity")
        .describe("How to group the summary"),
    },
    async ({ groupBy }) => {
      const summary = store.getSummary(groupBy);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );
}
