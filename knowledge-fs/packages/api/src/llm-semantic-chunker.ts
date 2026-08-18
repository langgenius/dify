import { createHash } from "node:crypto";

import {
  DateTimeSchema,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceModelSelectionSchema,
  type KnowledgeSpaceRetrievalProfile,
  type ParseArtifact,
  stableJson,
} from "@knowledge/core";
import {
  countGraphemes as countUnicodeGraphemes,
  graphemeSegments,
} from "unicode-segmenter/grapheme";
import { z } from "zod";

import { deterministicChildId } from "./api-shared-utils";
import { type ConcurrencyGate, mapWithConcurrency } from "./bounded-concurrency";
import {
  type DocumentLayoutRecompositionStats,
  recomposeDocumentLayoutForSemanticSegmentation,
} from "./document-layout-recomposer";
import { type DocumentModelBudget, estimateDocumentModelTokens } from "./document-model-budget";
import {
  DOCUMENT_ELEMENT_SEPARATOR,
  DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
  DOCUMENT_OFFSET_ENCODING,
  materializeDocumentElementByteSpan,
} from "./document-offsets";
import type {
  DocumentSemanticWindowCheckpoint,
  DocumentSemanticWindowCheckpointRepository,
  DocumentSemanticWindowCheckpointScope,
} from "./document-semantic-window-checkpoint-repository";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  MAX_LLM_SEMANTIC_COMPLETION_IDENTITIES as MAX_COMPLETION_CATALOG_ENTRIES,
  MAX_LLM_SEMANTIC_FINISH_REASON_CODE_POINTS as MAX_COMPLETION_FINISH_REASON_CHARS,
  MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS as MAX_COMPLETION_MODEL_CHARS,
  MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS as MAX_COMPLETION_PROVIDER_CHARS,
  MAX_LLM_SEMANTIC_WINDOWS as MAX_RECEIPT_SEMANTIC_WINDOWS,
  MAX_LLM_SEMANTIC_UNIT_ID_CODE_POINTS as MAX_SEMANTIC_UNIT_ID_CHARS,
  MAX_LLM_SEMANTIC_WINDOW_ID_CODE_POINTS as MAX_SEMANTIC_WINDOW_ID_CHARS,
  llmSemanticCompletionFingerprint,
} from "./semantic-generation-receipt";

export { llmSemanticCompletionFingerprint } from "./semantic-generation-receipt";

const DEFAULT_MAX_CHUNK_CHARS = 1_200;
const DEFAULT_MAX_WINDOW_CHARS = 4_800;
const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_ENTITIES_PER_CHUNK = 100;
const DEFAULT_MAX_RELATIONS_PER_CHUNK = 100;
const DEFAULT_MAX_OUTPUT_TOKENS = 6_000;
const DEFAULT_MAX_RESPONSE_CHARS = 1_000_000;
const DEFAULT_PROMPT_VERSION = "semantic-chunking-v4";
const SEMANTIC_CHUNKING_V2_PROMPT_VERSION = "semantic-chunking-v2";
const SEMANTIC_CHUNKING_V3_PROMPT_VERSION = "semantic-chunking-v3";
const V3_MAX_CORE_UNITS_PER_WINDOW = 32;
const V3_MAX_LOOK_AHEAD_UNITS_PER_WINDOW = 8;
const DEFAULT_MAX_CONCURRENT_WINDOWS = 4;
const MAX_CONCURRENT_WINDOWS = 32;
const SEMANTIC_CHUNKING_STRATEGY = "llm-semantic-v1";
const SEMANTIC_CHUNKING_SCHEMA_VERSION = 1;
/**
 * Pre-provider admission under the 4 MiB compact receipt budget. With 20,000 range tuples, 4,096
 * windows, 64 deduplicated completions, bounded IDs/terminal fields, and worst-case UTF-8 expansion,
 * the receipt's deterministic portion remains below 4 MiB. The receipt layer additionally admits
 * the exact request envelope and enforces exact serialized bytes.
 */
export const DEFAULT_MAX_SEMANTIC_WINDOWS = MAX_RECEIPT_SEMANTIC_WINDOWS;
export const MAX_LLM_SEMANTIC_WINDOWS = DEFAULT_MAX_SEMANTIC_WINDOWS;
const encoder = new TextEncoder();

export interface SemanticChunkingLlmMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface SemanticChunkingLlmStreamInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly SemanticChunkingLlmMessage[];
  readonly model: string;
  readonly signal?: AbortSignal | undefined;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface SemanticChunkingLlmStreamEvent {
  readonly delta?: string | undefined;
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly type: "delta" | "done";
}

/** Structural subset of the generation provider, kept independent from `@knowledge/generation`. */
export interface SemanticChunkingLlmProvider {
  readonly kind?: string | undefined;
  stream(input: SemanticChunkingLlmStreamInput): AsyncIterable<SemanticChunkingLlmStreamEvent>;
}

export interface SemanticChunkerInput {
  readonly config?:
    | {
        readonly maxChunkChars?: number | undefined;
        readonly maxNodes?: number | undefined;
        readonly maxWindowChars?: number | undefined;
        /** Legacy document setting retained as provenance; semantic output never overlaps. */
        readonly overlapChars?: number | undefined;
      }
    | undefined;
  readonly knowledgeSpaceId: string;
  readonly modelBudget?: DocumentModelBudget | undefined;
  /** Suppresses graph extraction work in the model prompt when graph materialization is disabled. */
  readonly enableGraph?: boolean | undefined;
  /** Suppresses PageIndex-only section expansion and summaries when PageIndex is disabled. */
  readonly enablePageIndex?: boolean | undefined;
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope?: readonly string[] | undefined;
  readonly publicationGenerationId?: string | undefined;
  /** Frozen profile revision for the candidate publication being compiled. */
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId?: string | undefined;
}

export interface SemanticChunker {
  readonly replayDefaults?:
    | {
        readonly maxChunkChars: number;
        readonly maxWindowChars: number;
        readonly promptVersion: string;
      }
    | undefined;
  chunk(input: SemanticChunkerInput): Promise<KnowledgeNode[]>;
}

export interface LlmSemanticChunkerOptions {
  readonly checkpoints?: DocumentSemanticWindowCheckpointRepository | undefined;
  readonly maxChunkChars?: number | undefined;
  readonly maxConcurrentWindows?: number | undefined;
  readonly maxEntitiesPerChunk?: number | undefined;
  readonly maxNodes?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly maxRelationsPerChunk?: number | undefined;
  readonly maxResponseChars?: number | undefined;
  readonly maxWindowChars?: number | undefined;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly now?: (() => string) | undefined;
  readonly promptVersion?: string | undefined;
  readonly reasoningProviderFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => SemanticChunkingLlmProvider;
  readonly temperature?: number | undefined;
}

export interface LlmSemanticGenerationReplayAssertionInput {
  readonly config?:
    | {
        readonly maxChunkChars?: number | undefined;
        readonly maxNodes?: number | undefined;
        readonly maxWindowChars?: number | undefined;
        readonly overlapChars?: number | undefined;
      }
    | undefined;
  readonly excludedNodeOrdinals?: readonly number[] | ReadonlySet<number> | undefined;
  readonly language?: string | undefined;
  readonly modelSelection: KnowledgeSpaceModelSelection;
  readonly nodes: readonly KnowledgeNode[];
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope?: readonly string[] | undefined;
  readonly promptVersion?: string | undefined;
  readonly publicationGenerationId?: string | undefined;
}

export interface LlmSemanticCompletionCatalogEntry {
  readonly actualModel?: string | undefined;
  readonly actualProvider?: string | undefined;
  readonly fingerprint: string;
  readonly finishReason?: string | undefined;
  readonly transportProvider?: string | undefined;
}

export type LlmSemanticUnitRangeTuple = readonly [startUnitId: string, endUnitId: string];

export interface LlmSemanticWindowManifestEntry {
  readonly chunkRanges: readonly LlmSemanticUnitRangeTuple[];
  readonly committedUnitRange: LlmSemanticUnitRangeTuple;
  readonly completionIndex: number;
  readonly coreUnitRange: LlmSemanticUnitRangeTuple;
  readonly firstChunkIndex: number;
  readonly inputFingerprint: string;
  readonly lookAheadUnitRange?: LlmSemanticUnitRangeTuple | undefined;
  /** Generation-time commitment to the full semantic payload; not canonical from parser input. */
  readonly responseFingerprint: string;
  readonly windowId: string;
}

export interface LlmSemanticWindowManifestReplayAssertionInput {
  readonly completionCatalog: readonly LlmSemanticCompletionCatalogEntry[];
  readonly config?:
    | {
        readonly maxChunkChars?: number | undefined;
        readonly maxNodes?: number | undefined;
        readonly maxWindowChars?: number | undefined;
        readonly overlapChars?: number | undefined;
      }
    | undefined;
  readonly documentChunkCount: number;
  readonly modelSelection: KnowledgeSpaceModelSelection;
  readonly parseArtifact: ParseArtifact;
  readonly promptVersion?: string | undefined;
  readonly windowManifest: readonly LlmSemanticWindowManifestEntry[];
}

export interface LlmSemanticWindowPreflightInput {
  readonly config?: SemanticChunkerInput["config"] | undefined;
  readonly parseArtifact: ParseArtifact;
  readonly promptVersion?: string | undefined;
}

export interface LlmSemanticWindowPreflightResult {
  readonly maximumWindowCount: number;
  readonly unitCount: number;
}

interface EffectiveChunkConfig {
  readonly maxChunkChars: number;
  readonly maxNodes: number;
  readonly maxWindowChars: number;
  readonly requestedOverlapChars: number;
}

interface MaterializedElement {
  readonly elementId: string;
  readonly elementIndex: number;
  readonly elementMetadata: Record<string, unknown>;
  readonly elementType: ParseArtifact["elements"][number]["type"];
  readonly endCodeUnit: number;
  readonly endOffset: number;
  readonly pageNumber?: number | undefined;
  readonly sectionPath: readonly string[];
  readonly startCodeUnit: number;
  readonly startOffset: number;
  readonly text: string;
}

interface AtomicUnit {
  readonly elementId: string;
  readonly elementMetadata: Record<string, unknown>;
  readonly elementType: ParseArtifact["elements"][number]["type"];
  readonly endCodeUnit: number;
  readonly endOffset: number;
  readonly graphemeLength: number;
  readonly id: string;
  readonly isolationKey?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly sectionPath: readonly string[];
  readonly startCodeUnit: number;
  readonly startOffset: number;
  readonly text: string;
}

interface SemanticWindow {
  readonly atomicDocument: boolean;
  readonly id: string;
  readonly inputFingerprint: string;
  readonly lookAheadUnits: readonly AtomicUnit[];
  readonly planningVersion: SemanticWindowPlanningVersion;
  readonly sectionPath: readonly string[];
  /** Deterministic core units which must be covered by this request. */
  readonly units: readonly AtomicUnit[];
}

type SemanticWindowPlanningVersion = "v1" | "v2" | "v3" | "v4";

interface SemanticWindowPlanningPolicy {
  readonly atomicDocument: boolean;
  readonly version: SemanticWindowPlanningVersion;
}

interface MaterializedChunk {
  readonly completion: ProviderCompletionProvenance;
  readonly endUnitId: string;
  readonly entities: readonly LlmSemanticEntity[];
  readonly kind: KnowledgeNode["kind"];
  readonly relations: readonly MaterializedSemanticRelation[];
  readonly sectionPath: readonly string[];
  readonly sectionSummary?: string | undefined;
  readonly startUnitId: string;
  readonly units: readonly AtomicUnit[];
  readonly window: SemanticWindow;
  readonly windowCommitEndUnitId: string;
}

type WindowMaterializedChunk = Omit<MaterializedChunk, "completion">;
type UncommittedWindowChunk = Omit<WindowMaterializedChunk, "windowCommitEndUnitId">;

interface MaterializedSemanticRelation {
  readonly confidence: number;
  readonly object: string;
  readonly objectEntityId: string;
  readonly subject: string;
  readonly subjectEntityId: string;
  readonly type: z.infer<typeof RelationTypeSchema>;
}

interface ProviderCompletionProvenance {
  readonly actualModel?: string | undefined;
  readonly actualProvider?: string | undefined;
  readonly finishReason?: string | undefined;
}

interface CollectedProviderCompletion extends ProviderCompletionProvenance {
  readonly metadata?: unknown;
  readonly text: string;
}

export function preflightLlmSemanticWindows({
  config,
  parseArtifact,
  promptVersion = DEFAULT_PROMPT_VERSION,
}: LlmSemanticWindowPreflightInput): LlmSemanticWindowPreflightResult {
  if (!promptVersion.trim()) {
    throw new Error("LLM semantic chunking preflight promptVersion is required");
  }
  const effectiveConfig = resolveConfig(config, {
    maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
    maxNodes: DEFAULT_MAX_NODES,
    maxWindowChars: DEFAULT_MAX_WINDOW_CHARS,
    requestedOverlapChars: 0,
  });
  const { canonicalText, elements } = materializeElements(parseArtifact);
  const units = materializeAtomicUnits(elements, effectiveConfig.maxChunkChars);
  const planningPolicy = resolveSemanticWindowPlanningPolicy({
    canonicalText,
    maxChunkChars: effectiveConfig.maxChunkChars,
    promptVersion,
    units,
  });
  return preflightMaterializedSemanticWindows({
    canonicalText,
    effectiveConfig,
    planningPolicy,
    units,
  });
}

/**
 * Creates a profile-aware semantic chunker. `maxChunkChars` is a hard Unicode-grapheme cap, not a
 * target fill size: the LLM may choose any smaller complete semantic range.
 */
export function createLlmSemanticChunker({
  checkpoints,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
  maxConcurrentWindows = DEFAULT_MAX_CONCURRENT_WINDOWS,
  maxEntitiesPerChunk = DEFAULT_MAX_ENTITIES_PER_CHUNK,
  maxNodes = DEFAULT_MAX_NODES,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  maxRelationsPerChunk = DEFAULT_MAX_RELATIONS_PER_CHUNK,
  maxResponseChars = DEFAULT_MAX_RESPONSE_CHARS,
  maxWindowChars = DEFAULT_MAX_WINDOW_CHARS,
  metrics,
  modelRequestGate,
  now = () => new Date().toISOString(),
  promptVersion = DEFAULT_PROMPT_VERSION,
  reasoningProviderFactory,
  temperature = 0,
}: LlmSemanticChunkerOptions): SemanticChunker {
  validatePositiveInteger("maxChunkChars", maxChunkChars);
  validatePositiveInteger("maxConcurrentWindows", maxConcurrentWindows);
  validatePositiveInteger("maxEntitiesPerChunk", maxEntitiesPerChunk);
  validatePositiveInteger("maxNodes", maxNodes);
  validatePositiveInteger("maxOutputTokens", maxOutputTokens);
  validatePositiveInteger("maxRelationsPerChunk", maxRelationsPerChunk);
  validatePositiveInteger("maxResponseChars", maxResponseChars);
  validatePositiveInteger("maxWindowChars", maxWindowChars);
  if (maxWindowChars < maxChunkChars) {
    throw new Error("LLM semantic chunking maxWindowChars must be at least maxChunkChars");
  }
  if (maxConcurrentWindows > MAX_CONCURRENT_WINDOWS) {
    throw new Error(
      `LLM semantic chunking maxConcurrentWindows must be at most ${MAX_CONCURRENT_WINDOWS}`,
    );
  }
  if (!promptVersion.trim()) {
    throw new Error("LLM semantic chunking promptVersion is required");
  }
  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM semantic chunking temperature must be non-negative");
  }

  return {
    replayDefaults: { maxChunkChars, maxWindowChars, promptVersion },
    chunk: async (input) => {
      input.signal?.throwIfAborted();
      const effectiveConfig = resolveConfig(input.config, {
        maxChunkChars,
        maxNodes,
        maxWindowChars,
        requestedOverlapChars: 0,
      });
      const { canonicalText, elements, layoutRecomposition } = materializeElements(
        input.parseArtifact,
      );
      if (elements.length === 0) {
        return [];
      }

      const units = materializeAtomicUnits(elements, effectiveConfig.maxChunkChars);
      const planningPolicy = resolveSemanticWindowPlanningPolicy({
        canonicalText,
        maxChunkChars: effectiveConfig.maxChunkChars,
        promptVersion,
        units,
      });
      preflightMaterializedSemanticWindows({
        canonicalText,
        effectiveConfig,
        planningPolicy,
        units,
      });
      const reasoningSelection = input.retrievalProfile.reasoningModel;
      const modelFingerprint = semanticWindowModelFingerprint({
        enableGraph: input.enableGraph !== false,
        enablePageIndex: input.enablePageIndex !== false,
        promptVersion,
        selection: reasoningSelection,
      });
      const checkpointScope = semanticWindowCheckpointScope(input, checkpoints);
      const provider = reasoningProviderFactory(reasoningSelection);
      assertBoundedOptionalCompletionField(
        provider.kind,
        "transportProvider",
        MAX_COMPLETION_PROVIDER_CHARS,
        "terminal",
      );
      const chunks: MaterializedChunk[] = [];
      const completionFingerprints = new Set<string>();
      const globalUnitIndex = new Map(units.map((unit, index) => [unit.id, index]));
      let nextUnitIndex = 0;
      let windowIndex = 0;

      const processWindow = async (window: SemanticWindow) => {
        input.signal?.throwIfAborted();
        const messages = semanticChunkingMessages({
          enableGraph: input.enableGraph !== false,
          enablePageIndex: input.enablePageIndex !== false,
          maxChunkChars: effectiveConfig.maxChunkChars,
          maxEntitiesPerChunk,
          maxRelationsPerChunk,
          window,
        });
        const callStartedAt = Date.now();
        let completion: CollectedProviderCompletion | undefined;
        let checkpointHit = false;
        try {
          const stored = checkpointScope
            ? await checkpoints?.get({
                key: { inputFingerprint: window.inputFingerprint, windowId: window.id },
                scope: checkpointScope,
              })
            : null;
          if (stored) {
            if (stored.modelFingerprint !== modelFingerprint) {
              throw new Error("Semantic window checkpoint model fingerprint changed");
            }
            completion = semanticCompletionFromCheckpoint(stored);
            checkpointHit = true;
          } else {
            input.modelBudget?.reserve({
              estimatedTokens:
                estimateDocumentModelTokens(JSON.stringify(messages)) + maxOutputTokens,
              itemCount: window.units.length,
              stage: "semantic-chunking",
            });
            const request = () =>
              collectProviderCompletion({
                maxOutputTokens,
                maxResponseChars,
                messages,
                model: reasoningSelection.model,
                provider,
                ...(input.signal ? { signal: input.signal } : {}),
                temperature,
                tenantId: input.tenantId,
              });
            completion = modelRequestGate ? await modelRequestGate.run(request) : await request();
          }
          input.signal?.throwIfAborted();
          if (!completion) {
            throw new Error("LLM semantic chunking provider returned no completion");
          }
          const resolvedCompletion = completion;
          const completionFingerprint = llmSemanticCompletionFingerprint({
            ...(resolvedCompletion.actualModel
              ? { actualModel: resolvedCompletion.actualModel }
              : {}),
            ...(resolvedCompletion.actualProvider
              ? { actualProvider: resolvedCompletion.actualProvider }
              : {}),
            ...(resolvedCompletion.finishReason
              ? { finishReason: resolvedCompletion.finishReason }
              : {}),
            ...(provider.kind ? { transportProvider: provider.kind } : {}),
          });
          const output = parseSemanticChunkingOutput(resolvedCompletion.text);
          const windowChunks = validateAndMaterializeWindowOutput({
            maxChunkChars: effectiveConfig.maxChunkChars,
            maxEntitiesPerChunk,
            maxRelationsPerChunk,
            output,
            window,
          }).map((chunk) => ({
            ...chunk,
            completion: {
              ...(resolvedCompletion.actualModel
                ? { actualModel: resolvedCompletion.actualModel }
                : {}),
              ...(resolvedCompletion.actualProvider
                ? { actualProvider: resolvedCompletion.actualProvider }
                : {}),
              ...(resolvedCompletion.finishReason
                ? { finishReason: resolvedCompletion.finishReason }
                : {}),
            },
          }));
          const committedEndUnitId = windowChunks.at(-1)?.windowCommitEndUnitId;
          const committedEndIndex = committedEndUnitId
            ? globalUnitIndex.get(committedEndUnitId)
            : undefined;
          const coreStartIndex = globalUnitIndex.get((window.units[0] as AtomicUnit).id);
          if (
            committedEndIndex === undefined ||
            coreStartIndex === undefined ||
            committedEndIndex < coreStartIndex
          ) {
            throw new Error("LLM semantic chunking response did not advance the document cursor");
          }
          if (!checkpointHit && checkpointScope && checkpoints) {
            await checkpoints.put({
              checkpoint: {
                completion: semanticCompletionCheckpointMetadata(resolvedCompletion),
                inputFingerprint: window.inputFingerprint,
                modelFingerprint,
                responseText: resolvedCompletion.text,
                windowId: window.id,
              },
              scope: checkpointScope,
            });
          }
          recordIngestionModelCallMetric(metrics, {
            cacheHits: checkpointHit ? 1 : 0,
            durationMs: Math.max(0, Date.now() - callStartedAt),
            itemCount: window.units.length,
            outcome: "succeeded",
            providerCalls: checkpointHit ? 0 : 1,
            retries: 0,
            stage: "semantic-chunking",
            ...(checkpointHit ? {} : ingestionModelUsageFromMetadata(resolvedCompletion.metadata)),
          });
          return { committedEndIndex, completionFingerprint, window, windowChunks };
        } catch (error) {
          recordIngestionModelCallMetric(metrics, {
            cacheHits: checkpointHit ? 1 : 0,
            durationMs: Math.max(0, Date.now() - callStartedAt),
            itemCount: window.units.length,
            outcome: "failed",
            providerCalls: checkpointHit ? 0 : 1,
            retries: 0,
            stage: "semantic-chunking",
            ...(checkpointHit || !completion
              ? {}
              : ingestionModelUsageFromMetadata(completion.metadata)),
          });
          throw error;
        }
      };

      const appendProcessedWindow = (
        processed: Awaited<ReturnType<typeof processWindow>>,
      ): void => {
        const coreStartIndex = globalUnitIndex.get((processed.window.units[0] as AtomicUnit).id);
        if (coreStartIndex !== nextUnitIndex) {
          throw new Error("LLM semantic chunking windows did not preserve document order");
        }
        completionFingerprints.add(processed.completionFingerprint);
        if (completionFingerprints.size > MAX_COMPLETION_CATALOG_ENTRIES) {
          throw new Error(
            `LLM semantic chunking completion identities exceed maxCompletionCatalogEntries=${MAX_COMPLETION_CATALOG_ENTRIES}`,
          );
        }
        if (chunks.length + processed.windowChunks.length > effectiveConfig.maxNodes) {
          throw new Error(
            `LLM semantic chunking output exceeds maxNodes=${effectiveConfig.maxNodes}`,
          );
        }
        chunks.push(...processed.windowChunks);
        nextUnitIndex = processed.committedEndIndex + 1;
        windowIndex += 1;
      };

      if (planningPolicy.version === "v4") {
        const windows = materializeDeterministicSemanticWindows({
          canonicalText,
          effectiveConfig,
          planningPolicy,
          units,
        });
        const processed = await mapWithConcurrency(windows, maxConcurrentWindows, async (window) =>
          processWindow(window),
        );
        for (const result of processed) appendProcessedWindow(result);
      } else {
        while (nextUnitIndex < units.length) {
          const window = materializeSemanticWindow({
            canonicalText,
            maxChunkChars: effectiveConfig.maxChunkChars,
            maxWindowChars: effectiveConfig.maxWindowChars,
            planningPolicy,
            startUnitIndex: nextUnitIndex,
            units,
            windowIndex,
          });
          appendProcessedWindow(await processWindow(window));
        }
      }

      const extractedAt = now();
      return chunks.map((chunk, chunkIndex) =>
        materializeKnowledgeNode({
          canonicalText,
          chunk,
          chunkIndex,
          documentChunkCount: chunks.length,
          extractedAt,
          input,
          layoutRecomposition,
          maxChunkChars: effectiveConfig.maxChunkChars,
          modelSelection: reasoningSelection,
          promptVersion,
          providerKind: provider.kind,
          requestedOverlapChars: effectiveConfig.requestedOverlapChars,
        }),
      );
    },
  };
}

/**
 * Fail-closed validation for a stored LLM semantic generation. This recomputes the canonical
 * parser text, atomic units, windows, and window fingerprints rather than trusting replayed JSON.
 */
export function assertValidLlmSemanticGenerationReplay({
  config,
  excludedNodeOrdinals = [],
  language,
  modelSelection: requestedModelSelection,
  nodes,
  parseArtifact,
  permissionScope = [],
  promptVersion = DEFAULT_PROMPT_VERSION,
  publicationGenerationId,
}: LlmSemanticGenerationReplayAssertionInput): void {
  const modelSelection = KnowledgeSpaceModelSelectionSchema.parse(requestedModelSelection);
  const effectiveConfig = resolveConfig(config, {
    maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
    maxNodes: DEFAULT_MAX_NODES,
    maxWindowChars: DEFAULT_MAX_WINDOW_CHARS,
    requestedOverlapChars: 0,
  });
  if (!promptVersion.trim()) {
    throw new Error("LLM semantic replay promptVersion is required");
  }
  const { canonicalText, elements, layoutRecomposition } = materializeElements(parseArtifact);
  const units = materializeAtomicUnits(elements, effectiveConfig.maxChunkChars);
  const planningPolicy = resolveSemanticWindowPlanningPolicy({
    canonicalText,
    maxChunkChars: effectiveConfig.maxChunkChars,
    promptVersion,
    units,
  });
  if (units.length === 0) {
    assertSemanticReplay(nodes.length === 0, "stored nodes exist for an empty parse artifact");
    return;
  }
  assertSemanticReplay(nodes.length > 0, "no stored nodes cover the non-empty parse artifact");

  const firstMarker = nodes[0]?.metadata.semanticChunking;
  const documentChunkCount =
    isPlainObject(firstMarker) && Number.isSafeInteger(firstMarker.documentChunkCount)
      ? (firstMarker.documentChunkCount as number)
      : -1;
  assertSemanticReplay(documentChunkCount >= 1, "documentChunkCount is missing or invalid");
  assertSemanticReplay(
    !planningPolicy.atomicDocument || documentChunkCount === 1,
    "atomic structured documents must replay as exactly one chunk",
  );
  assertSemanticReplay(
    documentChunkCount <= effectiveConfig.maxNodes,
    `documentChunkCount exceeds maxNodes=${effectiveConfig.maxNodes}`,
  );
  const excluded =
    excludedNodeOrdinals instanceof Set
      ? new Set(excludedNodeOrdinals)
      : new Set(excludedNodeOrdinals);
  for (const ordinal of excluded) {
    assertSemanticReplay(
      Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < documentChunkCount,
      `excluded chunk ordinal ${String(ordinal)} is outside documentChunkCount`,
    );
  }
  const expectedIndexes = Array.from({ length: documentChunkCount }, (_, index) => index).filter(
    (index) => !excluded.has(index),
  );
  assertSemanticReplay(
    nodes.length === expectedIndexes.length,
    "stored node count does not match the non-excluded document chunks",
  );

  const globalUnitIndex = new Map(units.map((unit, index) => [unit.id, index]));
  const validatedRanges: Array<{
    readonly chunkIndex: number;
    readonly end: number;
    readonly start: number;
    readonly windowId: string;
  }> = [];
  const completionByWindow = new Map<string, string>();
  const replayWindows = new Map<
    string,
    {
      readonly commitEnd: number;
      readonly coreEnd: number;
      readonly coreStart: number;
      readonly firstChunkIndex: number;
      readonly lastChunkIndex: number;
      readonly ordinal: number;
    }
  >();

  for (const [nodeOrdinal, node] of nodes.entries()) {
    const chunkIndex = expectedIndexes[nodeOrdinal] as number;
    const semantic = node.metadata.semanticChunking;
    assertSemanticReplay(
      node.artifactHash === parseArtifact.artifactHash &&
        node.documentAssetId === parseArtifact.documentAssetId &&
        node.parseArtifactId === parseArtifact.id &&
        (publicationGenerationId === undefined ||
          node.publicationGenerationId === publicationGenerationId),
      `chunk ${chunkIndex} does not belong to the requested immutable parse generation`,
    );
    assertSemanticReplay(
      isPlainObject(semantic) &&
        semantic.completed === true &&
        semantic.strategy === SEMANTIC_CHUNKING_STRATEGY &&
        semantic.schemaVersion === SEMANTIC_CHUNKING_SCHEMA_VERSION,
      `chunk ${chunkIndex} has an invalid semantic marker`,
    );
    // The assertion above establishes the runtime shape for subsequent guarded property reads.
    const marker = semantic as Record<string, unknown>;
    assertSemanticReplay(
      node.metadata.chunkIndex === chunkIndex &&
        marker.documentChunkCount === documentChunkCount &&
        marker.maxChunkChars === effectiveConfig.maxChunkChars &&
        marker.requestedOverlapChars === effectiveConfig.requestedOverlapChars &&
        marker.overlapApplied === false &&
        marker.overlapPolicy === "non-overlapping-semantic-output" &&
        marker.model === modelSelection.model &&
        marker.promptVersion === promptVersion &&
        isExactModelSelection(marker.modelSelection, modelSelection) &&
        isMatchingLayoutRecomposition(marker.layoutRecomposition, layoutRecomposition) &&
        isValidCompletionIdentity(
          marker.completion,
          modelSelection,
          nonEmptyString(marker.provider),
        ),
      `chunk ${chunkIndex} has incompatible semantic provenance`,
    );

    const windowId = nonEmptyString(marker.windowId);
    const windowOrdinal = windowId ? semanticWindowOrdinal(windowId) : undefined;
    assertSemanticReplay(
      windowId !== undefined && windowOrdinal !== undefined,
      `chunk ${chunkIndex} references an invalid window`,
    );
    const coreRange = semanticMarkerUnitRange(marker.windowCoreUnitRange);
    const committedRange = semanticMarkerUnitRange(marker.windowCommittedUnitRange);
    const coreStart = coreRange ? globalUnitIndex.get(coreRange.startUnitId) : undefined;
    const coreEnd = coreRange ? globalUnitIndex.get(coreRange.endUnitId) : undefined;
    const commitStart = committedRange
      ? globalUnitIndex.get(committedRange.startUnitId)
      : undefined;
    const commitEnd = committedRange ? globalUnitIndex.get(committedRange.endUnitId) : undefined;
    assertSemanticReplay(
      coreStart !== undefined &&
        coreEnd !== undefined &&
        commitStart === coreStart &&
        commitEnd !== undefined &&
        commitEnd >= coreEnd &&
        (planningPolicy.version !== "v4" || commitEnd === coreEnd),
      `chunk ${chunkIndex} has invalid core or committed window ranges`,
    );
    const resolvedWindow = materializeSemanticWindow({
      canonicalText,
      maxChunkChars: effectiveConfig.maxChunkChars,
      maxWindowChars: effectiveConfig.maxWindowChars,
      planningPolicy,
      startUnitIndex: coreStart as number,
      units,
      windowIndex: windowOrdinal as number,
    });
    const expectedCore = semanticWindowCoreRange(resolvedWindow);
    const expectedLookAhead = semanticWindowLookAheadRange(resolvedWindow);
    const markerLookAhead = semanticMarkerUnitRange(marker.windowLookAheadUnitRange);
    assertSemanticReplay(
      resolvedWindow.id === windowId &&
        marker.inputFingerprint === resolvedWindow.inputFingerprint &&
        sameSemanticUnitRange(coreRange, expectedCore) &&
        sameSemanticUnitRange(markerLookAhead, expectedLookAhead) &&
        (commitEnd as number) <=
          (globalUnitIndex.get(
            (resolvedWindow.lookAheadUnits.at(-1) ?? resolvedWindow.units.at(-1))?.id ?? "",
          ) ?? -1),
      `chunk ${chunkIndex} window fingerprint or layout does not match canonical parser input`,
    );
    const unitRange = marker.unitRange;
    const startUnitId = isPlainObject(unitRange)
      ? nonEmptyString(unitRange.startUnitId)
      : undefined;
    const endUnitId = isPlainObject(unitRange) ? nonEmptyString(unitRange.endUnitId) : undefined;
    const start = startUnitId ? globalUnitIndex.get(startUnitId) : undefined;
    const end = endUnitId ? globalUnitIndex.get(endUnitId) : undefined;
    assertSemanticReplay(
      start !== undefined &&
        end !== undefined &&
        start <= end &&
        start >= (coreStart as number) &&
        end <= (commitEnd as number) &&
        start <= (coreEnd as number) &&
        (end <= (coreEnd as number) || end === commitEnd),
      `chunk ${chunkIndex} has an invalid unit range`,
    );
    const first = units[start as number] as AtomicUnit;
    const last = units[end as number] as AtomicUnit;
    const rangeUnits = units.slice(start as number, (end as number) + 1);
    const expectedText = canonicalText.slice(first.startCodeUnit, last.endCodeUnit);
    const expectedPageNumber = commonPageNumber(rangeUnits);
    const expectedKind = commonSpecialKind(rangeUnits) ?? "chunk";
    const expectedNodeId = deterministicChildId(
      publicationGenerationId ?? parseArtifact.id,
      `${SEMANTIC_CHUNKING_STRATEGY}:${parseArtifact.id}:${parseArtifact.artifactHash}:${first.startOffset}:${last.endOffset}`,
    );
    assertSemanticReplay(
      node.id === expectedNodeId &&
        node.text === expectedText &&
        countUnicodeGraphemes(node.text) <= effectiveConfig.maxChunkChars &&
        node.startOffset === first.startOffset &&
        node.endOffset === last.endOffset &&
        node.sourceLocation.startOffset === first.startOffset &&
        node.sourceLocation.endOffset === last.endOffset &&
        node.sourceLocation.pageNumber === expectedPageNumber &&
        hasValidSemanticSectionReplay(
          marker.section,
          commonSectionPath(rangeUnits.map((unit) => unit.sectionPath)),
          node.sourceLocation.sectionPath,
        ) &&
        (planningPolicy.version === "v1" ||
          stableJson(marker.sourceSpans) === stableJson(semanticSourceSpans(rangeUnits))) &&
        (planningPolicy.atomicDocument || respectsIsolatedElementBoundaries(rangeUnits)) &&
        node.kind === expectedKind &&
        sameStrings(node.permissionScope, permissionScope) &&
        (language === undefined
          ? node.metadata.language === undefined
          : node.metadata.language === language),
      `chunk ${chunkIndex} identity, text, UTF-8 offsets, location, ACL, language, or kind does not match canonical input`,
    );
    assertSemanticReplay(
      node.metadata.offsetEncoding === DOCUMENT_OFFSET_ENCODING &&
        node.metadata.textNormalization === DOCUMENT_ELEMENT_TEXT_NORMALIZATION &&
        node.metadata.elementSeparator === DOCUMENT_ELEMENT_SEPARATOR &&
        sameStrings(
          arrayOfStrings(node.metadata.elementIds),
          uniqueStrings(rangeUnits.map((unit) => unit.elementId)),
        ) &&
        sameStrings(
          arrayOfStrings(node.metadata.elementTypes),
          uniqueStrings(rangeUnits.map((unit) => unit.elementType)),
        ) &&
        hasValidLlmSemanticJointExtraction(node),
      `chunk ${chunkIndex} canonical or joint-extraction metadata is invalid`,
    );
    const completionFingerprint = JSON.stringify(marker.completion);
    const existingCompletion = completionByWindow.get(resolvedWindow.id);
    assertSemanticReplay(
      existingCompletion === undefined || existingCompletion === completionFingerprint,
      `chunk ${chunkIndex} completion identity differs inside the same window`,
    );
    completionByWindow.set(resolvedWindow.id, completionFingerprint);
    const existingReplayWindow = replayWindows.get(resolvedWindow.id);
    if (existingReplayWindow) {
      assertSemanticReplay(
        existingReplayWindow.coreStart === coreStart &&
          existingReplayWindow.coreEnd === coreEnd &&
          existingReplayWindow.commitEnd === commitEnd,
        `chunk ${chunkIndex} window ranges differ inside the same window`,
      );
      replayWindows.set(resolvedWindow.id, {
        ...existingReplayWindow,
        lastChunkIndex: chunkIndex,
      });
    } else {
      replayWindows.set(resolvedWindow.id, {
        commitEnd: commitEnd as number,
        coreEnd: coreEnd as number,
        coreStart: coreStart as number,
        firstChunkIndex: chunkIndex,
        lastChunkIndex: chunkIndex,
        ordinal: windowOrdinal as number,
      });
    }
    validatedRanges.push({
      chunkIndex,
      end: end as number,
      start: start as number,
      windowId: resolvedWindow.id,
    });
  }

  const orderedWindows = [...replayWindows.values()].sort(
    (left, right) => left.firstChunkIndex - right.firstChunkIndex,
  );
  for (const [windowIndex, replayWindow] of orderedWindows.entries()) {
    const previous = orderedWindows[windowIndex - 1];
    if (replayWindow.firstChunkIndex === 0) {
      assertSemanticReplay(
        replayWindow.ordinal === 0 && replayWindow.coreStart === 0,
        "the first semantic window does not start at unit 0",
      );
    }
    if (previous && replayWindow.firstChunkIndex === previous.lastChunkIndex + 1) {
      assertSemanticReplay(
        replayWindow.ordinal === previous.ordinal + 1 &&
          replayWindow.coreStart === previous.commitEnd + 1,
        "adjacent semantic windows do not advance from the preceding committed boundary",
      );
    } else if (previous) {
      assertSemanticReplay(
        replayWindow.ordinal > previous.ordinal &&
          replayWindow.coreStart > previous.commitEnd &&
          replayWindow.ordinal - previous.ordinal <=
            replayWindow.firstChunkIndex - previous.lastChunkIndex,
        "semantic windows separated by excluded chunks have an invalid layout",
      );
    }
    const visibleWindowRanges = validatedRanges.filter(
      (range) => range.windowId === `window-${replayWindow.ordinal.toString().padStart(6, "0")}`,
    );
    const firstVisible = visibleWindowRanges[0];
    const lastVisible = visibleWindowRanges.at(-1);
    if (firstVisible && !excluded.has(firstVisible.chunkIndex - 1)) {
      assertSemanticReplay(
        firstVisible.start === replayWindow.coreStart,
        `window ${replayWindow.ordinal} does not start at its deterministic core boundary`,
      );
    }
    if (lastVisible && !excluded.has(lastVisible.chunkIndex + 1)) {
      assertSemanticReplay(
        lastVisible.end === replayWindow.commitEnd,
        `window ${replayWindow.ordinal} does not end at its committed boundary`,
      );
    }
  }

  for (const [index, range] of validatedRanges.entries()) {
    const previous = validatedRanges[index - 1];
    if (range.chunkIndex === 0) {
      assertSemanticReplay(range.start === 0, "the first document chunk does not start at unit 0");
    }
    if (range.chunkIndex === documentChunkCount - 1) {
      assertSemanticReplay(
        range.end === units.length - 1,
        "the last document chunk does not end at the final unit",
      );
    }
    if (previous && range.chunkIndex === previous.chunkIndex + 1) {
      assertSemanticReplay(
        range.start === previous.end + 1,
        `chunks ${previous.chunkIndex} and ${range.chunkIndex} have a gap or overlap`,
      );
    } else if (previous) {
      assertSemanticReplay(
        range.start > previous.end,
        `non-excluded chunk ${range.chunkIndex} overlaps a preceding range`,
      );
    }
  }
}

/**
 * Replays a compact, complete semantic-window receipt against canonical parser input. Unlike node
 * replay, this remains complete when every chunk, or every chunk from an intermediate window, was
 * editorially excluded from the persisted node set.
 */
export function assertValidLlmSemanticWindowManifestReplay({
  completionCatalog,
  config,
  documentChunkCount,
  modelSelection: requestedModelSelection,
  parseArtifact,
  promptVersion = DEFAULT_PROMPT_VERSION,
  windowManifest,
}: LlmSemanticWindowManifestReplayAssertionInput): void {
  const modelSelection = KnowledgeSpaceModelSelectionSchema.parse(requestedModelSelection);
  const effectiveConfig = resolveConfig(config, {
    maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
    maxNodes: DEFAULT_MAX_NODES,
    maxWindowChars: DEFAULT_MAX_WINDOW_CHARS,
    requestedOverlapChars: 0,
  });
  assertSemanticManifestReplay(Boolean(promptVersion.trim()), "promptVersion is required");
  assertSemanticManifestReplay(
    Number.isSafeInteger(documentChunkCount) &&
      documentChunkCount >= 0 &&
      documentChunkCount <= effectiveConfig.maxNodes,
    `documentChunkCount exceeds maxNodes=${effectiveConfig.maxNodes} or is invalid`,
  );
  assertSemanticManifestReplay(Array.isArray(windowManifest), "windowManifest must be an array");
  assertSemanticManifestReplay(
    windowManifest.length <= effectiveConfig.maxNodes &&
      windowManifest.length <= DEFAULT_MAX_SEMANTIC_WINDOWS &&
      windowManifest.length <= documentChunkCount,
    `windowManifest exceeds maxNodes=${effectiveConfig.maxNodes}, maxSemanticWindows=${DEFAULT_MAX_SEMANTIC_WINDOWS}, or documentChunkCount`,
  );
  assertSemanticManifestReplay(
    Array.isArray(completionCatalog) &&
      completionCatalog.length <= windowManifest.length &&
      completionCatalog.length <= MAX_COMPLETION_CATALOG_ENTRIES,
    "completionCatalog is not bounded by the window manifest",
  );

  const completionFingerprints = new Set<string>();
  for (const [completionIndex, completion] of completionCatalog.entries()) {
    assertSemanticManifestReplay(
      plainObjectValue(completion),
      `completionCatalog entry ${completionIndex} must be an object`,
    );
    assertBoundedOptionalCompletionField(
      completion.actualModel,
      "actualModel",
      MAX_COMPLETION_MODEL_CHARS,
      "manifest",
    );
    assertBoundedOptionalCompletionField(
      completion.actualProvider,
      "actualProvider",
      MAX_COMPLETION_PROVIDER_CHARS,
      "manifest",
    );
    assertBoundedOptionalCompletionField(
      completion.finishReason,
      "finishReason",
      MAX_COMPLETION_FINISH_REASON_CHARS,
      "manifest",
    );
    assertBoundedOptionalCompletionField(
      completion.transportProvider,
      "transportProvider",
      MAX_COMPLETION_PROVIDER_CHARS,
      "manifest",
    );
    const expectedFingerprint = llmSemanticCompletionFingerprint(completion);
    assertSemanticManifestReplay(
      completion.fingerprint === expectedFingerprint &&
        !completionFingerprints.has(completion.fingerprint),
      `completionCatalog entry ${completionIndex} has an invalid or duplicate identity`,
    );
    completionFingerprints.add(completion.fingerprint);
    assertSemanticManifestReplay(
      isValidCompletionIdentity(
        {
          actual: {
            ...(completion.actualModel ? { model: completion.actualModel } : {}),
            ...(completion.actualProvider ? { provider: completion.actualProvider } : {}),
            ...(completion.finishReason ? { finishReason: completion.finishReason } : {}),
          },
          requested: modelSelection,
        },
        modelSelection,
        completion.transportProvider,
      ),
      `completionCatalog entry ${completionIndex} is incompatible with the frozen model`,
    );
  }

  const { canonicalText, elements } = materializeElements(parseArtifact);
  const units = materializeAtomicUnits(elements, effectiveConfig.maxChunkChars);
  const planningPolicy = resolveSemanticWindowPlanningPolicy({
    canonicalText,
    maxChunkChars: effectiveConfig.maxChunkChars,
    promptVersion,
    units,
  });
  preflightMaterializedSemanticWindows({
    canonicalText,
    effectiveConfig,
    planningPolicy,
    units,
  });
  if (units.length === 0) {
    assertSemanticManifestReplay(
      documentChunkCount === 0 && windowManifest.length === 0 && completionCatalog.length === 0,
      "empty canonical input has receipt windows or chunks",
    );
    return;
  }
  assertSemanticManifestReplay(
    documentChunkCount > 0 && windowManifest.length > 0 && completionCatalog.length > 0,
    "non-empty canonical input has an incomplete receipt manifest",
  );
  assertSemanticManifestReplay(
    !planningPolicy.atomicDocument || (documentChunkCount === 1 && windowManifest.length === 1),
    "atomic structured document manifest must contain exactly one window and one chunk",
  );

  const globalUnitIndex = new Map(units.map((unit, index) => [unit.id, index]));
  const usedCompletions = new Set<number>();
  let nextUnitIndex = 0;
  let nextChunkIndex = 0;

  for (const [windowOrdinal, manifestWindow] of windowManifest.entries()) {
    assertSemanticManifestReplay(
      plainObjectValue(manifestWindow),
      `window ${windowOrdinal} must be an object`,
    );
    assertSemanticManifestReplay(
      isSemanticWindowId(manifestWindow.windowId) &&
        manifestWindow.windowId === semanticWindowId(windowOrdinal),
      `window ${windowOrdinal} has an invalid or non-sequential windowId`,
    );
    assertSemanticManifestReplay(
      /^sha256:[a-f0-9]{64}$/u.test(manifestWindow.inputFingerprint),
      `window ${windowOrdinal} has an invalid inputFingerprint`,
    );
    assertSemanticManifestReplay(
      Number.isSafeInteger(manifestWindow.completionIndex) &&
        manifestWindow.completionIndex >= 0 &&
        manifestWindow.completionIndex < completionCatalog.length,
      `window ${windowOrdinal} has an invalid completionIndex`,
    );
    usedCompletions.add(manifestWindow.completionIndex);
    assertSemanticManifestReplay(
      manifestWindow.firstChunkIndex === nextChunkIndex &&
        // The non-deterministic LLM payload may be absent after exclusions. Its generation-time
        // commitment is bound by the outer receipt; canonical replay can only validate its shape.
        /^sha256:[a-f0-9]{64}$/u.test(manifestWindow.responseFingerprint) &&
        Array.isArray(manifestWindow.chunkRanges) &&
        manifestWindow.chunkRanges.length > 0 &&
        manifestWindow.chunkRanges.length <= documentChunkCount - nextChunkIndex,
      `window ${windowOrdinal} has an invalid or unbounded chunk list`,
    );

    const expectedWindow = materializeSemanticWindow({
      canonicalText,
      maxChunkChars: effectiveConfig.maxChunkChars,
      maxWindowChars: effectiveConfig.maxWindowChars,
      planningPolicy,
      startUnitIndex: nextUnitIndex,
      units,
      windowIndex: windowOrdinal,
    });
    const expectedCoreRange = semanticWindowCoreRange(expectedWindow);
    const expectedLookAheadRange = semanticWindowLookAheadRange(expectedWindow);
    assertSemanticManifestReplay(
      manifestWindow.inputFingerprint === expectedWindow.inputFingerprint &&
        isSemanticUnitRangeTuple(manifestWindow.coreUnitRange) &&
        sameSemanticUnitRangeTuple(manifestWindow.coreUnitRange, expectedCoreRange) &&
        (manifestWindow.lookAheadUnitRange === undefined ||
          isSemanticUnitRangeTuple(manifestWindow.lookAheadUnitRange)) &&
        sameSemanticUnitRangeTuple(manifestWindow.lookAheadUnitRange, expectedLookAheadRange) &&
        isSemanticUnitRangeTuple(manifestWindow.committedUnitRange) &&
        manifestWindow.committedUnitRange[0] === expectedCoreRange.startUnitId,
      `window ${windowOrdinal} does not match its canonical core/look-ahead input`,
    );
    const coreEnd = globalUnitIndex.get(expectedCoreRange.endUnitId) as number;
    const eligibleEnd = globalUnitIndex.get(
      expectedLookAheadRange?.endUnitId ?? expectedCoreRange.endUnitId,
    ) as number;
    const commitEnd = globalUnitIndex.get(manifestWindow.committedUnitRange[1]);
    assertSemanticManifestReplay(
      commitEnd !== undefined &&
        commitEnd >= coreEnd &&
        commitEnd <= eligibleEnd &&
        (planningPolicy.version !== "v4" || commitEnd === coreEnd),
      `window ${windowOrdinal} has an invalid committed boundary`,
    );

    let expectedRangeStart = nextUnitIndex;
    for (const [windowChunkIndex, chunkRange] of manifestWindow.chunkRanges.entries()) {
      assertSemanticManifestReplay(
        Array.isArray(chunkRange) &&
          chunkRange.length === 2 &&
          isSemanticUnitId(chunkRange[0]) &&
          isSemanticUnitId(chunkRange[1]),
        `window ${windowOrdinal} chunk ${windowChunkIndex} has invalid identity`,
      );
      const startUnitId = chunkRange[0];
      const endUnitId = chunkRange[1];
      const start = globalUnitIndex.get(startUnitId);
      const end = globalUnitIndex.get(endUnitId);
      assertSemanticManifestReplay(
        start === expectedRangeStart &&
          end !== undefined &&
          end >= start &&
          end <= commitEnd &&
          start <= coreEnd &&
          (end <= coreEnd || end === commitEnd),
        `window ${windowOrdinal} chunk ${windowChunkIndex} has a gap, overlap, or context-only range`,
      );
      const first = units[start] as AtomicUnit;
      const last = units[end] as AtomicUnit;
      const rangeUnits = units.slice(start, end + 1);
      assertSemanticManifestReplay(
        countUnicodeGraphemes(canonicalText.slice(first.startCodeUnit, last.endCodeUnit)) <=
          effectiveConfig.maxChunkChars,
        `window ${windowOrdinal} chunk ${windowChunkIndex} exceeds maxChunkChars=${effectiveConfig.maxChunkChars}`,
      );
      assertSemanticManifestReplay(
        planningPolicy.atomicDocument || respectsIsolatedElementBoundaries(rangeUnits),
        `window ${windowOrdinal} chunk ${windowChunkIndex} crosses an isolated table or image boundary`,
      );
      expectedRangeStart = end + 1;
      nextChunkIndex += 1;
    }
    assertSemanticManifestReplay(
      expectedRangeStart === commitEnd + 1,
      `window ${windowOrdinal} chunks do not end at the committed boundary`,
    );
    nextUnitIndex = commitEnd + 1;
  }

  assertSemanticManifestReplay(
    nextChunkIndex === documentChunkCount,
    "window chunks do not match documentChunkCount",
  );
  assertSemanticManifestReplay(
    nextUnitIndex === units.length,
    "window manifest does not cover every canonical unit",
  );
  assertSemanticManifestReplay(
    usedCompletions.size === completionCatalog.length,
    "completionCatalog contains unused entries",
  );
}

/** Strict marker/payload validation shared by replay and semantic post-processing. */
export function hasValidLlmSemanticJointExtraction(node: KnowledgeNode): boolean {
  const semantic = node.metadata.semanticChunking;
  const entitiesValue = node.metadata.extractedEntities;
  const relationsValue = node.metadata.extractedRelations;
  if (
    !isPlainObject(semantic) ||
    semantic.completed !== true ||
    semantic.strategy !== SEMANTIC_CHUNKING_STRATEGY ||
    semantic.schemaVersion !== SEMANTIC_CHUNKING_SCHEMA_VERSION ||
    !Array.isArray(entitiesValue) ||
    !Array.isArray(relationsValue)
  ) {
    return false;
  }
  const selection = KnowledgeSpaceModelSelectionSchema.safeParse(semantic.modelSelection);
  const model = nonEmptyString(semantic.model);
  const markerPromptVersion = nonEmptyString(semantic.promptVersion);
  const chunkIndex = node.metadata.chunkIndex;
  const documentChunkCount = semantic.documentChunkCount;
  const maxChunkChars = semantic.maxChunkChars;
  const requestedOverlapChars = semantic.requestedOverlapChars;
  const coreRange = semanticMarkerUnitRange(semantic.windowCoreUnitRange);
  const committedRange = semanticMarkerUnitRange(semantic.windowCommittedUnitRange);
  if (
    !selection.success ||
    !model ||
    model !== selection.data.model ||
    !markerPromptVersion ||
    !isValidCompletionIdentity(
      semantic.completion,
      selection.data,
      nonEmptyString(semantic.provider),
    ) ||
    !nonEmptyString(semantic.windowId) ||
    semanticWindowOrdinal(nonEmptyString(semantic.windowId) ?? "") === undefined ||
    !isPlainObject(semantic.unitRange) ||
    !nonEmptyString(semantic.unitRange.startUnitId) ||
    !nonEmptyString(semantic.unitRange.endUnitId) ||
    !coreRange ||
    !committedRange ||
    coreRange.startUnitId !== committedRange.startUnitId ||
    (Object.hasOwn(semantic, "windowLookAheadUnitRange") &&
      !semanticMarkerUnitRange(semantic.windowLookAheadUnitRange)) ||
    typeof semantic.inputFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(semantic.inputFingerprint) ||
    !Number.isSafeInteger(chunkIndex) ||
    (chunkIndex as number) < 0 ||
    !Number.isSafeInteger(documentChunkCount) ||
    (documentChunkCount as number) < 1 ||
    (chunkIndex as number) >= (documentChunkCount as number) ||
    !Number.isSafeInteger(maxChunkChars) ||
    (maxChunkChars as number) < 1 ||
    countUnicodeGraphemes(node.text) > (maxChunkChars as number) ||
    !Number.isSafeInteger(requestedOverlapChars) ||
    (requestedOverlapChars as number) < 0 ||
    (requestedOverlapChars as number) >= (maxChunkChars as number) ||
    semantic.overlapApplied !== false ||
    semantic.overlapPolicy !== "non-overlapping-semantic-output" ||
    !isMatchingJointExtractionMetadata({
      count: entitiesValue.length,
      countKey: "entityCount",
      metadata: node.metadata.entityExtraction,
      model,
      promptVersion: markerPromptVersion,
    }) ||
    !isMatchingJointExtractionMetadata({
      count: relationsValue.length,
      countKey: "relationCount",
      metadata: node.metadata.relationExtraction,
      model,
      promptVersion: markerPromptVersion,
    })
  ) {
    return false;
  }

  const entitiesByResponseId = new Map<string, string>();
  for (const entity of entitiesValue) {
    if (
      !isPlainObject(entity) ||
      typeof entity.text !== "string" ||
      !entity.text.trim() ||
      !node.text.includes(entity.text.trim()) ||
      !EntityTypeSchema.safeParse(entity.type).success ||
      typeof entity.confidence !== "number" ||
      !Number.isFinite(entity.confidence) ||
      entity.confidence < 0 ||
      entity.confidence > 1 ||
      !isPlainObject(entity.metadata)
    ) {
      return false;
    }
    const responseEntityId = nonEmptyString(entity.metadata.responseEntityId);
    const hasCanonicalName = Object.hasOwn(entity.metadata, "canonicalName");
    const canonicalName = hasCanonicalName
      ? nonEmptyString(entity.metadata.canonicalName)
      : undefined;
    if (
      !responseEntityId ||
      entitiesByResponseId.has(responseEntityId) ||
      (hasCanonicalName && !canonicalName) ||
      entity.metadata.source !== "llm-semantic-chunking"
    ) {
      return false;
    }
    entitiesByResponseId.set(responseEntityId, canonicalName ?? entity.text.trim());
  }

  for (const relation of relationsValue) {
    if (
      !isPlainObject(relation) ||
      typeof relation.subject !== "string" ||
      typeof relation.object !== "string" ||
      !RelationTypeSchema.safeParse(relation.type).success ||
      typeof relation.confidence !== "number" ||
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1 ||
      !isPlainObject(relation.metadata)
    ) {
      return false;
    }
    const subjectEntityId = nonEmptyString(relation.metadata.subjectEntityId);
    const objectEntityId = nonEmptyString(relation.metadata.objectEntityId);
    if (
      !subjectEntityId ||
      !objectEntityId ||
      relation.metadata.source !== "llm-semantic-chunking" ||
      entitiesByResponseId.get(subjectEntityId) !== relation.subject.trim() ||
      entitiesByResponseId.get(objectEntityId) !== relation.object.trim()
    ) {
      return false;
    }
  }
  return true;
}

function isValidCompletionIdentity(
  value: unknown,
  selection: KnowledgeSpaceModelSelection,
  transportProvider?: string | undefined,
): boolean {
  if (!isPlainObject(value) || !isPlainObject(value.actual)) {
    return false;
  }
  if (!isExactModelSelection(value.requested, selection)) {
    return false;
  }
  if (
    transportProvider !== undefined &&
    boundedCompletionString(transportProvider, MAX_COMPLETION_PROVIDER_CHARS) === undefined
  ) {
    return false;
  }
  const actual = value.actual;
  if (transportProvider === "plugin-daemon") {
    return (
      boundedCompletionString(actual.model, MAX_COMPLETION_MODEL_CHARS) === selection.model &&
      boundedCompletionString(actual.provider, MAX_COMPLETION_PROVIDER_CHARS) === "plugin-daemon" &&
      (!Object.hasOwn(actual, "finishReason") ||
        Boolean(boundedCompletionString(actual.finishReason, MAX_COMPLETION_FINISH_REASON_CHARS)))
    );
  }
  if (Object.hasOwn(actual, "model")) {
    const actualModel = boundedCompletionString(actual.model, MAX_COMPLETION_MODEL_CHARS);
    if (!actualModel || actualModel !== selection.model) {
      return false;
    }
  }
  if (
    Object.hasOwn(actual, "provider") &&
    !boundedCompletionString(actual.provider, MAX_COMPLETION_PROVIDER_CHARS)
  ) {
    return false;
  }
  if (
    Object.hasOwn(actual, "finishReason") &&
    !boundedCompletionString(actual.finishReason, MAX_COMPLETION_FINISH_REASON_CHARS)
  ) {
    return false;
  }
  return true;
}

function boundedCompletionString(value: unknown, maxChars: number): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized && unicodeCodePointLength(normalized) <= maxChars ? normalized : undefined;
}

function isExactModelSelection(value: unknown, expected: KnowledgeSpaceModelSelection): boolean {
  const parsed = KnowledgeSpaceModelSelectionSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.model === expected.model &&
    parsed.data.pluginId === expected.pluginId &&
    parsed.data.provider === expected.provider
  );
}

function isMatchingLayoutRecomposition(
  value: unknown,
  expected: DocumentLayoutRecompositionStats & { readonly fingerprint: string },
): boolean {
  return (
    isPlainObject(value) &&
    value.fingerprint === expected.fingerprint &&
    value.elementsRecomposed === expected.elementsRecomposed &&
    value.modelDecidedHeadingBoundaries === expected.modelDecidedHeadingBoundaries &&
    value.trustedHeadingBoundaries === expected.trustedHeadingBoundaries
  );
}

function isMatchingJointExtractionMetadata({
  count,
  countKey,
  metadata,
  model,
  promptVersion,
}: {
  readonly count: number;
  readonly countKey: "entityCount" | "relationCount";
  readonly metadata: unknown;
  readonly model: string;
  readonly promptVersion: string;
}): boolean {
  return (
    isPlainObject(metadata) &&
    metadata.completed === true &&
    metadata.model === model &&
    metadata.promptVersion === promptVersion &&
    metadata.source === SEMANTIC_CHUNKING_STRATEGY &&
    typeof metadata.extractedAt === "string" &&
    DateTimeSchema.safeParse(metadata.extractedAt).success &&
    metadata[countKey] === count
  );
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export interface SemanticUnitRange {
  readonly endUnitId: string;
  readonly startUnitId: string;
}

function assertBoundedOptionalCompletionField(
  value: string | undefined,
  field: string,
  maxChars: number,
  source: "manifest" | "terminal",
): void {
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      !value.trim() ||
      value !== value.trim() ||
      unicodeCodePointLength(value) > maxChars)
  ) {
    const message = `LLM semantic chunking ${source} ${field} must be a trimmed non-empty string of at most ${maxChars} characters`;
    if (source === "manifest") {
      throw new Error(`LLM semantic window manifest replay validation failed: ${message}`);
    }
    throw new Error(message);
  }
}

function unicodeCodePointLength(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function isSemanticWindowId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    unicodeCodePointLength(value) <= MAX_SEMANTIC_WINDOW_ID_CHARS &&
    /^window-\d{6,}$/u.test(value)
  );
}

function isSemanticUnitId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    unicodeCodePointLength(value) <= MAX_SEMANTIC_UNIT_ID_CHARS &&
    /^u-\d{6,}-\d{6,}$/u.test(value)
  );
}

function isSemanticUnitRange(value: unknown): value is SemanticUnitRange {
  return (
    isPlainObject(value) && isSemanticUnitId(value.startUnitId) && isSemanticUnitId(value.endUnitId)
  );
}

function isSemanticUnitRangeTuple(value: unknown): value is LlmSemanticUnitRangeTuple {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isSemanticUnitId(value[0]) &&
    isSemanticUnitId(value[1])
  );
}

function semanticWindowId(ordinal: number): string {
  return `window-${ordinal.toString().padStart(6, "0")}`;
}

function semanticMarkerUnitRange(value: unknown): SemanticUnitRange | undefined {
  if (!isPlainObject(value)) return undefined;
  const startUnitId = nonEmptyString(value.startUnitId);
  const endUnitId = nonEmptyString(value.endUnitId);
  return startUnitId && endUnitId ? { endUnitId, startUnitId } : undefined;
}

function semanticWindowCoreRange(window: SemanticWindow): SemanticUnitRange {
  return {
    endUnitId: (window.units.at(-1) as AtomicUnit).id,
    startUnitId: (window.units[0] as AtomicUnit).id,
  };
}

function semanticWindowLookAheadRange(window: SemanticWindow): SemanticUnitRange | undefined {
  const first = window.lookAheadUnits[0];
  const last = window.lookAheadUnits.at(-1);
  return first && last ? { endUnitId: last.id, startUnitId: first.id } : undefined;
}

function sameSemanticUnitRange(
  left: SemanticUnitRange | undefined,
  right: SemanticUnitRange | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.startUnitId === right.startUnitId &&
      left.endUnitId === right.endUnitId)
  );
}

function sameSemanticUnitRangeTuple(
  left: LlmSemanticUnitRangeTuple | undefined,
  right: SemanticUnitRange | undefined,
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      left[0] === right.startUnitId &&
      left[1] === right.endUnitId)
  );
}

function semanticWindowOrdinal(windowId: string): number | undefined {
  const match = /^window-(\d{6,})$/u.exec(windowId);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function assertSemanticManifestReplay(condition: unknown, reason: string): asserts condition {
  if (!condition) {
    throw new Error(`LLM semantic window manifest replay validation failed: ${reason}`);
  }
}

function plainObjectValue(value: unknown): boolean {
  return isPlainObject(value);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function assertSemanticReplay(condition: unknown, reason: string): asserts condition {
  if (!condition) {
    throw new Error(`LLM semantic replay validation failed: ${reason}`);
  }
}

function resolveConfig(
  requested: SemanticChunkerInput["config"],
  defaults: EffectiveChunkConfig,
): EffectiveChunkConfig {
  const maxChunkChars = requested?.maxChunkChars ?? defaults.maxChunkChars;
  const resolved = {
    maxChunkChars,
    maxNodes: requested?.maxNodes ?? defaults.maxNodes,
    maxWindowChars: requested?.maxWindowChars ?? Math.max(defaults.maxWindowChars, maxChunkChars),
    requestedOverlapChars: requested?.overlapChars ?? defaults.requestedOverlapChars,
  };
  validatePositiveInteger("maxChunkChars", resolved.maxChunkChars);
  validatePositiveInteger("maxNodes", resolved.maxNodes);
  validatePositiveInteger("maxWindowChars", resolved.maxWindowChars);
  validateNonnegativeInteger("overlapChars", resolved.requestedOverlapChars);
  if (resolved.maxWindowChars < resolved.maxChunkChars) {
    throw new Error("LLM semantic chunking maxWindowChars must be at least maxChunkChars");
  }
  if (resolved.requestedOverlapChars >= resolved.maxChunkChars) {
    throw new Error("LLM semantic chunking overlapChars must be less than maxChunkChars");
  }
  return resolved;
}

function materializeElements(parseArtifact: ParseArtifact): {
  readonly canonicalText: string;
  readonly elements: readonly MaterializedElement[];
  readonly layoutRecomposition: DocumentLayoutRecompositionStats & {
    readonly fingerprint: string;
  };
} {
  const recomposed = recomposeDocumentLayoutForSemanticSegmentation(parseArtifact);
  const elements: MaterializedElement[] = [];
  let canonicalText = "";
  let nextOffset = 0;

  for (const [elementIndex, element] of recomposed.artifact.elements.entries()) {
    const span = materializeDocumentElementByteSpan(element.text, nextOffset);
    if (!span) {
      continue;
    }
    const separator = elements.length === 0 ? "" : DOCUMENT_ELEMENT_SEPARATOR;
    const startCodeUnit = canonicalText.length + separator.length;
    canonicalText += `${separator}${span.text}`;
    nextOffset = span.nextOffset;
    elements.push({
      elementId: element.id,
      elementIndex,
      elementMetadata: cloneJsonObject(element.metadata),
      elementType: element.type,
      endCodeUnit: canonicalText.length,
      endOffset: span.endOffset,
      ...(element.pageNumber === undefined ? {} : { pageNumber: element.pageNumber }),
      sectionPath: [...element.sectionPath],
      startCodeUnit,
      startOffset: span.startOffset,
      text: span.text,
    });
  }

  return {
    canonicalText,
    elements,
    layoutRecomposition: { fingerprint: recomposed.fingerprint, ...recomposed.stats },
  };
}

function materializeAtomicUnits(
  elements: readonly MaterializedElement[],
  maxChunkChars: number,
): AtomicUnit[] {
  const units: AtomicUnit[] = [];

  for (const element of elements) {
    const sentenceRanges = semanticRanges(element);
    let atomicIndex = 0;
    for (const range of sentenceRanges) {
      const sentence = element.text.slice(range.start, range.end);
      for (const hardRange of graphemeRanges(sentence, maxChunkChars)) {
        const localStart = range.start + hardRange.start;
        const localEnd = range.start + hardRange.end;
        const text = element.text.slice(localStart, localEnd);
        const startOffset = element.startOffset + utf8ByteLength(element.text.slice(0, localStart));
        const endOffset = element.startOffset + utf8ByteLength(element.text.slice(0, localEnd));
        units.push({
          elementId: element.elementId,
          elementMetadata: cloneJsonObject(element.elementMetadata),
          elementType: element.elementType,
          endCodeUnit: element.startCodeUnit + localEnd,
          endOffset,
          graphemeLength: countUnicodeGraphemes(text),
          id: `u-${element.elementIndex.toString().padStart(6, "0")}-${atomicIndex
            .toString()
            .padStart(6, "0")}`,
          ...(element.elementType === "image" || element.elementType === "table"
            ? { isolationKey: `${element.elementType}:${element.elementId}` }
            : {}),
          ...(element.pageNumber === undefined ? {} : { pageNumber: element.pageNumber }),
          sectionPath: [...element.sectionPath],
          startCodeUnit: element.startCodeUnit + localStart,
          startOffset,
          text,
        });
        atomicIndex += 1;
      }
    }
  }

  return units;
}

function semanticRanges(element: MaterializedElement): Array<{ end: number; start: number }> {
  if (element.elementType !== "paragraph" && element.elementType !== "list") {
    return [{ end: element.text.length, start: 0 }];
  }

  const ranges = Array.from(
    new Intl.Segmenter("und", { granularity: "sentence" }).segment(element.text),
    (segment) => ({
      end: segment.index + segment.segment.length,
      start: segment.index,
    }),
  );

  return ranges;
}

function graphemeRanges(
  text: string,
  maxChunkChars: number,
): Array<{ end: number; start: number }> {
  const ranges: Array<{ end: number; start: number }> = [];
  let count = 0;
  let start = 0;
  let end = 0;

  for (const segment of graphemeSegments(text)) {
    if (count === maxChunkChars) {
      ranges.push({ end, start });
      start = segment.index;
      count = 0;
    }
    end = segment.index + segment.segment.length;
    count += 1;
  }
  if (end > start) {
    ranges.push({ end, start });
  }
  return ranges;
}

function preflightMaterializedSemanticWindows({
  canonicalText,
  effectiveConfig,
  planningPolicy,
  units,
}: {
  readonly canonicalText: string;
  readonly effectiveConfig: EffectiveChunkConfig;
  readonly planningPolicy: SemanticWindowPlanningPolicy;
  readonly units: readonly AtomicUnit[];
}): LlmSemanticWindowPreflightResult {
  const windows = materializeDeterministicSemanticWindows({
    canonicalText,
    effectiveConfig,
    planningPolicy,
    units,
  });
  return { maximumWindowCount: windows.length, unitCount: units.length };
}

function materializeDeterministicSemanticWindows({
  canonicalText,
  effectiveConfig,
  planningPolicy,
  units,
}: {
  readonly canonicalText: string;
  readonly effectiveConfig: EffectiveChunkConfig;
  readonly planningPolicy: SemanticWindowPlanningPolicy;
  readonly units: readonly AtomicUnit[];
}): SemanticWindow[] {
  const windows: SemanticWindow[] = [];
  let nextUnitIndex = 0;
  while (nextUnitIndex < units.length) {
    if (windows.length >= DEFAULT_MAX_SEMANTIC_WINDOWS) {
      throw new Error(
        `LLM semantic chunking deterministic window count exceeds maxSemanticWindows=${DEFAULT_MAX_SEMANTIC_WINDOWS}`,
      );
    }
    const window = materializeSemanticWindow({
      canonicalText,
      maxChunkChars: effectiveConfig.maxChunkChars,
      maxWindowChars: effectiveConfig.maxWindowChars,
      planningPolicy,
      startUnitIndex: nextUnitIndex,
      units,
      windowIndex: windows.length,
    });
    windows.push(window);
    nextUnitIndex += window.units.length;
  }
  return windows;
}

function resolveSemanticWindowPlanningPolicy({
  canonicalText,
  maxChunkChars,
  promptVersion,
  units,
}: {
  readonly canonicalText: string;
  readonly maxChunkChars: number;
  readonly promptVersion: string;
  readonly units: readonly AtomicUnit[];
}): SemanticWindowPlanningPolicy {
  const version: SemanticWindowPlanningVersion =
    promptVersion === DEFAULT_PROMPT_VERSION
      ? "v4"
      : promptVersion === SEMANTIC_CHUNKING_V3_PROMPT_VERSION
        ? "v3"
        : promptVersion === SEMANTIC_CHUNKING_V2_PROMPT_VERSION
          ? "v2"
          : "v1";
  if (version === "v1") {
    return { atomicDocument: false, version };
  }

  const tableElementIds = new Set(
    units.filter((unit) => unit.elementType === "table").map((unit) => unit.elementId),
  );
  const pageNumbers = new Set(
    units.flatMap((unit) => (unit.pageNumber === undefined ? [] : [unit.pageNumber])),
  );
  const hasCompletePageProvenance = units.every((unit) => unit.pageNumber !== undefined);
  const hasNarrativeText = units.some(
    (unit) => unit.elementType !== "image" && unit.elementType !== "table",
  );
  const atomicDocument =
    units.length > 0 &&
    ((version !== "v3" && version !== "v4") || units.length <= V3_MAX_CORE_UNITS_PER_WINDOW) &&
    tableElementIds.size === 1 &&
    hasNarrativeText &&
    hasCompletePageProvenance &&
    pageNumbers.size === 1 &&
    countUnicodeGraphemes(canonicalText) <= maxChunkChars;
  return { atomicDocument, version };
}

function materializeSemanticWindow({
  canonicalText,
  maxChunkChars,
  maxWindowChars,
  planningPolicy,
  startUnitIndex,
  units,
  windowIndex,
}: {
  readonly canonicalText: string;
  readonly maxChunkChars: number;
  readonly maxWindowChars: number;
  readonly planningPolicy: SemanticWindowPlanningPolicy;
  readonly startUnitIndex: number;
  readonly units: readonly AtomicUnit[];
  readonly windowIndex: number;
}): SemanticWindow {
  const first = units[startUnitIndex];
  if (!first) {
    throw new Error("LLM semantic chunking cannot materialize an empty semantic window");
  }

  const coreUnits: AtomicUnit[] = [];
  let cursor = startUnitIndex;
  while (cursor < units.length) {
    if (
      (planningPolicy.version === "v3" || planningPolicy.version === "v4") &&
      coreUnits.length >= V3_MAX_CORE_UNITS_PER_WINDOW
    ) {
      break;
    }
    const candidate = units[cursor] as AtomicUnit;
    if (planningPolicy.version === "v1" && !isLegacyWindowCompatible(first, candidate)) {
      break;
    }
    const prospectiveLength = countUnicodeGraphemes(
      canonicalText.slice(first.startCodeUnit, candidate.endCodeUnit),
    );
    if (coreUnits.length > 0 && prospectiveLength > maxWindowChars) break;
    coreUnits.push(candidate);
    cursor += 1;
  }

  // Look-ahead is prompt context, not an independently coverable range. It deliberately overlaps
  // the next request when the model keeps the nominal core boundary. The final core-starting chunk
  // may consume part/all of it, which makes the actual committed boundary semantic rather than a
  // fixed maxWindowChars cut. A maxChunkChars budget is sufficient because no valid chunk can
  // extend farther than that hard Unicode-grapheme cap.
  const lookAheadUnits: AtomicUnit[] = [];
  const firstLookAhead = units[cursor];
  while (firstLookAhead && cursor < units.length) {
    if (
      (planningPolicy.version === "v3" || planningPolicy.version === "v4") &&
      lookAheadUnits.length >= V3_MAX_LOOK_AHEAD_UNITS_PER_WINDOW
    ) {
      break;
    }
    const candidate = units[cursor] as AtomicUnit;
    if (planningPolicy.version === "v1" && !isLegacyWindowCompatible(first, candidate)) {
      break;
    }
    const prospectiveLength = countUnicodeGraphemes(
      canonicalText.slice(firstLookAhead.startCodeUnit, candidate.endCodeUnit),
    );
    if (lookAheadUnits.length > 0 && prospectiveLength > maxChunkChars) break;
    if (prospectiveLength > maxChunkChars) break;
    lookAheadUnits.push(candidate);
    cursor += 1;
  }

  const id = `window-${windowIndex.toString().padStart(6, "0")}`;
  const sectionPath = commonSectionPath(coreUnits.map((unit) => unit.sectionPath));
  const fingerprintSource =
    planningPolicy.version === "v1"
      ? {
          lookAheadUnits: lookAheadUnits.map((unit) => semanticPromptUnit(unit, "v1")),
          sectionPath: [...first.sectionPath],
          units: coreUnits.map((unit) => semanticPromptUnit(unit, "v1")),
          windowId: id,
        }
      : {
          atomicDocument: planningPolicy.atomicDocument,
          lookAheadUnits: lookAheadUnits.map((unit) =>
            semanticPromptUnit(unit, planningPolicy.version),
          ),
          planningVersion: planningPolicy.version,
          sectionPath,
          units: coreUnits.map((unit) => semanticPromptUnit(unit, planningPolicy.version)),
          windowId: id,
        };
  return {
    atomicDocument: planningPolicy.atomicDocument,
    id,
    inputFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(fingerprintSource))
      .digest("hex")}`,
    lookAheadUnits,
    planningVersion: planningPolicy.version,
    sectionPath: planningPolicy.version === "v1" ? [...first.sectionPath] : sectionPath,
    units: coreUnits,
  };
}

function semanticPromptUnit(
  unit: AtomicUnit,
  planningVersion: SemanticWindowPlanningVersion,
): {
  readonly boundaryPolicy?: "isolated" | undefined;
  readonly graphemeLength: number;
  readonly id: string;
  readonly sourceElementId?: string | undefined;
  readonly sourceSectionPath?: readonly string[] | undefined;
  readonly text: string;
  readonly type: string;
} {
  const carriesParserProvenance = planningVersion !== "v1";
  return {
    ...(carriesParserProvenance && unit.isolationKey
      ? { boundaryPolicy: "isolated" as const }
      : {}),
    graphemeLength: unit.graphemeLength,
    id: unit.id,
    ...(carriesParserProvenance
      ? {
          sourceElementId: unit.elementId,
          sourceSectionPath: [...unit.sectionPath],
        }
      : {}),
    text: unit.text,
    type: unit.elementType,
  };
}

function isLegacyWindowCompatible(first: AtomicUnit, candidate: AtomicUnit): boolean {
  return (
    sameStrings(first.sectionPath, candidate.sectionPath) &&
    first.isolationKey === candidate.isolationKey &&
    (first.isolationKey === undefined || first.elementId === candidate.elementId)
  );
}

function commonSectionPath(paths: readonly (readonly string[])[]): string[] {
  const first = paths[0];
  if (!first) return [];
  let length = first.length;
  for (const path of paths.slice(1)) {
    length = Math.min(length, path.length);
    let index = 0;
    while (index < length && first[index] === path[index]) index += 1;
    length = index;
    if (length === 0) break;
  }
  return first.slice(0, length);
}

function semanticChunkingMessages({
  enableGraph,
  enablePageIndex,
  maxChunkChars,
  maxEntitiesPerChunk,
  maxRelationsPerChunk,
  window,
}: {
  readonly enableGraph: boolean;
  readonly enablePageIndex: boolean;
  readonly maxChunkChars: number;
  readonly maxEntitiesPerChunk: number;
  readonly maxRelationsPerChunk: number;
  readonly window: SemanticWindow;
}): readonly SemanticChunkingLlmMessage[] {
  const carriesParserProvenance = window.planningVersion !== "v1";
  return [
    {
      content: [
        "You choose semantically complete chunk boundaries in one pass.",
        enableGraph
          ? "Graph extraction is enabled: extract grounded entities and relations while choosing boundaries."
          : "Graph extraction is disabled: return empty entities and relations arrays; do not spend effort identifying graph facts.",
        enablePageIndex
          ? "PageIndex is enabled: assign a concise semantic sectionPath and sectionSummary to every chunk."
          : "PageIndex is disabled: preserve only the supplied sectionPath, omit sectionSummary, and do not invent child section levels.",
        "Return strict JSON only. Never return, rewrite, summarize, correct, or duplicate source text.",
        "The units field is the core: cover every core unit exactly once, in order, by contiguous inclusive ranges.",
        ...(window.planningVersion === "v4"
          ? [
              "lookAheadUnits is read-only context. Never include a look-ahead unit in any returned range; another request owns it.",
              "The final range must end at the final unit in units so independent windows can be processed safely.",
            ]
          : [
              "lookAheadUnits is context-only. Only the final chunk may extend into it, and that final chunk must start in the core.",
              "Never emit a chunk that starts wholly in lookAheadUnits. Units not consumed from look-ahead will be reconsidered in the next request.",
            ]),
        "Ranges may be smaller than the maximum; prefer natural topic boundaries over filling chunks.",
        `Every range must contain at most ${maxChunkChars} Unicode graphemes including separators.`,
        `Return at most ${maxEntitiesPerChunk} entities and ${maxRelationsPerChunk} relations per chunk.`,
        "Allowed entity types: date, metric, organization, person, policy, product, term.",
        "Allowed relation types: mentions, defines, references, depends_on, supersedes, contradicts.",
        "Entity text must be an exact source substring. Give every entity a response-local unique id.",
        "Relations must reference entity ids from that same chunk through subjectEntityId/objectEntityId; never use names as relation endpoints.",
        ...(carriesParserProvenance
          ? [
              "Each unit carries its parser-derived sourceSectionPath. It is provenance, not a request boundary.",
              "Prefer natural source-section boundaries, but adjacent short sections may share a chunk when they form one coherent fact or record.",
              ...(window.atomicDocument
                ? []
                : [
                    "A unit marked boundaryPolicy=isolated must occupy a chunk containing only units from that same table or image element.",
                  ]),
              ...(window.atomicDocument
                ? [
                    "atomicDocument=true: the complete input is one short structured record. Return exactly one chunk covering every core unit; table boundaries are metadata, not retrieval boundaries.",
                  ]
                : []),
              ...(enablePageIndex
                ? [
                    "For each chunk, preserve the longest common sourceSectionPath prefix and add only meaningful semantic child levels.",
                  ]
                : [
                    "For each chunk, return only its longest common sourceSectionPath prefix and omit sectionSummary.",
                  ]),
            ]
          : enablePageIndex
            ? [
                "Preserve the supplied sectionPath as a prefix when it is non-empty; add only meaningful child levels.",
              ]
            : []),
        "Output shape:",
        '{"chunks":[{"startUnitId":"u-...","endUnitId":"u-...","sectionPath":["Policy","Eligibility"],"sectionSummary":"Who is eligible and under what conditions.","entities":[{"id":"e-1","text":"Acme","type":"organization","confidence":0.95,"canonicalName":"Acme Corp","aliases":["Acme"]},{"id":"e-2","text":"Policy A","type":"policy","confidence":0.9}],"relations":[{"subjectEntityId":"e-1","type":"references","objectEntityId":"e-2","confidence":0.9}]}]}',
      ].join("\n"),
      role: "system",
    },
    {
      content: JSON.stringify({
        ...(carriesParserProvenance ? { atomicDocument: window.atomicDocument } : {}),
        features: { enableGraph, enablePageIndex },
        ...(window.planningVersion === "v4" ? { fixedCoreBoundary: true } : {}),
        lookAheadUnits: window.lookAheadUnits.map((unit) =>
          semanticPromptUnit(unit, window.planningVersion),
        ),
        sectionPath: window.sectionPath,
        units: window.units.map((unit) => semanticPromptUnit(unit, window.planningVersion)),
        windowId: window.id,
      }),
      role: "user",
    },
  ];
}

async function collectProviderCompletion({
  maxOutputTokens,
  maxResponseChars,
  messages,
  model,
  provider,
  signal,
  temperature,
  tenantId,
}: {
  readonly maxOutputTokens: number;
  readonly maxResponseChars: number;
  readonly messages: readonly SemanticChunkingLlmMessage[];
  readonly model: string;
  readonly provider: SemanticChunkingLlmProvider;
  readonly signal?: AbortSignal | undefined;
  readonly temperature: number;
  readonly tenantId?: string | undefined;
}): Promise<CollectedProviderCompletion> {
  let text = "";
  let terminal:
    | {
        readonly finishReason?: string | undefined;
        readonly metadata?: unknown;
      }
    | undefined;
  for await (const event of provider.stream({
    maxOutputTokens,
    messages,
    model,
    ...(signal ? { signal } : {}),
    temperature,
    ...(tenantId ? { tenantId } : {}),
  })) {
    if (terminal) {
      throw new Error("LLM semantic chunking provider emitted data after its terminal event");
    }
    if (event.type === "delta" && event.delta) {
      text += event.delta;
      if (text.length > maxResponseChars) {
        throw new Error(
          `LLM semantic chunking response exceeds maxResponseChars=${maxResponseChars}`,
        );
      }
    }
    if (event.type === "done") {
      terminal = event;
    }
  }
  if (!terminal) {
    throw new Error("LLM semantic chunking provider ended without a terminal event");
  }
  if (!text.trim()) {
    throw new Error("LLM semantic chunking provider returned an empty response");
  }
  const finishReason = terminalStringField(terminal.finishReason, "finishReason");
  const actualModel = terminalMetadataStringField(terminal.metadata, "model");
  const actualProvider = terminalMetadataStringField(terminal.metadata, "provider");
  if (actualModel && actualModel !== model) {
    throw new Error(
      `LLM semantic chunking provider completed with model=${actualModel}, expected frozen model=${model}`,
    );
  }
  if (
    provider.kind === "plugin-daemon" &&
    (actualModel !== model || actualProvider !== "plugin-daemon")
  ) {
    throw new Error(
      "LLM semantic chunking plugin-daemon completion must report the frozen model and plugin-daemon provider",
    );
  }
  return {
    ...(actualModel ? { actualModel } : {}),
    ...(actualProvider ? { actualProvider } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(terminal.metadata === undefined ? {} : { metadata: terminal.metadata }),
    text,
  };
}

function semanticWindowCheckpointScope(
  input: SemanticChunkerInput,
  checkpoints: DocumentSemanticWindowCheckpointRepository | undefined,
): DocumentSemanticWindowCheckpointScope | undefined {
  if (!checkpoints || !input.tenantId?.trim() || !input.publicationGenerationId) return undefined;
  return {
    documentAssetId: input.parseArtifact.documentAssetId,
    documentVersion: input.parseArtifact.version,
    knowledgeSpaceId: input.knowledgeSpaceId,
    publicationGenerationId: input.publicationGenerationId,
    tenantId: input.tenantId,
  };
}

function semanticWindowModelFingerprint(input: {
  readonly enableGraph: boolean;
  readonly enablePageIndex: boolean;
  readonly promptVersion: string;
  readonly selection: KnowledgeSpaceModelSelection;
}): string {
  return `sha256:${createHash("sha256").update(stableJson(input), "utf8").digest("hex")}`;
}

function semanticCompletionCheckpointMetadata(
  completion: CollectedProviderCompletion,
): Readonly<Record<string, unknown>> {
  return {
    ...(completion.actualModel ? { actualModel: completion.actualModel } : {}),
    ...(completion.actualProvider ? { actualProvider: completion.actualProvider } : {}),
    ...(completion.finishReason ? { finishReason: completion.finishReason } : {}),
  };
}

function semanticCompletionFromCheckpoint(
  checkpoint: DocumentSemanticWindowCheckpoint,
): CollectedProviderCompletion {
  const completion = checkpoint.completion;
  return {
    ...(checkpointString(completion.actualModel, "actualModel")
      ? { actualModel: checkpointString(completion.actualModel, "actualModel") }
      : {}),
    ...(checkpointString(completion.actualProvider, "actualProvider")
      ? { actualProvider: checkpointString(completion.actualProvider, "actualProvider") }
      : {}),
    ...(checkpointString(completion.finishReason, "finishReason")
      ? { finishReason: checkpointString(completion.finishReason, "finishReason") }
      : {}),
    text: checkpoint.responseText,
  };
}

function checkpointString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Semantic window checkpoint ${label} is invalid`);
  }
  return value.trim();
}

function terminalMetadataStringField(
  metadata: unknown,
  field: "model" | "provider",
): string | undefined {
  if (!isPlainObject(metadata) || !Object.hasOwn(metadata, field)) {
    return undefined;
  }
  const value = metadata[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LLM semantic chunking terminal metadata ${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  assertBoundedOptionalCompletionField(
    normalized,
    field,
    field === "model" ? MAX_COMPLETION_MODEL_CHARS : MAX_COMPLETION_PROVIDER_CHARS,
    "terminal",
  );
  return normalized;
}

function terminalStringField(value: unknown, field: "finishReason"): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LLM semantic chunking terminal ${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  assertBoundedOptionalCompletionField(
    normalized,
    field,
    MAX_COMPLETION_FINISH_REASON_CHARS,
    "terminal",
  );
  return normalized;
}

function parseSemanticChunkingOutput(text: string): LlmSemanticChunkingOutput {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("LLM semantic chunking provider returned non-JSON output");
    }
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch (error) {
      throw new Error("LLM semantic chunking provider returned invalid JSON", { cause: error });
    }
  }
  try {
    return LlmSemanticChunkingOutputSchema.parse(parsed);
  } catch (error) {
    throw new Error("LLM semantic chunking provider returned an invalid response schema", {
      cause: error,
    });
  }
}

function validateAndMaterializeWindowOutput({
  maxChunkChars,
  maxEntitiesPerChunk,
  maxRelationsPerChunk,
  output,
  window,
}: {
  readonly maxChunkChars: number;
  readonly maxEntitiesPerChunk: number;
  readonly maxRelationsPerChunk: number;
  readonly output: LlmSemanticChunkingOutput;
  readonly window: SemanticWindow;
}): WindowMaterializedChunk[] {
  if (output.chunks.length === 0) {
    throw new Error("LLM semantic chunking response did not cover any input units");
  }
  if (window.atomicDocument && output.chunks.length !== 1) {
    throw new Error("LLM semantic chunking atomic document must produce exactly one chunk");
  }
  const eligibleUnits = [...window.units, ...window.lookAheadUnits];
  const unitIndex = new Map(eligibleUnits.map((unit, index) => [unit.id, index]));
  const chunks: UncommittedWindowChunk[] = [];
  const coreEnd = window.units.length - 1;
  let expectedStart = 0;

  for (const candidate of output.chunks) {
    const start = unitIndex.get(candidate.startUnitId);
    const end = unitIndex.get(candidate.endUnitId);
    if (start === undefined || end === undefined) {
      throw new Error("LLM semantic chunking response referenced an unknown unit ID");
    }
    if (start !== expectedStart || end < start) {
      throw new Error(
        "LLM semantic chunking response must cover units contiguously without gaps or overlap",
      );
    }
    if (window.planningVersion === "v4" && end > coreEnd) {
      throw new Error(
        "LLM semantic chunking v4 response must not commit read-only look-ahead units",
      );
    }
    const chunkUnits = eligibleUnits.slice(start, end + 1);
    const first = chunkUnits[0] as AtomicUnit;
    const last = chunkUnits.at(-1) as AtomicUnit;
    const chunkText = chunkUnits
      .map((unit) => unit.text)
      .reduce((combined, text, index) => {
        if (index === 0) return text;
        const previous = chunkUnits[index - 1] as AtomicUnit;
        const separator =
          previous.endCodeUnit === (chunkUnits[index] as AtomicUnit).startCodeUnit
            ? ""
            : DOCUMENT_ELEMENT_SEPARATOR;
        return `${combined}${separator}${text}`;
      }, "");
    if (countUnicodeGraphemes(chunkText) > maxChunkChars) {
      throw new Error(`LLM semantic chunking response exceeded maxChunkChars=${maxChunkChars}`);
    }
    if (!window.atomicDocument && !respectsIsolatedElementBoundaries(chunkUnits)) {
      throw new Error(
        "LLM semantic chunking response must keep table and image elements in isolated chunks",
      );
    }
    if (candidate.entities.length > maxEntitiesPerChunk) {
      throw new Error(
        `LLM semantic chunking response exceeded maxEntitiesPerChunk=${maxEntitiesPerChunk}`,
      );
    }
    if (candidate.relations.length > maxRelationsPerChunk) {
      throw new Error(
        `LLM semantic chunking response exceeded maxRelationsPerChunk=${maxRelationsPerChunk}`,
      );
    }

    const declaredEntityIds = new Set<string>();
    const entitiesById = new Map<string, LlmSemanticEntity>();
    for (const entity of candidate.entities) {
      if (declaredEntityIds.has(entity.id)) {
        throw new Error("LLM semantic chunking entity ids must be unique within the same chunk");
      }
      declaredEntityIds.add(entity.id);
      const grounded = groundEntity(entity, chunkText);
      if (grounded) {
        entitiesById.set(grounded.id, grounded);
      }
    }
    const relations: MaterializedSemanticRelation[] = [];
    for (const relation of candidate.relations) {
      if (
        !declaredEntityIds.has(relation.subjectEntityId) ||
        !declaredEntityIds.has(relation.objectEntityId)
      ) {
        throw new Error(
          "LLM semantic chunking relation endpoint ids must reference entities in the same chunk",
        );
      }
      const subject = entitiesById.get(relation.subjectEntityId);
      const object = entitiesById.get(relation.objectEntityId);
      if (!subject || !object) {
        // Entity text that cannot be grounded in the immutable chunk is untrusted. Discard every
        // relation that depends on it rather than allowing hallucinated graph data to escape or
        // failing an otherwise valid semantic boundary decision.
        continue;
      }
      relations.push({
        confidence: relation.confidence,
        object: object.canonicalName ?? object.text,
        objectEntityId: object.id,
        subject: subject.canonicalName ?? subject.text,
        subjectEntityId: subject.id,
        type: relation.type,
      });
    }
    const trustedSectionPrefix = commonSectionPath(chunkUnits.map((unit) => unit.sectionPath));
    const sectionPath = resolveSemanticSectionPath(candidate.sectionPath, trustedSectionPrefix);
    const kind = commonSpecialKind(chunkUnits) ?? "chunk";
    chunks.push({
      endUnitId: last.id,
      entities: [...entitiesById.values()],
      kind,
      relations,
      sectionPath,
      ...(candidate.sectionSummary ? { sectionSummary: candidate.sectionSummary } : {}),
      startUnitId: first.id,
      units: chunkUnits,
      window,
    });
    expectedStart = end + 1;
  }

  const finalChunk = chunks.at(-1);
  const finalStart = finalChunk ? unitIndex.get(finalChunk.startUnitId) : undefined;
  const finalEnd = finalChunk ? unitIndex.get(finalChunk.endUnitId) : undefined;
  if (finalStart === undefined || finalEnd === undefined || finalEnd < coreEnd) {
    throw new Error(
      "LLM semantic chunking response must cover units contiguously without gaps or overlap",
    );
  }
  if (finalStart > coreEnd) {
    throw new Error("LLM semantic chunking final chunk must start in the core window");
  }
  if (window.planningVersion === "v4" && finalEnd !== coreEnd) {
    throw new Error("LLM semantic chunking v4 response must end at the fixed core boundary");
  }
  const commitEndUnitId = eligibleUnits[finalEnd]?.id;
  if (!commitEndUnitId) {
    throw new Error("LLM semantic chunking response has an invalid committed boundary");
  }
  return chunks.map((chunk) => ({ ...chunk, windowCommitEndUnitId: commitEndUnitId }));
}

function respectsIsolatedElementBoundaries(units: readonly AtomicUnit[]): boolean {
  const isolated = units.filter((unit) => unit.isolationKey !== undefined);
  if (isolated.length === 0) return true;
  const isolationKey = isolated[0]?.isolationKey;
  return isolationKey !== undefined && units.every((unit) => unit.isolationKey === isolationKey);
}

function groundEntity(entity: LlmSemanticEntity, chunkText: string): LlmSemanticEntity | undefined {
  const text = entity.text.trim();
  if (!chunkText.includes(text)) {
    return undefined;
  }
  return {
    ...(entity.aliases
      ? { aliases: [...new Set(entity.aliases.map((alias) => alias.trim()))] }
      : {}),
    ...(entity.canonicalName ? { canonicalName: entity.canonicalName.trim() } : {}),
    confidence: entity.confidence,
    id: entity.id,
    text,
    type: entity.type,
  };
}

function resolveSemanticSectionPath(
  proposed: readonly string[] | undefined,
  trustedPrefix: readonly string[],
): string[] {
  const path = proposed ? proposed.map((segment) => segment.trim()) : [...trustedPrefix];
  if (
    trustedPrefix.length > 0 &&
    !sameStrings(path.slice(0, trustedPrefix.length), trustedPrefix)
  ) {
    // Section provenance belongs to the immutable parser input. A model may refine it with child
    // levels, but it cannot replace that trusted prefix. Discard an unrelated proposal instead of
    // failing an otherwise grounded semantic-boundary decision for the whole document.
    return [...trustedPrefix];
  }
  return path;
}

function hasValidSemanticSectionReplay(
  value: unknown,
  trustedPrefix: readonly string[],
  sourceSectionPath: readonly string[],
): boolean {
  if (!isPlainObject(value)) {
    return sameStrings(sourceSectionPath, trustedPrefix);
  }
  const path = arrayOfStrings(value.path);
  const summary = value.summary;
  return (
    (path.length >= 1 || trustedPrefix.length === 0) &&
    path.length <= 8 &&
    path.every((segment) => segment.length <= 160) &&
    sameStrings(path, sourceSectionPath) &&
    (trustedPrefix.length === 0 ||
      sameStrings(path.slice(0, trustedPrefix.length), trustedPrefix)) &&
    (summary === undefined ||
      (typeof summary === "string" && summary.trim().length > 0 && summary.length <= 2_000))
  );
}

function materializeKnowledgeNode({
  canonicalText,
  chunk,
  chunkIndex,
  documentChunkCount,
  extractedAt,
  input,
  layoutRecomposition,
  maxChunkChars,
  modelSelection,
  promptVersion,
  providerKind,
  requestedOverlapChars,
}: {
  readonly canonicalText: string;
  readonly chunk: MaterializedChunk;
  readonly chunkIndex: number;
  readonly documentChunkCount: number;
  readonly extractedAt: string;
  readonly input: SemanticChunkerInput;
  readonly layoutRecomposition: DocumentLayoutRecompositionStats & {
    readonly fingerprint: string;
  };
  readonly maxChunkChars: number;
  readonly modelSelection: KnowledgeSpaceModelSelection;
  readonly promptVersion: string;
  readonly providerKind?: string | undefined;
  readonly requestedOverlapChars: number;
}): KnowledgeNode {
  const first = chunk.units[0] as AtomicUnit;
  const last = chunk.units.at(-1) as AtomicUnit;
  const text = canonicalText.slice(first.startCodeUnit, last.endCodeUnit);
  const entities = chunk.entities.map((entity) => ({
    confidence: entity.confidence,
    metadata: {
      ...(entity.aliases && entity.aliases.length > 0 ? { aliases: entity.aliases } : {}),
      ...(entity.canonicalName ? { canonicalName: entity.canonicalName } : {}),
      responseEntityId: entity.id,
      source: "llm-semantic-chunking",
    },
    text: entity.text,
    type: entity.type,
  }));
  const relations = chunk.relations.map((relation) => ({
    confidence: relation.confidence,
    metadata: {
      objectEntityId: relation.objectEntityId,
      source: "llm-semantic-chunking",
      subjectEntityId: relation.subjectEntityId,
    },
    object: relation.object,
    subject: relation.subject,
    type: relation.type,
  }));
  const metadata: Record<string, unknown> = {
    chunkIndex,
    elementIds: uniqueStrings(chunk.units.map((unit) => unit.elementId)),
    elementSeparator: DOCUMENT_ELEMENT_SEPARATOR,
    elementTypes: uniqueStrings(chunk.units.map((unit) => unit.elementType)),
    entityExtraction: {
      completed: true,
      entityCount: entities.length,
      extractedAt,
      model: modelSelection.model,
      promptVersion,
      source: SEMANTIC_CHUNKING_STRATEGY,
    },
    extractedEntities: entities,
    extractedRelations: relations,
    offsetEncoding: DOCUMENT_OFFSET_ENCODING,
    relationExtraction: {
      completed: true,
      extractedAt,
      model: modelSelection.model,
      promptVersion,
      relationCount: relations.length,
      source: SEMANTIC_CHUNKING_STRATEGY,
    },
    semanticChunking: {
      completed: true,
      completion: {
        actual: {
          ...(chunk.completion.actualModel ? { model: chunk.completion.actualModel } : {}),
          ...(chunk.completion.actualProvider ? { provider: chunk.completion.actualProvider } : {}),
          ...(chunk.completion.finishReason ? { finishReason: chunk.completion.finishReason } : {}),
        },
        requested: cloneJsonObject(modelSelection),
      },
      documentChunkCount,
      inputFingerprint: chunk.window.inputFingerprint,
      layoutRecomposition: {
        elementsRecomposed: layoutRecomposition.elementsRecomposed,
        fingerprint: layoutRecomposition.fingerprint,
        modelDecidedHeadingBoundaries: layoutRecomposition.modelDecidedHeadingBoundaries,
        trustedHeadingBoundaries: layoutRecomposition.trustedHeadingBoundaries,
      },
      maxChunkChars,
      model: modelSelection.model,
      modelSelection: cloneJsonObject(modelSelection),
      overlapApplied: false,
      overlapPolicy: "non-overlapping-semantic-output",
      promptVersion,
      ...(providerKind ? { provider: providerKind } : {}),
      requestedOverlapChars,
      schemaVersion: SEMANTIC_CHUNKING_SCHEMA_VERSION,
      section: {
        path: [...chunk.sectionPath],
        ...(chunk.sectionSummary ? { summary: chunk.sectionSummary } : {}),
      },
      sourceSpans: semanticSourceSpans(chunk.units),
      strategy: SEMANTIC_CHUNKING_STRATEGY,
      unitRange: {
        endUnitId: chunk.endUnitId,
        startUnitId: chunk.startUnitId,
      },
      windowCommittedUnitRange: {
        endUnitId: chunk.windowCommitEndUnitId,
        startUnitId: (chunk.window.units[0] as AtomicUnit).id,
      },
      windowCoreUnitRange: {
        endUnitId: (chunk.window.units.at(-1) as AtomicUnit).id,
        startUnitId: (chunk.window.units[0] as AtomicUnit).id,
      },
      windowId: chunk.window.id,
      windowPlanning: {
        atomicDocument: chunk.window.atomicDocument,
        sourceSectionPathCount: new Set(
          chunk.window.units.map((unit) => stableJson(unit.sectionPath)),
        ).size,
        version: chunk.window.planningVersion,
      },
      ...(chunk.window.lookAheadUnits.length > 0
        ? {
            windowLookAheadUnitRange: {
              endUnitId: (chunk.window.lookAheadUnits.at(-1) as AtomicUnit).id,
              startUnitId: (chunk.window.lookAheadUnits[0] as AtomicUnit).id,
            },
          }
        : {}),
    },
    textNormalization: DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
  };
  if (uniqueStrings(chunk.units.map((unit) => unit.elementId)).length === 1) {
    mergeSingleElementMetadata(metadata, first.elementMetadata);
  }
  const pageNumber = commonPageNumber(chunk.units);

  return KnowledgeNodeSchema.parse({
    artifactHash: input.parseArtifact.artifactHash,
    documentAssetId: input.parseArtifact.documentAssetId,
    endOffset: last.endOffset,
    id: deterministicChildId(
      input.publicationGenerationId ?? input.parseArtifact.id,
      `${SEMANTIC_CHUNKING_STRATEGY}:${input.parseArtifact.id}:${input.parseArtifact.artifactHash}:${first.startOffset}:${last.endOffset}`,
    ),
    kind: chunk.kind,
    knowledgeSpaceId: input.knowledgeSpaceId,
    metadata,
    parseArtifactId: input.parseArtifact.id,
    permissionScope: [...(input.permissionScope ?? [])],
    ...(input.publicationGenerationId
      ? { publicationGenerationId: input.publicationGenerationId }
      : {}),
    sourceLocation: {
      endOffset: last.endOffset,
      ...(pageNumber === undefined ? {} : { pageNumber }),
      sectionPath: [...chunk.sectionPath],
      startOffset: first.startOffset,
    },
    startOffset: first.startOffset,
    text,
  });
}

function semanticSourceSpans(units: readonly AtomicUnit[]): Array<{
  readonly elementId: string;
  readonly elementType: string;
  readonly endOffset: number;
  readonly pageNumber?: number | undefined;
  readonly sectionPath: readonly string[];
  readonly startOffset: number;
}> {
  const spans: Array<{
    elementId: string;
    elementType: string;
    endOffset: number;
    pageNumber?: number | undefined;
    sectionPath: readonly string[];
    startOffset: number;
  }> = [];
  for (const unit of units) {
    const previous = spans.at(-1);
    if (
      previous &&
      previous.elementId === unit.elementId &&
      previous.elementType === unit.elementType &&
      previous.pageNumber === unit.pageNumber &&
      sameStrings(previous.sectionPath, unit.sectionPath)
    ) {
      previous.endOffset = unit.endOffset;
      continue;
    }
    spans.push({
      elementId: unit.elementId,
      elementType: unit.elementType,
      endOffset: unit.endOffset,
      ...(unit.pageNumber === undefined ? {} : { pageNumber: unit.pageNumber }),
      sectionPath: [...unit.sectionPath],
      startOffset: unit.startOffset,
    });
  }
  return spans;
}

function commonSpecialKind(units: readonly AtomicUnit[]): "image" | "table" | undefined {
  const first = units[0];
  if (
    first &&
    (first.elementType === "image" || first.elementType === "table") &&
    units.every(
      (unit) => unit.elementId === first.elementId && unit.elementType === first.elementType,
    )
  ) {
    return first.elementType;
  }
  return undefined;
}

function commonPageNumber(units: readonly AtomicUnit[]): number | undefined {
  const pageNumber = units[0]?.pageNumber;
  return units.every((unit) => unit.pageNumber === pageNumber) ? pageNumber : undefined;
}

function mergeSingleElementMetadata(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const key of [
    "assetRef",
    "boundingBox",
    "caption",
    "ocrText",
    "table",
    "textAsHtml",
    "title",
  ]) {
    if (Object.hasOwn(source, key)) {
      target[key] = JSON.parse(JSON.stringify(source[key])) as unknown;
    }
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`LLM semantic chunking ${name} must be at least 1`);
  }
}

function validateNonnegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`LLM semantic chunking ${name} must be a non-negative integer`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

const EntityTypeSchema = z.enum([
  "date",
  "metric",
  "organization",
  "person",
  "policy",
  "product",
  "term",
]);

const RelationTypeSchema = z.enum([
  "contradicts",
  "defines",
  "depends_on",
  "mentions",
  "references",
  "supersedes",
]);

const LlmSemanticEntitySchema = z
  .object({
    aliases: z.array(z.string().trim().min(1)).max(12).optional(),
    canonicalName: z.string().trim().min(1).optional(),
    confidence: z.number().finite().min(0).max(1),
    id: z.string().trim().min(1).max(128),
    text: z.string().trim().min(1),
    type: EntityTypeSchema,
  })
  .strict();

const LlmSemanticRelationSchema = z
  .object({
    confidence: z.number().finite().min(0).max(1),
    objectEntityId: z.string().trim().min(1).max(128),
    subjectEntityId: z.string().trim().min(1).max(128),
    type: RelationTypeSchema,
  })
  .strict();

const LlmSemanticChunkingOutputSchema = z
  .object({
    chunks: z.array(
      z
        .object({
          endUnitId: z.string().min(1),
          entities: z.array(LlmSemanticEntitySchema),
          relations: z.array(LlmSemanticRelationSchema),
          sectionPath: z.array(z.string().trim().min(1).max(160)).min(1).max(8).optional(),
          sectionSummary: z.string().trim().min(1).max(2_000).optional(),
          startUnitId: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

type LlmSemanticChunkingOutput = z.infer<typeof LlmSemanticChunkingOutputSchema>;
type LlmSemanticEntity = z.infer<typeof LlmSemanticEntitySchema>;
type LlmSemanticRelation = z.infer<typeof LlmSemanticRelationSchema>;
