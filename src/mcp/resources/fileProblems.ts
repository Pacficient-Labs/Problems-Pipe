import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";

function encodeResourcePath(value: string): string {
  return value.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
}

function decodeResourcePath(value: string): string {
  return value
    .replace(/\\/g, "/")
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

  server.resource(
    "file-problems",
    template,
    { mimeType: "application/json" },
    async (uri, variables) => {
      const rawPath = Array.isArray(variables.path)
        ? variables.path.join("/")
        : variables.path;
      const path = decodeResourcePath(rawPath);
      const diagnostics = await store.getForFile(path);
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
  );
}
