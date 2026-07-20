export type SourceFsEntryKind = "directory" | "object";

export interface SourceFsEntry {
  readonly contentType?: string;
  readonly kind: SourceFsEntryKind;
  readonly metadata: Record<string, string>;
  readonly name: string;
  readonly path: string;
  readonly sizeBytes?: number;
}

export interface SourceFsListResult {
  readonly items: SourceFsEntry[];
  readonly nextCursor?: string;
  readonly path: string;
  readonly truncated: boolean;
}

export interface SourceFsCatResult {
  readonly contentType?: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly text: string;
  readonly truncated: boolean;
}

export interface SourceFsGrepMatch {
  readonly contentType?: string;
  readonly endOffset: number;
  readonly metadata: Record<string, string>;
  readonly path: string;
  readonly sizeBytes: number;
  readonly snippet: string;
  readonly startOffset: number;
}

export interface SourceFsGrepResult {
  readonly matches: SourceFsGrepMatch[];
  readonly nextCursor?: string;
  readonly path: string;
  readonly truncated: boolean;
}
