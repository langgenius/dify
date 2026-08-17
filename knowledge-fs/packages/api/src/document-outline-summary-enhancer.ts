import { createHash } from "node:crypto";

import {
  type DocumentOutline,
  type DocumentOutlineNode,
  DocumentOutlineSchema,
  type KnowledgeSpaceRetrievalProfile,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";

import { createConcurrencyGate, mapWithConcurrency } from "./bounded-concurrency";
import { type DocumentModelBudget, estimateDocumentModelTokens } from "./document-model-budget";
import type {
  DocumentOutlineSummaryCheckpointRepository,
  DocumentOutlineSummaryCheckpointScope,
} from "./document-outline-summary-checkpoint-repository";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import { cloneJsonObject } from "./json-utils";

export interface DocumentOutlineSummaryProviderInput {
  readonly childSummaries: readonly string[];
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxSummaryChars: number;
  readonly outlineNodeId: string;
  readonly parseArtifactId: string;
  readonly promptVersion: string;
  readonly sectionPath: readonly string[];
  readonly signal?: AbortSignal | undefined;
  readonly text: string;
  readonly title: string;
  readonly traceId?: string | undefined;
}

export interface DocumentOutlineSummaryProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Provider attempts after the first request, when the adapter performs contract repair. */
  readonly retries?: number | undefined;
  readonly summary: string;
}

export interface DocumentOutlineSummaryProvider {
  summarize(
    input: DocumentOutlineSummaryProviderInput,
  ): Promise<DocumentOutlineSummaryProviderResult>;
  /**
   * Optional order-preserving batch capability. Implementations must return exactly one result for
   * every input. The enhancer falls back to single-node calls only for explicit contract errors.
   */
  summarizeBatch?(
    inputs: readonly DocumentOutlineSummaryProviderInput[],
  ): Promise<readonly DocumentOutlineSummaryProviderResult[]>;
}

export class DocumentOutlineSummaryBatchContractError extends Error {
  override readonly name = "DocumentOutlineSummaryBatchContractError";
}

export interface DocumentOutlineSummaryEnhancerOptions {
  readonly checkpoints?: DocumentOutlineSummaryCheckpointRepository | undefined;
  /** Bounds provider requests across all branches and batches of one outline tree. */
  readonly maxConcurrentSummaries?: number | undefined;
  readonly maxBatchInputChars?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly metrics?: DocumentOutlineSummaryOperationalMetrics | undefined;
  readonly modelCallMetrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly model: string;
  readonly now?: (() => number) | undefined;
  readonly promptVersion: string;
  readonly provider: DocumentOutlineSummaryProvider;
}

export interface DocumentOutlineSummaryOperationalMetric {
  readonly checkpointHits: number;
  readonly durationMs: number;
  readonly failureKind?: "timeout" | "rate_limited" | "other" | undefined;
  readonly nodeCount: number;
  readonly outcome: "succeeded" | "failed";
  readonly providerCalls: number;
  readonly reusedSemanticSummaries?: number | undefined;
}

export interface DocumentOutlineSummaryOperationalMetrics {
  record(metric: DocumentOutlineSummaryOperationalMetric): Promise<void> | void;
}

export interface EnhanceDocumentOutlineInput {
  readonly modelBudget?: DocumentModelBudget | undefined;
  readonly outline: DocumentOutline;
  readonly parseArtifact: ParseArtifact;
  /** Exact immutable retrieval profile frozen by a durable compilation attempt. */
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Required by profile-aware enhancers; fixed legacy enhancers may omit it. */
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface DocumentOutlineSummaryEnhancer {
  enhance(input: EnhanceDocumentOutlineInput): Promise<DocumentOutline>;
}

export function createDocumentOutlineSummaryEnhancer({
  checkpoints,
  maxConcurrentSummaries = 8,
  maxBatchInputChars = 32_000,
  maxBatchSize = 8,
  maxInputChars,
  maxSummaryChars,
  metrics,
  modelCallMetrics,
  model,
  now = Date.now,
  promptVersion,
  provider,
}: DocumentOutlineSummaryEnhancerOptions): DocumentOutlineSummaryEnhancer {
  validateDocumentOutlineSummaryEnhancerOptions({
    maxConcurrentSummaries,
    maxBatchInputChars,
    maxBatchSize,
    maxInputChars,
    maxSummaryChars,
    model,
    promptVersion,
  });
  const providerGate = createConcurrencyGate(maxConcurrentSummaries);

  return {
    enhance: async ({ modelBudget, outline, parseArtifact, signal, tenantId, traceId }) => {
      signal?.throwIfAborted();
      const parsedOutline = DocumentOutlineSchema.parse(outline);
      const artifact = ParseArtifactSchema.parse(parseArtifact);
      const startedAt = now();
      const stats = {
        checkpointHits: 0,
        inputTokens: 0,
        inputTokensObserved: false,
        outputTokens: 0,
        outputTokensObserved: false,
        providerCalls: 0,
        retries: 0,
        reusedSemanticSummaries: 0,
        totalTokens: 0,
        totalTokensObserved: false,
      };
      const instrumentedProvider = instrumentSummaryProvider(provider, stats, modelBudget);
      try {
        const nodes = await enhanceDocumentOutlineNodes({
          artifact,
          checkpoints,
          maxBatchInputChars,
          maxBatchSize,
          maxConcurrentSummaries,
          maxInputChars,
          maxSummaryChars,
          model,
          nodes: parsedOutline.nodes,
          outline: parsedOutline,
          promptVersion,
          provider: instrumentedProvider,
          providerGate,
          signal,
          stats,
          tenantId,
          traceId,
        });

        recordOutlineSummaryMetric(metrics, {
          checkpointHits: stats.checkpointHits,
          durationMs: Math.max(0, now() - startedAt),
          nodeCount: countOutlineNodes(parsedOutline.nodes),
          outcome: "succeeded",
          providerCalls: stats.providerCalls,
          reusedSemanticSummaries: stats.reusedSemanticSummaries,
        });
        recordIngestionModelCallMetric(modelCallMetrics, {
          cacheHits: stats.checkpointHits,
          durationMs: Math.max(0, now() - startedAt),
          itemCount: countOutlineNodes(parsedOutline.nodes),
          outcome: "succeeded",
          providerCalls: stats.providerCalls,
          reusedItems: stats.reusedSemanticSummaries,
          retries: stats.retries,
          stage: "outline-summary",
          ...(stats.inputTokensObserved ? { inputTokens: stats.inputTokens } : {}),
          ...(stats.outputTokensObserved ? { outputTokens: stats.outputTokens } : {}),
          ...(stats.totalTokensObserved ? { totalTokens: stats.totalTokens } : {}),
        });
        return DocumentOutlineSchema.parse({
          ...parsedOutline,
          metadata: {
            ...cloneJsonObject(parsedOutline.metadata),
            summary: {
              model,
              promptVersion,
              source: "provider",
            },
          },
          nodes,
        });
      } catch (error) {
        recordOutlineSummaryMetric(metrics, {
          checkpointHits: stats.checkpointHits,
          durationMs: Math.max(0, now() - startedAt),
          failureKind: outlineSummaryFailureKind(error),
          nodeCount: countOutlineNodes(parsedOutline.nodes),
          outcome: "failed",
          providerCalls: stats.providerCalls,
          reusedSemanticSummaries: stats.reusedSemanticSummaries,
        });
        recordIngestionModelCallMetric(modelCallMetrics, {
          cacheHits: stats.checkpointHits,
          durationMs: Math.max(0, now() - startedAt),
          itemCount: countOutlineNodes(parsedOutline.nodes),
          outcome: "failed",
          providerCalls: stats.providerCalls,
          reusedItems: stats.reusedSemanticSummaries,
          retries: stats.retries,
          stage: "outline-summary",
          ...(stats.inputTokensObserved ? { inputTokens: stats.inputTokens } : {}),
          ...(stats.outputTokensObserved ? { outputTokens: stats.outputTokens } : {}),
          ...(stats.totalTokensObserved ? { totalTokens: stats.totalTokens } : {}),
        });
        throw error;
      }
    },
  };
}

function validateDocumentOutlineSummaryEnhancerOptions({
  maxBatchInputChars,
  maxBatchSize,
  maxConcurrentSummaries,
  maxInputChars,
  maxSummaryChars,
  model,
  promptVersion,
}: {
  readonly maxBatchInputChars: number;
  readonly maxBatchSize: number;
  readonly maxConcurrentSummaries: number;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly promptVersion: string;
}): void {
  if (!Number.isInteger(maxConcurrentSummaries) || maxConcurrentSummaries < 1) {
    throw new Error("Document outline summary maxConcurrentSummaries must be at least 1");
  }

  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Document outline summary maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxBatchInputChars) || maxBatchInputChars < 1) {
    throw new Error("Document outline summary maxBatchInputChars must be at least 1");
  }

  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) {
    throw new Error("Document outline summary maxInputChars must be at least 1");
  }

  if (!Number.isInteger(maxSummaryChars) || maxSummaryChars < 1) {
    throw new Error("Document outline summary maxSummaryChars must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Document outline summary model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Document outline summary promptVersion is required");
  }
}

async function enhanceDocumentOutlineNodes({
  artifact,
  checkpoints,
  maxBatchInputChars,
  maxBatchSize,
  maxConcurrentSummaries,
  maxInputChars,
  maxSummaryChars,
  model,
  nodes,
  outline,
  promptVersion,
  provider,
  providerGate,
  signal,
  stats,
  tenantId,
  traceId,
}: {
  readonly artifact: ParseArtifact;
  readonly checkpoints?: DocumentOutlineSummaryCheckpointRepository | undefined;
  readonly maxBatchInputChars: number;
  readonly maxBatchSize: number;
  readonly maxConcurrentSummaries: number;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly nodes: readonly DocumentOutlineNode[];
  readonly outline: DocumentOutline;
  readonly promptVersion: string;
  readonly provider: DocumentOutlineSummaryProvider;
  readonly providerGate: ReturnType<typeof createConcurrencyGate>;
  readonly signal?: AbortSignal | undefined;
  readonly stats: SummaryStats;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}): Promise<DocumentOutlineNode[]> {
  const nodesByDepth = collectNodesByDepth(nodes);
  const summaries = new Map<string, DocumentOutlineSummaryProviderResult>();
  const summarizeBatch = provider.summarizeBatch;
  const checkpointScope = summaryCheckpointScope({ checkpoints, outline, tenantId });

  for (let depth = nodesByDepth.length - 1; depth >= 0; depth -= 1) {
    signal?.throwIfAborted();
    const levelNodes = nodesByDepth[depth] ?? [];
    const nodesRequiringProvider = levelNodes.filter((node) => {
      if (!canReuseSemanticLeafSummary(node)) return true;
      summaries.set(node.id, {
        metadata: { source: "semantic-chunking" },
        summary: node.summary as string,
      });
      stats.reusedSemanticSummaries += 1;
      return false;
    });
    const inputs = nodesRequiringProvider.map((node) =>
      summaryInput({
        artifact,
        maxInputChars,
        maxSummaryChars,
        node,
        outline,
        promptVersion,
        signal,
        summaries,
        traceId,
      }),
    );
    const keyedInputs = inputs.map((input) => ({
      input,
      inputFingerprint: summaryInputFingerprint(input, model),
    }));
    const cached = checkpointScope
      ? await checkpoints?.getMany({
          keys: keyedInputs.map(({ input, inputFingerprint }) => ({
            inputFingerprint,
            outlineNodeId: input.outlineNodeId,
          })),
          scope: checkpointScope,
        })
      : [];
    const cachedByKey = new Map(
      cached?.map((checkpoint) => [checkpointKey(checkpoint), checkpoint] as const) ?? [],
    );
    const missing = keyedInputs.filter(({ input, inputFingerprint }) => {
      const checkpoint = cachedByKey.get(
        checkpointKey({ inputFingerprint, outlineNodeId: input.outlineNodeId }),
      );
      if (!checkpoint) return true;
      summaries.set(input.outlineNodeId, {
        metadata: checkpoint.metadata,
        summary: checkpoint.summary,
      });
      stats.checkpointHits += 1;
      return false;
    });
    const persistResults = async (
      completedInputs: readonly DocumentOutlineSummaryProviderInput[],
      results: readonly DocumentOutlineSummaryProviderResult[],
    ): Promise<readonly DocumentOutlineSummaryProviderResult[]> => {
      if (!checkpointScope || !checkpoints) return results;
      return checkpoints.putMany({
        checkpoints: completedInputs.map((input, index) => {
          const result = results[index];
          if (!result) {
            throw new DocumentOutlineSummaryBatchContractError(
              "Document outline summary checkpoint received an incomplete result set",
            );
          }
          return {
            inputFingerprint: summaryInputFingerprint(input, model),
            metadata: result.metadata ?? {},
            outlineNodeId: input.outlineNodeId,
            summary: result.summary,
          };
        }),
        scope: checkpointScope,
      });
    };
    const missingInputs = missing.map(({ input }) => input);
    const levelResults = summarizeBatch
      ? await summarizeLevelInBatches({
          inputs: missingInputs,
          maxBatchInputChars,
          maxBatchSize,
          maxConcurrentBatches: maxConcurrentSummaries,
          onResults: persistResults,
          provider,
          providerGate,
          summarizeBatch,
        })
      : await mapWithConcurrency(missingInputs, maxConcurrentSummaries, async (input) => {
          const result = await providerGate.run(() => provider.summarize(input));
          const [persisted] = await persistResults([input], [result]);
          if (!persisted) {
            throw new Error("Document outline summary checkpoint result is missing");
          }
          return persisted;
        });

    for (let index = 0; index < missing.length; index += 1) {
      const pending = missing[index];
      const result = levelResults[index];
      if (!pending || !result) {
        throw new DocumentOutlineSummaryBatchContractError(
          "Document outline summary provider returned an incomplete result set",
        );
      }
      summaries.set(pending.input.outlineNodeId, result);
    }

    for (let index = 0; index < levelNodes.length; index += 1) {
      const node = levelNodes[index];
      const result = node ? summaries.get(node.id) : undefined;
      if (!node || !result) {
        throw new DocumentOutlineSummaryBatchContractError(
          "Document outline summary provider returned an incomplete result set",
        );
      }
      assertValidSummaryResult(result);
    }
  }

  return nodes.map((node) =>
    applySummaryResults({ maxSummaryChars, model, node, promptVersion, summaries }),
  );
}

function instrumentSummaryProvider(
  provider: DocumentOutlineSummaryProvider,
  stats: SummaryStats,
  modelBudget?: DocumentModelBudget,
): DocumentOutlineSummaryProvider {
  return {
    summarize: async (input) => {
      modelBudget?.reserve({
        estimatedTokens: estimatedSummaryTokens(input),
        itemCount: 1,
        stage: "outline-summary",
      });
      stats.providerCalls += 1;
      const result = await provider.summarize(input);
      stats.retries += validProviderRetries(result.retries);
      accumulateSummaryUsage(stats, result.metadata);
      return result;
    },
    ...(provider.summarizeBatch
      ? {
          summarizeBatch: async (inputs: readonly DocumentOutlineSummaryProviderInput[]) => {
            modelBudget?.reserve({
              estimatedTokens: inputs.reduce(
                (total, input) => total + estimatedSummaryTokens(input),
                0,
              ),
              itemCount: inputs.length,
              stage: "outline-summary",
            });
            stats.providerCalls += 1;
            const results = (await provider.summarizeBatch?.(inputs)) ?? [];
            stats.retries += validProviderRetries(results[0]?.retries);
            accumulateSummaryUsage(stats, results[0]?.metadata);
            return results;
          },
        }
      : {}),
  };
}

function estimatedSummaryTokens(input: DocumentOutlineSummaryProviderInput): number {
  return (
    estimateDocumentModelTokens(
      [input.title, input.text, ...input.sectionPath, ...input.childSummaries].join("\n"),
    ) + Math.ceil(input.maxSummaryChars / 3)
  );
}

interface SummaryStats {
  checkpointHits: number;
  inputTokens: number;
  inputTokensObserved: boolean;
  outputTokens: number;
  outputTokensObserved: boolean;
  providerCalls: number;
  retries: number;
  reusedSemanticSummaries: number;
  totalTokens: number;
  totalTokensObserved: boolean;
}

function validProviderRetries(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function canReuseSemanticLeafSummary(node: DocumentOutlineNode): boolean {
  return (
    node.children.length === 0 &&
    node.metadata.summarySource === "semantic-chunking" &&
    typeof node.summary === "string" &&
    node.summary.trim().length > 0
  );
}

function accumulateSummaryUsage(stats: SummaryStats, metadata: unknown): void {
  const usage = ingestionModelUsageFromMetadata(metadata);
  if (usage.inputTokens !== undefined) {
    stats.inputTokens += usage.inputTokens;
    stats.inputTokensObserved = true;
  }
  if (usage.outputTokens !== undefined) {
    stats.outputTokens += usage.outputTokens;
    stats.outputTokensObserved = true;
  }
  if (usage.totalTokens !== undefined) {
    stats.totalTokens += usage.totalTokens;
    stats.totalTokensObserved = true;
  }
}

function countOutlineNodes(nodes: readonly DocumentOutlineNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countOutlineNodes(node.children), 0);
}

function outlineSummaryFailureKind(
  error: unknown,
): NonNullable<DocumentOutlineSummaryOperationalMetric["failureKind"]> {
  const record = typeof error === "object" && error !== null ? error : undefined;
  const code = record && "code" in record ? String(record.code).toLowerCase() : "";
  const status = record && "status" in record ? Number(record.status) : undefined;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (status === 429 || code.includes("429") || code.includes("rate_limit")) {
    return "rate_limited";
  }
  if (
    code.includes("timeout") ||
    code.includes("timedout") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }
  return "other";
}

function recordOutlineSummaryMetric(
  metrics: DocumentOutlineSummaryOperationalMetrics | undefined,
  metric: DocumentOutlineSummaryOperationalMetric,
): void {
  if (!metrics) return;
  try {
    const pending = metrics.record(metric);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Optional telemetry cannot own summaries or checkpoint durability.
  }
}

function collectNodesByDepth(nodes: readonly DocumentOutlineNode[]): DocumentOutlineNode[][] {
  const byDepth: DocumentOutlineNode[][] = [];
  const visit = (node: DocumentOutlineNode, depth: number): void => {
    const nodesAtDepth = byDepth[depth] ?? [];
    nodesAtDepth.push(node);
    byDepth[depth] = nodesAtDepth;
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };
  for (const node of nodes) {
    visit(node, 0);
  }
  return byDepth;
}

function summaryInput({
  artifact,
  maxInputChars,
  maxSummaryChars,
  node,
  outline,
  promptVersion,
  signal,
  summaries,
  traceId,
}: {
  readonly artifact: ParseArtifact;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly node: DocumentOutlineNode;
  readonly outline: DocumentOutline;
  readonly promptVersion: string;
  readonly signal?: AbortSignal | undefined;
  readonly summaries: ReadonlyMap<string, DocumentOutlineSummaryProviderResult>;
  readonly traceId?: string | undefined;
}): DocumentOutlineSummaryProviderInput {
  return {
    childSummaries: node.children.map((child) => {
      const result = summaries.get(child.id);
      if (!result) {
        throw new Error(`Document outline child summary is missing for node ${child.id}`);
      }
      return result.summary.trim();
    }),
    documentAssetId: outline.documentAssetId,
    knowledgeSpaceId: outline.knowledgeSpaceId,
    maxSummaryChars,
    outlineNodeId: node.id,
    parseArtifactId: outline.parseArtifactId,
    promptVersion,
    sectionPath: [...node.sectionPath],
    ...(signal ? { signal } : {}),
    text: truncateText(sectionText(artifact, node), maxInputChars),
    title: node.title,
    ...(traceId ? { traceId } : {}),
  };
}

async function summarizeLevelInBatches({
  inputs,
  maxBatchInputChars,
  maxBatchSize,
  maxConcurrentBatches,
  onResults,
  provider,
  providerGate,
  summarizeBatch,
}: {
  readonly inputs: readonly DocumentOutlineSummaryProviderInput[];
  readonly maxBatchInputChars: number;
  readonly maxBatchSize: number;
  readonly maxConcurrentBatches: number;
  readonly onResults: (
    inputs: readonly DocumentOutlineSummaryProviderInput[],
    results: readonly DocumentOutlineSummaryProviderResult[],
  ) => Promise<readonly DocumentOutlineSummaryProviderResult[]>;
  readonly provider: DocumentOutlineSummaryProvider;
  readonly providerGate: ReturnType<typeof createConcurrencyGate>;
  readonly summarizeBatch: NonNullable<DocumentOutlineSummaryProvider["summarizeBatch"]>;
}): Promise<DocumentOutlineSummaryProviderResult[]> {
  const batches = partitionSummaryInputs(inputs, maxBatchSize, maxBatchInputChars);
  const batchResults = await mapWithConcurrency(batches, maxConcurrentBatches, async (batch) => {
    try {
      const results = await providerGate.run(() => summarizeBatch(batch));
      if (results.length !== batch.length) {
        throw new DocumentOutlineSummaryBatchContractError(
          `Document outline summary batch returned ${results.length} results for ${batch.length} inputs`,
        );
      }
      return [...(await onResults(batch, results))];
    } catch (error) {
      if (!(error instanceof DocumentOutlineSummaryBatchContractError)) {
        throw error;
      }
      return mapWithConcurrency(batch, maxConcurrentBatches, async (input) => {
        const result = await providerGate.run(() => provider.summarize(input));
        const [persisted] = await onResults([input], [result]);
        if (!persisted) {
          throw new Error("Document outline summary checkpoint result is missing");
        }
        return persisted;
      });
    }
  });
  return batchResults.flat();
}

function summaryCheckpointScope({
  checkpoints,
  outline,
  tenantId,
}: {
  readonly checkpoints?: DocumentOutlineSummaryCheckpointRepository | undefined;
  readonly outline: DocumentOutline;
  readonly tenantId?: string | undefined;
}): DocumentOutlineSummaryCheckpointScope | undefined {
  if (!checkpoints || !outline.publicationGenerationId || !tenantId?.trim()) return undefined;
  return {
    documentAssetId: outline.documentAssetId,
    documentVersion: outline.version,
    knowledgeSpaceId: outline.knowledgeSpaceId,
    publicationGenerationId: outline.publicationGenerationId,
    tenantId,
  };
}

function summaryInputFingerprint(
  input: DocumentOutlineSummaryProviderInput,
  model: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        childSummaries: input.childSummaries,
        maxSummaryChars: input.maxSummaryChars,
        model,
        outlineNodeId: input.outlineNodeId,
        promptVersion: input.promptVersion,
        sectionPath: input.sectionPath,
        text: input.text,
        title: input.title,
      }),
      "utf8",
    )
    .digest("hex");
  return `sha256:${digest}`;
}

function checkpointKey(key: {
  readonly inputFingerprint: string;
  readonly outlineNodeId: string;
}): string {
  return `${key.outlineNodeId}\u001f${key.inputFingerprint}`;
}

function partitionSummaryInputs(
  inputs: readonly DocumentOutlineSummaryProviderInput[],
  maxBatchSize: number,
  maxBatchInputChars: number,
): DocumentOutlineSummaryProviderInput[][] {
  const batches: DocumentOutlineSummaryProviderInput[][] = [];
  let current: DocumentOutlineSummaryProviderInput[] = [];
  let currentChars = 0;
  for (const input of inputs) {
    const inputChars = JSON.stringify({
      childSummaries: input.childSummaries,
      sectionPath: input.sectionPath,
      text: input.text,
      title: input.title,
    }).length;
    if (
      current.length > 0 &&
      (current.length >= maxBatchSize || currentChars + inputChars > maxBatchInputChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(input);
    currentChars += inputChars;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function assertValidSummaryResult(result: DocumentOutlineSummaryProviderResult): void {
  if (!result.summary.trim()) {
    throw new Error("Document outline summary provider returned an empty summary");
  }
}

function applySummaryResults({
  maxSummaryChars,
  model,
  node,
  promptVersion,
  summaries,
}: {
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly node: DocumentOutlineNode;
  readonly promptVersion: string;
  readonly summaries: ReadonlyMap<string, DocumentOutlineSummaryProviderResult>;
}): DocumentOutlineNode {
  const providerResult = summaries.get(node.id);
  if (!providerResult) {
    throw new Error(`Document outline summary is missing for node ${node.id}`);
  }
  return DocumentOutlineSchema.shape.nodes.element.parse({
    ...node,
    children: node.children.map((child) =>
      applySummaryResults({ maxSummaryChars, model, node: child, promptVersion, summaries }),
    ),
    metadata: {
      ...cloneJsonObject(node.metadata),
      summary: {
        ...(providerResult.metadata ? { metadata: cloneJsonObject(providerResult.metadata) } : {}),
        model,
        promptVersion,
        source: "provider",
      },
    },
    summary: truncateText(providerResult.summary.trim(), maxSummaryChars),
  });
}

function sectionText(artifact: ParseArtifact, node: DocumentOutlineNode): string {
  return artifact.elements
    .filter((element) => elementSectionStartsWith(element.sectionPath, node.sectionPath))
    .map((element) => element.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function elementSectionStartsWith(
  elementSectionPath: readonly string[],
  selectedSectionPath: readonly string[],
): boolean {
  if (
    selectedSectionPath.length === 1 &&
    selectedSectionPath[0] === "Document" &&
    elementSectionPath.length === 0
  ) {
    return true;
  }

  return selectedSectionPath.every((segment, index) => elementSectionPath[index] === segment);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - 3)}...`;
}
