import type { TextDiff } from "@knowledge/compute";
import type {
  DocumentAsset,
  KnowledgeNode,
  KnowledgePath,
  KnowledgeSpaceConsistencyClass,
} from "@knowledge/core";

export interface KnowledgeFsPreviewResultMetadata {
  readonly consistencyClass?: KnowledgeSpaceConsistencyClass;
  readonly preview?: boolean;
}

export type KnowledgeFsEntryKind = "directory" | "resource";

export interface KnowledgeFsEntry {
  readonly kind: KnowledgeFsEntryKind;
  readonly metadata: Record<string, unknown>;
  readonly name: string;
  readonly path: string;
  readonly resourceType?: KnowledgePath["resourceType"];
  readonly targetId?: string;
  readonly version?: number;
}

export interface KnowledgeFsListResult extends KnowledgeFsPreviewResultMetadata {
  readonly items: KnowledgeFsEntry[];
  readonly nextCursor?: string;
  readonly path: string;
  readonly truncated: boolean;
}

export interface KnowledgeFsTreeNode extends KnowledgeFsEntry {
  children?: KnowledgeFsTreeNode[];
}

export interface KnowledgeFsTreeResult extends KnowledgeFsPreviewResultMetadata {
  readonly nextCursor?: string;
  readonly path: string;
  readonly root: KnowledgeFsTreeNode;
  readonly truncated: boolean;
}

export interface KnowledgeFsCatResult {
  readonly contentType: string;
  readonly nextCursor?: string;
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface KnowledgeFsStatResult extends KnowledgeFsPreviewResultMetadata {
  readonly contentType?: string;
  readonly metadata: Record<string, unknown>;
  readonly path: string;
  readonly parserStatus?: DocumentAsset["parserStatus"];
  readonly resourceType: KnowledgePath["resourceType"];
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly targetId: string;
  readonly version?: number;
}

export interface KnowledgeFsWriteResult {
  readonly bytesWritten: number;
  readonly mode: "append" | "write";
  readonly objectKey: string;
  readonly path: string;
  readonly targetId: string;
  readonly version: number;
}

export interface KnowledgeFsGrepMatch {
  readonly endOffset: number;
  readonly kind: "node" | "segment";
  readonly metadata: Record<string, unknown>;
  readonly nodeId?: string;
  readonly path: string;
  readonly segmentId?: string;
  readonly snippet: string;
  readonly startOffset: number;
}

export interface KnowledgeFsGrepResult {
  readonly matches: KnowledgeFsGrepMatch[];
  readonly nextCursor?: string;
  readonly path: string;
  readonly truncated: boolean;
}

export interface KnowledgeFsDiffResult extends TextDiff {
  readonly mode: "line" | "word";
  readonly newPath: string;
  readonly oldPath: string;
  readonly semantic?: SemanticDiffSummary | undefined;
}

export interface SemanticDiffChange {
  category: string;
  evidence: string[];
  summary: string;
}

export interface SemanticDiffSummary {
  changes: SemanticDiffChange[];
  metadata: Record<string, unknown>;
  model?: string | undefined;
  summary: string;
}

export interface SemanticDiffInput extends TextDiff {
  readonly mode: "line" | "word";
  readonly newPath: string;
  readonly newText: string;
  readonly oldPath: string;
  readonly oldText: string;
}

export interface SemanticDiffProvider {
  summarize(input: SemanticDiffInput): Promise<SemanticDiffSummary>;
}

export interface KnowledgeFsOpenNodeResult {
  readonly citation: {
    readonly artifactHash: string;
    readonly documentAssetId: string;
    readonly endOffset: number;
    readonly pageNumber?: number;
    readonly parseArtifactId: string;
    readonly sectionPath: string[];
    readonly startOffset: number;
  };
  readonly node: KnowledgeNode;
}
