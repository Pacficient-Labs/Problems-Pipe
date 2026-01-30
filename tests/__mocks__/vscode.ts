/**
 * Minimal VS Code API mock for unit tests.
 * Only the surface area actually used by the source code is mocked.
 */

// ---------------------------------------------------------------------------
// Mutable test state – tests manipulate these directly, and the mock
// implementations read from them.
// ---------------------------------------------------------------------------

/** Raw diagnostics keyed by URI string (e.g. "file:///workspace/src/a.ts"). */
export const _diagnostics = new Map<string, any[]>();

/** File text content keyed by URI string – consumed by openTextDocument. */
export const _fileContents = new Map<string, string>();

/** Helper to seed diagnostics for tests without accessing the map directly. */
export function _setDiagnostics(uri: string, diagnostics: any[]): void {
  _diagnostics.set(uri, diagnostics);
}

/** Helper to seed file contents for tests without accessing the map directly. */
export function _setFileContents(uri: string, text: string): void {
  _fileContents.set(uri, text);
}

/** Reset all mutable state between tests. */
export function _reset(): void {
  _diagnostics.clear();
  _fileContents.clear();
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

export class Uri {
  private _raw: string;

  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
    raw?: string,
  ) {
    this._raw =
      raw ?? (scheme === "file" ? `file://${path}` : `${scheme}://${authority}${path}`);
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return this._raw;
  }

  with(_change: Record<string, string>): Uri {
    return this;
  }

  static parse(value: string): Uri {
    try {
      const url = new URL(value);
      return new Uri(
        url.protocol.replace(":", ""),
        url.hostname,
        decodeURIComponent(url.pathname),
        url.search,
        url.hash,
        value,
      );
    } catch {
      return Uri.file(value);
    }
  }

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "", `file://${fsPath}`);
  }
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export const DiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
} as const;

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

export class EventEmitter<T = any> {
  private listeners: Array<(data: T) => void> = [];

  event = (listener: (data: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  };
  fire(data: T): void {
    const snapshot = this.listeners.slice();
    for (const listener of snapshot) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

export const workspace = {
  workspaceFolders: [
    { name: "workspace", uri: Uri.file("/workspace"), index: 0 },
  ] as any[],

  getWorkspaceFolder: (uri: any) => {
    const p: string = uri?.fsPath ?? uri?.path ?? "";
    if (p.startsWith("/workspace")) {
      return { name: "workspace", uri: Uri.file("/workspace"), index: 0 };
    }
    return undefined;
  },

  asRelativePath: (uri: any, _includeRoot?: boolean) => {
    const p: string = typeof uri === "string" ? uri : uri?.fsPath ?? uri?.path ?? "";
    const prefix = "/workspace/";
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    return p;
  },

  onDidChangeTextDocument: (_listener: any) => ({ dispose: () => {} }),

  onDidChangeConfiguration: (_listener: any) => ({ dispose: () => {} }),

  getConfiguration: (_section?: string) => ({
    get: (_key: string, defaultValue: any) => defaultValue,
  }),

  openTextDocument: async (uri: any) => {
    const key = typeof uri === "string" ? uri : uri.toString();
    const text = _fileContents.get(key) ?? "";
    return { getText: () => text };
  },
};

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------

export const languages = {
  getDiagnostics: (uri?: any): any => {
    if (uri) {
      return _diagnostics.get(uri.toString()) ?? [];
    }
    // No-arg overload returns [Uri, Diagnostic[]][]
    return [..._diagnostics.entries()].map(([uriStr, diags]) => [
      Uri.parse(uriStr),
      diags,
    ]);
  },

  onDidChangeDiagnostics: (_listener: any) => ({ dispose: () => {} }),
};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  showInformationMessage: async (..._args: any[]) => undefined,
  showWarningMessage: async (..._args: any[]) => undefined,
  showErrorMessage: async (..._args: any[]) => undefined,
  createStatusBarItem: () => ({
    show: () => {},
    hide: () => {},
    dispose: () => {},
    text: "",
    tooltip: "",
    command: "",
    backgroundColor: undefined,
  }),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export const commands = {
  registerCommand: (_id: string, _handler: any) => ({ dispose: () => {} }),
  executeCommand: async (..._args: any[]) => undefined,
};

// ---------------------------------------------------------------------------
// Misc types / stubs
// ---------------------------------------------------------------------------

export class ThemeColor {
  constructor(public id: string) {}
}

export class StatusBarAlignment {
  static readonly Left = 1;
  static readonly Right = 2;
}

export class Range {
  constructor(
    public start: { line: number; character: number },
    public end: { line: number; character: number },
  ) {}
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Disposable {
  constructor(private _callOnDispose: () => void) {}
  dispose() {
    this._callOnDispose();
  }
}
