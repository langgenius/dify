import { createHash } from "node:crypto";

import type { CacheAdapter, KnowledgeNode } from "@knowledge/core";

import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  type KnowledgeNodeRepository,
  type UpdateKnowledgeNodeMetadataPatch,
  cloneKnowledgeNode,
} from "./knowledge-node-repository";
import {
  cacheNamespaceSegment,
  knowledgeSpaceCacheNamespace,
} from "./knowledge-space-cache-namespace";

export interface ContextualEnrichmentProviderInput {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly prompt: string;
  readonly promptVersion: string;
}

export interface ContextualEnrichmentProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly text: string;
}

export interface ContextualEnrichmentProvider {
  generate(input: ContextualEnrichmentProviderInput): Promise<ContextualEnrichmentProviderResult>;
}

export interface ContextualEnrichmentFlowOptions {
  readonly cache?: CacheAdapter | undefined;
  readonly cacheTtlMs?: number | undefined;
  readonly estimatedCostUsdPerNode?: number | undefined;
  readonly maxBatchSize: number;
  readonly maxEstimatedCostUsd?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly minQualityScore?: number | undefined;
  readonly model: string;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly promptVersion?: string | undefined;
  readonly provider: ContextualEnrichmentProvider;
}

export interface EnrichKnowledgeNodesInput {
  readonly forceRefresh?: boolean | undefined;
  readonly knowledgeSpaceId: string;
  readonly nodeIds: readonly string[];
  readonly traceId?: string | undefined;
}

export interface ContextualEnrichmentSkippedNode {
  readonly id: string;
  readonly reason: "already-enriched" | "quality-threshold";
}

export interface ContextualEnrichmentResult {
  readonly enrichedNodes: KnowledgeNode[];
  readonly missingNodeIds: readonly string[];
  readonly skippedNodes?: readonly ContextualEnrichmentSkippedNode[] | undefined;
}

export interface ContextualEnrichmentFlow {
  enrich(input: EnrichKnowledgeNodesInput): Promise<ContextualEnrichmentResult>;
}

const MAX_CONTEXTUAL_ENRICHMENT_CACHE_BYTES = 64 * 1024;

interface CachedContextualEnrichment {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly text: string;
}

export function createContextualEnrichmentFlow({
  cache,
  cacheTtlMs,
  estimatedCostUsdPerNode = 0,
  maxBatchSize,
  maxEstimatedCostUsd,
  maxOutputTokens = 256,
  minQualityScore,
  model,
  nodes,
  now = () => new Date().toISOString(),
  promptVersion = "contextual-enrichment-v1",
  provider,
}: ContextualEnrichmentFlowOptions): ContextualEnrichmentFlow {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Contextual enrichment maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Contextual enrichment maxOutputTokens must be at least 1");
  }

  if (cacheTtlMs !== undefined && (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 1)) {
    throw new Error("Contextual enrichment cacheTtlMs must be at least 1");
  }

  if (!Number.isFinite(estimatedCostUsdPerNode) || estimatedCostUsdPerNode < 0) {
    throw new Error("Contextual enrichment estimatedCostUsdPerNode must be non-negative");
  }

  if (
    maxEstimatedCostUsd !== undefined &&
    (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd < 0)
  ) {
    throw new Error("Contextual enrichment maxEstimatedCostUsd must be non-negative");
  }

  if (
    minQualityScore !== undefined &&
    (!Number.isFinite(minQualityScore) || minQualityScore < 0 || minQualityScore > 1)
  ) {
    throw new Error("Contextual enrichment minQualityScore must be between 0 and 1");
  }

  if (!model.trim()) {
    throw new Error("Contextual enrichment model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Contextual enrichment promptVersion is required");
  }

  return {
    enrich: async ({ forceRefresh = false, knowledgeSpaceId, nodeIds, traceId }) => {
      validateContextualEnrichmentInput({ knowledgeSpaceId, maxBatchSize, nodeIds });
      const uniqueNodeIds = uniqueStrings(nodeIds);
      const loadedNodes = await nodes.getMany({
        ids: uniqueNodeIds,
        knowledgeSpaceId,
      });
      const nodesById = new Map(loadedNodes.map((node) => [node.id, node]));
      const orderedNodes = uniqueNodeIds.flatMap((id) => {
        const node = nodesById.get(id);

        return node ? [cloneKnowledgeNode(node)] : [];
      });
      const missingNodeIds = uniqueNodeIds.filter((id) => !nodesById.has(id));
      const skippedNodes: ContextualEnrichmentSkippedNode[] = [];
      const candidates = orderedNodes.filter((node) => {
        if (!forceRefresh && hasContextualDescription(node)) {
          skippedNodes.push({ id: node.id, reason: "already-enriched" });

          return false;
        }

        return true;
      });
      const cacheHits: UpdateKnowledgeNodeMetadataPatch[] = [];
      const providerCandidates: KnowledgeNode[] = [];

      for (const node of candidates) {
        const cached = cache
          ? await readContextualEnrichmentCache({
              cache,
              key: contextualEnrichmentCacheKey({ model, node, promptVersion }),
            })
          : null;

        if (cached) {
          cacheHits.push({
            id: node.id,
            metadata: contextualEnrichmentMetadata({
              cacheHit: true,
              description: cached.text,
              metadata: cached.metadata,
              model,
              node,
              now,
              promptVersion,
              traceId,
            }),
          });
        } else {
          providerCandidates.push(node);
        }
      }

      const estimatedCost = estimatedCostUsdPerNode * providerCandidates.length;
      if (maxEstimatedCostUsd !== undefined && estimatedCost > maxEstimatedCostUsd) {
        throw new Error(
          `Contextual enrichment estimated cost ${formatUsd(
            estimatedCost,
          )} exceeds budget ${formatUsd(maxEstimatedCostUsd)}`,
        );
      }

      const generated = await Promise.all(
        providerCandidates.map(async (node) => {
          const result = await provider.generate({
            maxOutputTokens,
            model,
            node: cloneKnowledgeNode(node),
            prompt: contextualEnrichmentPrompt(node),
            promptVersion,
          });
          const description = result.text.trim();

          if (!description) {
            throw new Error("Contextual enrichment provider returned empty text");
          }

          if (isBelowContextualQualityThreshold(result.metadata, minQualityScore)) {
            skippedNodes.push({ id: node.id, reason: "quality-threshold" });

            return null;
          }

          if (cache) {
            await writeContextualEnrichmentCache({
              cache,
              key: contextualEnrichmentCacheKey({ model, node, promptVersion }),
              metadata: result.metadata,
              text: description,
              ttlMs: cacheTtlMs,
            });
          }

          return {
            id: node.id,
            metadata: contextualEnrichmentMetadata({
              description,
              metadata: result.metadata,
              model,
              node,
              now,
              promptVersion,
              traceId,
            }),
          };
        }),
      );
      const patches = [
        ...cacheHits,
        ...generated.filter((patch): patch is UpdateKnowledgeNodeMetadataPatch => Boolean(patch)),
      ];
      const enrichedNodes =
        patches.length === 0
          ? []
          : await nodes.updateMetadataMany({
              knowledgeSpaceId,
              patches,
            });

      const result: ContextualEnrichmentResult = {
        enrichedNodes: enrichedNodes.map(cloneKnowledgeNode),
        missingNodeIds,
      };

      return skippedNodes.length === 0
        ? result
        : {
            ...result,
            skippedNodes,
          };
    },
  };
}

function validateContextualEnrichmentInput({
  knowledgeSpaceId,
  maxBatchSize,
  nodeIds,
}: {
  readonly knowledgeSpaceId: string;
  readonly maxBatchSize: number;
  readonly nodeIds: readonly string[];
}) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Contextual enrichment knowledgeSpaceId is required");
  }

  if (nodeIds.length < 1) {
    throw new Error("Contextual enrichment nodeIds must contain at least 1 node id");
  }

  if (nodeIds.length > maxBatchSize) {
    throw new Error(`Contextual enrichment nodeIds exceeds maxBatchSize=${maxBatchSize}`);
  }

  for (const nodeId of nodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Contextual enrichment nodeIds must be non-empty strings");
    }
  }
}

function hasContextualDescription(node: KnowledgeNode): boolean {
  const description = node.metadata.contextualDescription;

  return typeof description === "string" && description.trim().length > 0;
}

function isBelowContextualQualityThreshold(
  metadata: Readonly<Record<string, unknown>> | undefined,
  minQualityScore: number | undefined,
): boolean {
  if (minQualityScore === undefined) {
    return false;
  }

  const qualityScore = metadata?.qualityScore;

  return (
    typeof qualityScore === "number" &&
    Number.isFinite(qualityScore) &&
    qualityScore < minQualityScore
  );
}

function contextualEnrichmentMetadata({
  cacheHit = false,
  description,
  metadata,
  model,
  node,
  now,
  promptVersion,
  traceId,
}: {
  readonly cacheHit?: boolean | undefined;
  readonly description: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly now: () => string;
  readonly promptVersion: string;
  readonly traceId?: string | undefined;
}): Record<string, unknown> {
  return {
    ...cloneJsonObject(node.metadata),
    contextualDescription: description,
    contextualEnrichment: {
      ...cloneJsonObject(metadata ?? {}),
      ...(cacheHit ? { cacheHit: true } : {}),
      enrichedAt: now(),
      model,
      promptVersion,
      ...(traceId ? { traceId } : {}),
    },
  };
}

function contextualEnrichmentCacheKey({
  model,
  node,
  promptVersion,
}: {
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly promptVersion: string;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        artifactHash: node.artifactHash,
        id: node.id,
        kind: node.kind,
        model,
        promptVersion,
        sourceLocation: node.sourceLocation,
        text: node.text,
      }),
    )
    .digest("hex");

  const namespace = knowledgeSpaceCacheNamespace({
    kind: "contextual-enrichment",
    knowledgeSpaceId: node.knowledgeSpaceId,
  });
  return `${namespace}version:v1:prompt:${cacheNamespaceSegment(
    promptVersion,
    "promptVersion",
  )}:model:${cacheNamespaceSegment(model, "model")}:${digest}`;
}

async function readContextualEnrichmentCache({
  cache,
  key,
}: {
  readonly cache: CacheAdapter;
  readonly key: string;
}): Promise<CachedContextualEnrichment | null> {
  const bytes = await cache.get(key);

  if (!bytes || bytes.byteLength > MAX_CONTEXTUAL_ENRICHMENT_CACHE_BYTES) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      readonly metadata?: unknown;
      readonly text?: unknown;
    };

    if (typeof payload.text !== "string" || !payload.text.trim()) {
      return null;
    }

    return {
      metadata: cloneJsonObject(isPlainObject(payload.metadata) ? payload.metadata : {}),
      text: payload.text.trim(),
    };
  } catch {
    return null;
  }
}

async function writeContextualEnrichmentCache({
  cache,
  key,
  metadata,
  text,
  ttlMs,
}: {
  readonly cache: CacheAdapter;
  readonly key: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly text: string;
  readonly ttlMs?: number | undefined;
}): Promise<void> {
  const value = new TextEncoder().encode(
    JSON.stringify({
      metadata: cloneJsonObject(metadata ?? {}),
      text,
    }),
  );

  if (value.byteLength <= MAX_CONTEXTUAL_ENRICHMENT_CACHE_BYTES) {
    await cache.set(key, value, ttlMs === undefined ? undefined : { ttlMs });
  }
}

function formatUsd(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(Number(value.toFixed(6)));
}

function contextualEnrichmentPrompt(node: KnowledgeNode): string {
  const sectionPath = node.sourceLocation.sectionPath.join(" > ") || "Unknown section";

  return [
    "Write a concise contextual description for this knowledge chunk.",
    `Kind: ${node.kind}`,
    `Section: ${sectionPath}`,
    `Text: ${node.text}`,
  ].join("\n");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
