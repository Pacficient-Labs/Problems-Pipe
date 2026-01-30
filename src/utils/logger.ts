import * as vscode from "vscode";

type LogLevel = "off" | "error" | "warn" | "info" | "debug";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let channel: vscode.OutputChannel | undefined;
let currentLevel: LogLevel = "info";

export function initLogger(level: LogLevel): void {
  currentLevel = level;
  if (!channel) {
    channel = vscode.window.createOutputChannel("Problems Pipe");
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export function logError(message: string, error?: unknown): void {
  if (!shouldLog("error")) return;
  const suffix =
    error instanceof Error ? `: ${error.message}` : error ? `: ${error}` : "";
  channel?.appendLine(formatMessage("error", message + suffix));
}

export function logWarn(message: string): void {
  if (!shouldLog("warn")) return;
  channel?.appendLine(formatMessage("warn", message));
}

export function logInfo(message: string): void {
  if (!shouldLog("info")) return;
  channel?.appendLine(formatMessage("info", message));
}

export function logDebug(message: string): void {
  if (!shouldLog("debug")) return;
  channel?.appendLine(formatMessage("debug", message));
}

export function disposeLogger(): void {
  channel?.dispose();
  channel = undefined;
}
