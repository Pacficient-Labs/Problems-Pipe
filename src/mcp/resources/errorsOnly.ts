import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logDebug } from "../../utils/index.js";

export function registerErrorsOnlyResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource({
    name: "errors-only",
    uri: "problems://errors",
    metadata: { mimeType: "application/json" },
    read: async (uri) => {
      logDebug("[Resource:errors-only] accessed");
      const errors = await store.query({
        severity: ["error"],
        limit: Number.MAX_SAFE_INTEGER,
      });
      logDebug(`[Resource:errors-only] returning ${errors.length} error(s)`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(errors, null, 2),
          },
        ],
      };
    },
  });
}
