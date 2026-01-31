import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logDebug } from "../../utils/index.js";

export function registerSummaryResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource(
    "problems-summary",
    "problems://summary",
    { mimeType: "application/json" },
    async (uri) => {
      logDebug("[Resource:summary] accessed");
      const summary = store.getSummary("severity");
      logDebug(`[Resource:summary] total: ${summary.total}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );
}
