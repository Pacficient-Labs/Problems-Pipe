import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { registerFixAllErrorsPrompt } from "./fixAllErrors.js";
import { registerExplainErrorPrompt } from "./explainError.js";

export function registerAllPrompts(
  server: McpServer,
  store: DiagnosticStore
): void {
  registerFixAllErrorsPrompt(server, store);
  registerExplainErrorPrompt(server, store);
}
