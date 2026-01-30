import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

export function registerSummaryResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource(
    "problems-summary",
    "problems://summary",
    { mimeType: "application/json" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(store.getSummary("severity"), null, 2),
        },
      ],
    })
  );
}
