# Problems Pipe

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/a0a85ec0c51149be8810d6b9bd3004ed)](https://app.codacy.com/gh/Pacficient-Labs/Problems-Pipe?utm_source=github.com&utm_medium=referral&utm_content=Pacficient-Labs/Problems-Pipe&utm_campaign=Badge_Grade)

A VS Code extension that exposes the **Problems panel** (diagnostics) to AI assistants via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). It runs a local HTTP-based MCP server inside VS Code so that tools like Claude, Cursor, and other MCP-compatible clients can query, filter, and act on real-time compiler errors, lint warnings, and other diagnostics.

## Why

AI coding assistants work better when they can see the same diagnostics you see. Instead of copy-pasting error messages, Problems Pipe gives your assistant direct, structured access to everything in the Problems panel — complete with surrounding source code context, severity metadata, and available quick fixes.

## Features

- **Real-time diagnostics** — streams every error, warning, info, and hint from VS Code's Problems panel
- **Code context** — each diagnostic includes surrounding source lines for immediate understanding
- **Advanced filtering** — filter by severity, source (TypeScript, ESLint, etc.), file glob, code, or message regex
- **Code actions** — retrieve available quick fixes and refactorings for any diagnostic location
- **Aggregated summaries** — get problem counts grouped by severity, source, file, or workspace
- **Multi-workspace** — works across all folders in a multi-root workspace
- **AI prompts** — built-in MCP prompts for explaining and fixing errors

## Quick Start

1. Install the extension in VS Code
2. The MCP server starts automatically on `http://127.0.0.1:3030`
3. Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "problems-pipe": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3030/mcp"
    }
  }
}
```

> Use the command **Problems Pipe: Copy MCP Server Configuration** to copy this config to your clipboard.

### Client-specific setup

<details>
<summary><strong>Claude Code</strong></summary>

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "problems-pipe": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3030/mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "problems-pipe": {
      "url": "http://127.0.0.1:3030/mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>Cline</strong></summary>

Add to Cline's MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "problems-pipe": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3030/mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "problems-pipe": {
      "url": "http://127.0.0.1:3030/mcp"
    }
  }
}
```

</details>

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_problems` | Query diagnostics with filtering (severity, source, file glob, message regex), sorting, pagination, and optional code context |
| `get_file_problems` | Get all problems for a specific file, returned as formatted markdown |
| `get_problem_summary` | Aggregated statistics grouped by severity, source, file, or workspace |
| `get_code_actions` | Retrieve available quick fixes and code actions for a file location |

## MCP Resources

| URI | Description |
|-----|-------------|
| `problems://all` | All diagnostics as JSON |
| `problems://summary` | Aggregated statistics |
| `problems://file/{path}` | Problems for a specific file |
| `problems://errors` | Errors only |

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `fix-all-errors` | Lists all workspace errors for bulk fixing |
| `explain-error` | Explains a specific diagnostic and suggests fixes |

## Configuration

All settings are under `problemsPipe.*` in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable the extension |
| `autoStart` | `true` | Start MCP server automatically on VS Code startup |
| `transport` | `"http"` | Transport mechanism |
| `httpPort` | `3030` | Server port (1024–65535) |
| `httpHost` | `"127.0.0.1"` | Server bind address |
| `includeSources` | `[]` | Only include diagnostics from these sources (empty = all) |
| `excludeSources` | `[]` | Exclude diagnostics from these sources |
| `maxDiagnosticsPerFile` | `100` | Max diagnostics reported per file |
| `contextLines` | `3` | Number of surrounding source lines included with each diagnostic |
| `enableCodeActions` | `true` | Enable the code actions tool |
| `logLevel` | `"info"` | Logging level: `off`, `error`, `warn`, `info`, `debug` |

## Commands

- **Problems Pipe: Start MCP Server** — start the server manually
- **Problems Pipe: Stop MCP Server** — stop the server
- **Problems Pipe: Show Status** — display server status and diagnostics summary
- **Problems Pipe: Copy MCP Server Configuration** — copy client config JSON to clipboard

## Development

```bash
npm install          # install dependencies
npm run build        # build the extension
npm run watch        # build in watch mode
npm run test         # run tests
npm run test:watch   # run tests in watch mode
npm run lint         # lint source code
```

Press **F5** in VS Code to launch the Extension Development Host for debugging.

### Project Structure

```
src/
├── extension.ts          # Extension entry point
├── config/               # Configuration management
├── diagnostics/          # Diagnostic collection, storage, and enrichment
├── mcp/                  # MCP server, transport, tools, resources, prompts
├── ui/                   # Commands and status bar
├── utils/                # Logger, LRU cache, debounce
└── types/                # TypeScript type definitions
```

## Requirements

- VS Code 1.85.0 or later

## License

[MIT](LICENSE)
