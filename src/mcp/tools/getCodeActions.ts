import * as vscode from "vscode";
import { z } from "zod";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiagnosticStore } from "../../diagnostics/index.js";
import { logError, logDebug } from "../../utils/index.js";

interface CodeActionInfo {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  diagnostics?: string[];
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !looksLikeWindowsPath(value);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || looksLikeWindowsPath(value);
}

async function resolveUriInput(input: string): Promise<string> {
  if (hasUriScheme(input)) return input;
  if (isAbsolutePath(input)) return vscode.Uri.file(input).toString();

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return input;
  if (folders.length === 1) {
    return vscode.Uri.joinPath(folders[0].uri, input).toString();
  }

  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, input);
    try {
      await vscode.workspace.fs.stat(candidate);
      return candidate.toString();
    } catch {
      // Try next workspace folder
    }
  }

  return vscode.Uri.joinPath(folders[0].uri, input).toString();
}

async function fetchCodeActions(
  uri: string,
  line?: number,
  character?: number
): Promise<CodeActionInfo[]> {
  try {
    const parsedUri = vscode.Uri.parse(uri);
    const doc = await vscode.workspace.openTextDocument(parsedUri);
    const diagnostics = vscode.languages.getDiagnostics(parsedUri);

    let range: vscode.Range;
    if (line != null) {
      const pos = new vscode.Position(line, character ?? 0);
      range = new vscode.Range(pos, pos);
    } else if (diagnostics.length > 0) {
      range = diagnostics[0].range;
    } else {
      return [];
    }

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      doc.uri,
      range
    );

    if (!actions) return [];

    return actions.map((a) => ({
      title: a.title,
      kind: a.kind?.value,
      isPreferred: a.isPreferred,
      diagnostics: a.diagnostics?.map((d) => d.message),
    }));
  } catch (err) {
    logError("Failed to fetch code actions", err);
    return [];
  }
}

export function registerGetCodeActions(
  server: McpServer,
  store: DiagnosticStore
): RegisteredTool {
  return server.tool(
    "get_code_actions",
    "Retrieve available quick fixes and code actions for a file or location",
    {
      uri: z.string().describe("File URI or relative path"),
      line: z.number().optional().describe("Line number (0-based)"),
      character: z.number().optional().describe("Character offset (0-based)"),
    },
    async (params) => {
      logDebug(`[Tool:get_code_actions] invoked — uri: ${params.uri}, line: ${params.line}, character: ${params.character}`);
      const uri = await resolveUriInput(params.uri);
      logDebug(`[Tool:get_code_actions] resolved URI: ${uri}`);

      const actions = await fetchCodeActions(uri, params.line, params.character);
      logDebug(`[Tool:get_code_actions] returning ${actions.length} action(s)`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(actions, null, 2),
          },
        ],
      };
    }
  );
}
