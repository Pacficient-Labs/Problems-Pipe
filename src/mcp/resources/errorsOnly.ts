import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

export function registerErrorsOnlyResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource(
    "errors-only",
    "problems://errors",
    { mimeType: "application/json" },
    async (uri) => {
      const errors = await store.query({
        severity: ["error"],
        limit: Number.MAX_SAFE_INTEGER,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(errors, null, 2),
          },
        ],
      };
    }
  );
}
