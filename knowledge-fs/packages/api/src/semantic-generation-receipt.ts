import { createHash } from "node:crypto";

import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { stableJson } from "@knowledge/core";

export const MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES = 4 * 1024 * 1024;
export const MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_DATABASE_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_LLM_SEMANTIC_WINDOWS = 4_096;
export const MAX_LLM_SEMANTIC_COMPLETION_IDENTITIES = 64;
export const MAX_LLM_SEMANTIC_WINDOW_ID_CODE_POINTS = 32;
export const MAX_LLM_SEMANTIC_UNIT_ID_CODE_POINTS = 32;
export const MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS = 255;
export const MAX_LLM_SEMANTIC_FINISH_REASON_CODE_POINTS = 64;

const SHA256_FINGERPRINT = `sha256:${"f".repeat(64)}`;
const MAX_WINDOW_ID = `window-${"9".repeat(
  MAX_LLM_SEMANTIC_WINDOW_ID_CODE_POINTS - "window-".length,
)}`;
const MAX_UNIT_ID = `u-${"9".repeat(14)}-${"9".repeat(15)}`;
const MAX_TERMINAL_IDENTITY = "\u{1f600}".repeat(MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS);
const MAX_FINISH_REASON = "\u{1f600}".repeat(MAX_LLM_SEMANTIC_FINISH_REASON_CODE_POINTS);

export interface KnowledgeNodeSemanticGenerationConfig {
  readonly maxChunkChars: number;
  readonly maxNodes: number;
  readonly maxWindowChars: number;
  readonly overlapChars: number;
  readonly promptVersion: string;
}

export interface KnowledgeNodeGenerationCompletionReceipt {
  readonly actualModel?: string | undefined;
  readonly actualProvider?: string | undefined;
  readonly fingerprint: string;
  readonly finishReason?: string | undefined;
  readonly transportProvider?: string | undefined;
}

export type KnowledgeNodeGenerationUnitRangeReceipt = readonly [
  startUnitId: string,
  endUnitId: string,
];

export interface KnowledgeNodeGenerationWindowReceipt {
  readonly chunkRanges: readonly KnowledgeNodeGenerationUnitRangeReceipt[];
  readonly committedUnitRange: KnowledgeNodeGenerationUnitRangeReceipt;
  readonly completionIndex: number;
  readonly coreUnitRange: KnowledgeNodeGenerationUnitRangeReceipt;
  readonly firstChunkIndex: number;
  readonly inputFingerprint: string;
  readonly lookAheadUnitRange?: KnowledgeNodeGenerationUnitRangeReceipt | undefined;
  /** Opaque hash of the complete generated semantic response payload for this window. */
  readonly responseFingerprint: string;
  readonly windowId: string;
}

/**
 * Durable proof that semantic generation completed even when editorial exclusions persist no node
 * rows. Window entries deliberately contain only canonical replay fields; completion identities
 * are de-duplicated in a bounded catalog.
 */
export interface KnowledgeNodeGenerationReceipt {
  readonly artifactHash: string;
  readonly completionCatalog: readonly KnowledgeNodeGenerationCompletionReceipt[];
  readonly documentAssetId: string;
  readonly documentChunkCount: number;
  readonly excludedNodeOrdinals: readonly number[];
  readonly knowledgeSpaceId: string;
  readonly language?: string | undefined;
  readonly modelSelection: KnowledgeSpaceModelSelection;
  readonly parseArtifactId: string;
  readonly permissionScope: readonly string[];
  readonly promptResponseFingerprint: string;
  readonly publicationGenerationId: string;
  readonly requestFingerprint: string;
  readonly responseFingerprint: string;
  readonly schemaVersion: 1;
  readonly semanticConfig: KnowledgeNodeSemanticGenerationConfig;
  readonly storedNodeCount: number;
  readonly storedResponseFingerprint: string;
  readonly windowManifest: readonly KnowledgeNodeGenerationWindowReceipt[];
}

export function llmSemanticCompletionFingerprint(
  entry: Omit<KnowledgeNodeGenerationCompletionReceipt, "fingerprint">,
): string {
  return `sha256:${createHash("sha256")
    .update(
      stableJson({
        ...(entry.actualModel ? { actualModel: entry.actualModel } : {}),
        ...(entry.actualProvider ? { actualProvider: entry.actualProvider } : {}),
        ...(entry.finishReason ? { finishReason: entry.finishReason } : {}),
        ...(entry.transportProvider ? { transportProvider: entry.transportProvider } : {}),
      }),
    )
    .digest("hex")}`;
}

export function knowledgeNodeGenerationReceiptSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(stableJson(value)).byteLength;
}

/**
 * Exact upper bound for an admitted receipt. The caller supplies an envelope with the real ACL,
 * language, model selection, prompt version and exclusions plus empty dynamic arrays. Dynamic
 * bytes use the repository-enforced identifier/terminal caps, one chunk range per possible node,
 * and the maximum bounded completion catalog.
 */
export function maximumKnowledgeNodeGenerationReceiptSerializedBytes({
  emptyReceipt,
  maximumChunkCount,
  maximumWindowCount,
}: {
  readonly emptyReceipt: KnowledgeNodeGenerationReceipt;
  readonly maximumChunkCount: number;
  readonly maximumWindowCount: number;
}): number {
  if (emptyReceipt.completionCatalog.length !== 0 || emptyReceipt.windowManifest.length !== 0) {
    throw new Error("Semantic generation receipt admission requires empty dynamic arrays");
  }
  if (
    !Number.isSafeInteger(maximumChunkCount) ||
    maximumChunkCount < 0 ||
    !Number.isSafeInteger(maximumWindowCount) ||
    maximumWindowCount < 0 ||
    maximumWindowCount > MAX_LLM_SEMANTIC_WINDOWS ||
    maximumWindowCount > maximumChunkCount
  ) {
    throw new Error("Semantic generation receipt admission bounds are invalid");
  }

  const completionCount = Math.min(maximumWindowCount, MAX_LLM_SEMANTIC_COMPLETION_IDENTITIES);
  const maximumCompletion: KnowledgeNodeGenerationCompletionReceipt = {
    actualModel: MAX_TERMINAL_IDENTITY,
    actualProvider: MAX_TERMINAL_IDENTITY,
    fingerprint: SHA256_FINGERPRINT,
    finishReason: MAX_FINISH_REASON,
    transportProvider: MAX_TERMINAL_IDENTITY,
  };
  const completionBytes = knowledgeNodeGenerationReceiptSerializedBytes(maximumCompletion);
  const completionCatalogBytes = arraySerializedBytes(completionCount, completionBytes);

  const maximumWindow: KnowledgeNodeGenerationWindowReceipt = {
    chunkRanges: [],
    committedUnitRange: [MAX_UNIT_ID, MAX_UNIT_ID],
    completionIndex: Math.max(0, completionCount - 1),
    coreUnitRange: [MAX_UNIT_ID, MAX_UNIT_ID],
    firstChunkIndex: Math.max(0, maximumChunkCount - 1),
    inputFingerprint: SHA256_FINGERPRINT,
    lookAheadUnitRange: [MAX_UNIT_ID, MAX_UNIT_ID],
    responseFingerprint: SHA256_FINGERPRINT,
    windowId: MAX_WINDOW_ID,
  };
  const emptyWindowBytes = knowledgeNodeGenerationReceiptSerializedBytes(maximumWindow);
  const rangeBytes = knowledgeNodeGenerationReceiptSerializedBytes([MAX_UNIT_ID, MAX_UNIT_ID]);
  // Every admitted window has at least one chunk. Across all window chunk arrays, JSON contributes
  // one bracket/comma byte per window plus (rangeBytes + separator) per possible document chunk.
  const allChunkRangeArraysBytes = maximumWindowCount + maximumChunkCount * (rangeBytes + 1);
  const windowObjectsBytes = maximumWindowCount * (emptyWindowBytes - 2) + allChunkRangeArraysBytes;
  const windowManifestBytes =
    maximumWindowCount === 0 ? 2 : 2 + windowObjectsBytes + (maximumWindowCount - 1);
  const emptyReceiptBytes = knowledgeNodeGenerationReceiptSerializedBytes(emptyReceipt);

  return emptyReceiptBytes - 4 + completionCatalogBytes + windowManifestBytes;
}

function arraySerializedBytes(itemCount: number, itemBytes: number): number {
  return itemCount === 0 ? 2 : 2 + itemCount * itemBytes + (itemCount - 1);
}
