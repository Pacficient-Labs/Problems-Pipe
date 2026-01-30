import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

export function registerAllProblemsResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.resource("all-problems", "problems://all", { mimeType: "application/json" }, async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(store.getAll(), null, 2),
      },
    ],
  }));
}
