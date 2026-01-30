import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

export function registerGetProblems(server: McpServer, store: DiagnosticStore): void {
  server.tool(
    "get_problems",
    "Retrieve diagnostics from the VS Code Problems panel with filtering options",
    {
      uri: z
        .string()
        .optional()
        .describe("Filter by specific file URI or relative path"),
      uriPattern: z
        .string()
        .optional()
        .describe("Filter by glob pattern (e.g., '**/*.ts')"),
      severity: z
        .array(z.enum(["error", "warning", "information", "hint"]))
        .optional()
        .describe("Filter by severity levels"),
      source: z
        .array(z.string())
        .optional()
        .describe("Filter by diagnostic source (e.g., 'typescript', 'eslint')"),
      code: z
        .array(z.union([z.string(), z.number()]))
        .optional()
        .describe("Filter by specific error codes"),
      messagePattern: z
        .string()
        .optional()
        .describe("Filter by regex pattern matching the message"),
      limit: z
        .number()
        .min(1)
        .max(500)
        .default(100)
        .describe("Maximum number of results"),
      offset: z.number().min(0).default(0).describe("Skip N results for pagination"),
      sortBy: z
        .enum(["severity", "file", "timestamp", "source"])
        .default("severity")
        .describe("Sort results by field"),
      sortOrder: z.enum(["asc", "desc"]).default("asc").describe("Sort direction"),
      includeContext: z
        .boolean()
        .default(false)
        .describe("Include surrounding code lines"),
      contextLines: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe("Number of context lines above and below (defaults to config)"),
    },
    async (params) => {
      const diagnostics = await store.query(params);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(diagnostics, null, 2),
          },
        ],
      };
    }
  );
}
