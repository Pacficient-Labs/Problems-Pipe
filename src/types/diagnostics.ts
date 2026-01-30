export interface DiagnosticRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface ContextLines {
  before: string[];
  line: string;
  after: string[];
}

export interface RelatedInformation {
  uri: string;
  relativePath: string;
  range: DiagnosticRange;
  message: string;
}

export type Severity = "error" | "warning" | "information" | "hint";

export type DiagnosticTag = "unnecessary" | "deprecated";

export interface EnrichedDiagnostic {
  id: string;
  uri: string;
  relativePath: string;
  range: DiagnosticRange;
  message: string;
  severity: Severity;
  source?: string;
  code?: string | number;
  codeDescription?: { href: string };
  tags: DiagnosticTag[];
  relatedInformation: RelatedInformation[];
  contextLines?: ContextLines;
  timestamp: string;
  workspaceFolder?: string;
}

export interface DiagnosticQuery {
  uri?: string;
  uriPattern?: string;
  severity?: Severity[];
  source?: string[];
  code?: (string | number)[];
  messagePattern?: string;
  workspaceFolder?: string;
  limit?: number;
  offset?: number;
  sortBy?: "severity" | "file" | "timestamp" | "source";
  sortOrder?: "asc" | "desc";
  includeContext?: boolean;
  contextLines?: number;
}

export type SummaryGroupBy = "severity" | "source" | "file" | "workspace";

export interface SummaryGroup {
  count: number;
  files: string[];
}

export interface DiagnosticSummary {
  total: number;
  byGroup: Record<string, SummaryGroup>;
  timestamp: string;
}
