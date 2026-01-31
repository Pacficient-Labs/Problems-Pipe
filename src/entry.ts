import type * as vscode from "vscode";
import { defineNavigatorShim } from "./utils/navigatorShim.js";

defineNavigatorShim();

let extensionModule: typeof import("./extension.js") | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  extensionModule = await import("./extension.js");
  return extensionModule.activate(context);
}

export function deactivate(): void {
  extensionModule?.deactivate?.();
}
