import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { registerAllProblemsResource } from "./allProblems.js";
import { registerFileProblemsResource } from "./fileProblems.js";
import { registerSummaryResource } from "./summary.js";
import { registerErrorsOnlyResource } from "./errorsOnly.js";

export function registerAllResources(
  server: McpServer,
  store: DiagnosticStore
): void {
  registerAllProblemsResource(server, store);
  registerFileProblemsResource(server, store);
  registerSummaryResource(server, store);
  registerErrorsOnlyResource(server, store);
}
