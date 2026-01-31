import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logDebug } from "../../utils/index.js";

function encodeResourcePath(value: string): string {
  return value.replaceAll('\\', "/").split("/").map(encodeURIComponent).join("/");
}

function decodeResourcePath(value: string): string {
  return value
    .replaceAll('\\', "/")
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export function registerFileProblemsResource(
  server: McpServer,
  store: DiagnosticStore
): void {
  const template = new ResourceTemplate("problems://file/{+path}", {
    list: async () => ({
      resources: store.getFilesWithProblems().map((f) => ({
        uri: `problems://file/${encodeResourcePath(f)}`,
        name: `Problems in ${f}`,
        mimeType: "application/json",
      })),
    }),
  });

  server.resource({
    name: "file-problems",
    template,
    metadata: { mimeType: "application/json" },
    read: async (ctx) => {
      const variables = ctx.variables;
      const uri = ctx.uri;
      const rawPath = Array.isArray(variables.path)
        ? variables.path.join("/")
        : variables.path;
      const path = decodeResourcePath(rawPath);
      logDebug(`[Resource:file-problems] accessed — path: ${path}`);
      const diagnostics = await store.getForFile(path);
      logDebug(`[Resource:file-problems] returning ${diagnostics.length} diagnostic(s)`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(diagnostics, null, 2),
          },
        ],
      };
    }
  });
}
