import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logDebug } from "../../utils/index.js";

export function registerAllProblemsResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource({
    uri: "problems://all",
    name: "all-problems",
    mimeType: "application/json",
    read: async (uri) => {
      const all = store.getAll();
      logDebug(`[Resource:all-problems] accessed — returning ${all.length} diagnostic(s)`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(all, null, 2),
          },
        ],
      };
    },
  });
}
