import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { registerGetProblems } from "./getProblems.js";
import { registerGetProblemSummary } from "./getProblemSummary.js";
import { registerGetFileProblems } from "./getFileProblems.js";
import { registerGetCodeActions } from "./getCodeActions.js";

export function registerAllTools(
  server: McpServer,
  store: DiagnosticStore
): { codeActionsTool: RegisteredTool } {
  registerGetProblems(server, store);
  registerGetProblemSummary(server, store);
  registerGetFileProblems(server, store);
  const codeActionsTool = registerGetCodeActions(server, store);
  return { codeActionsTool };
}
