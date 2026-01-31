
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logDebug } from "../../utils/index.js";

export function registerExplainErrorPrompt(
  server: McpServer,
  store: DiagnosticStore
): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "explain-error",
        description: "Explain a specific error and suggest how to fix it",
        arguments: [
          {
            name: "diagnosticId",
            description: "The diagnostic ID to explain",
            required: true,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "explain-error") {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }

    const diagnosticId = request.params.arguments?.diagnosticId as string;
    if (!diagnosticId) {
      throw new Error("diagnosticId argument is required");
    }

    logDebug(`[Prompt:explain-error] invoked — diagnosticId: ${diagnosticId}`);
      const diagnostic = store.getById(diagnosticId);
      if (!diagnostic) {
        logDebug(`[Prompt:explain-error] diagnostic not found: ${diagnosticId}`);
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Diagnostic with ID "${diagnosticId}" was not found. Use the get_problems tool to list current diagnostics and their IDs.`,
              },
            },
          ],
        };
      }

      const lines: string[] = [
        "Please explain this error and suggest how to fix it:",
        "",
        `**File:** ${diagnostic.relativePath}`,
        `**Line:** ${diagnostic.range.startLine + 1}`,
        `**Severity:** ${diagnostic.severity}`,
        `**Source:** ${diagnostic.source ?? "N/A"}`,
        `**Code:** ${diagnostic.code ?? "N/A"}`,
        "",
        `**Error Message:**`,
        diagnostic.message,
      ];

      if (diagnostic.contextLines) {
        lines.push("", "**Context:**", "```");
        for (const l of diagnostic.contextLines.before) {
          lines.push(l);
        }
        lines.push(`${diagnostic.contextLines.line}  // <-- ERROR HERE`);
        for (const l of diagnostic.contextLines.after) {
          lines.push(l);
        }
        lines.push("```");
      }

      if (diagnostic.relatedInformation.length > 0) {
        lines.push("", "**Related information:**");
        for (const ri of diagnostic.relatedInformation) {
          lines.push(`- ${ri.relativePath}:${ri.range.startLine + 1}: ${ri.message}`);
        }
      }

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: lines.join("\n"),
          },
        },
      ],
    };
  });
}
