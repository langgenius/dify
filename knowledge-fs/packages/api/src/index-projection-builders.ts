import type {
  IndexProjection,
  KnowledgeNode,
  KnowledgeSpaceEmbeddingProfile,
  PlatformAdapter,
} from "@knowledge/core";
import {
  IndexProjectionSchema,
  KnowledgeNodeSchema,
  PublicationGenerationIdSchema,
} from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import { deterministicChildId } from "./api-shared-utils";
import { type DocumentModelBudget, estimateDocumentModelTokens } from "./document-model-budget";
import {
  type IndexProjectionRepository,
  cloneIndexProjection,
} from "./index-projection-repository";
import {
  type IngestionModelCallOperationalMetrics,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { cloneKnowledgeNode } from "./knowledge-node-repository";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import { normalizeMixedLanguageFtsText } from "./retrieval-text-utils";
import { TEXT_INDEXING_STRATEGY } from "./text-indexing-strategy";

export interface BuildDenseVectorProjectionInput {
  /** Immutable profile captured by a compilation/profile-migration attempt. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly model: string;
  readonly modelBudget?: DocumentModelBudget | undefined;
  readonly nodes: readonly KnowledgeNode[];
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly status?: ProjectionBuildStatus;
  readonly tenantId?: string;
}

export interface BuildFtsProjectionInput {
  readonly nodes: readonly KnowledgeNode[];
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly status?: ProjectionBuildStatus;
}

export interface BuildVisualEmbeddingProjectionInput {
  /** Immutable profile selected for this publication generation. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly model: string;
  readonly modelBudget?: DocumentModelBudget | undefined;
  readonly nodes: readonly KnowledgeNode[];
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly status?: ProjectionBuildStatus;
  readonly tenantId?: string;
}

export type ProjectionBuildStatus = Extract<IndexProjection["status"], "building" | "ready">;

export interface DenseVectorProjectionBuilder {
  build(input: BuildDenseVectorProjectionInput): Promise<IndexProjection[]>;
}

export interface FtsProjectionBuilder {
  build(input: BuildFtsProjectionInput): Promise<IndexProjection[]>;
}

export interface VisualEmbeddingProjectionBuilder {
  build(input: BuildVisualEmbeddingProjectionInput): Promise<IndexProjection[]>;
}

export interface VisualEmbeddingAssetInput {
  readonly assetRef: Readonly<Record<string, unknown>>;
  readonly documentAssetId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly modality: string;
  readonly nodeId: string;
  readonly sourceText: string;
}

export interface EmbedVisualAssetsInput {
  readonly assets: readonly VisualEmbeddingAssetInput[];
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly model: string;
  /** Called immediately before each physical provider request for admission and accounting. */
  readonly reserveProviderCall?: ((itemCount: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId?: string;
}

export interface EmbedVisualAssetsResult {
  readonly dense: readonly (readonly number[])[];
  /**
   * When present, the nodeIds (aligned with `dense`) that were actually embedded. Lets a provider
   * skip individual unreadable/oversized assets instead of failing the whole batch; the builder
   * then creates projections only for the embedded assets.
   */
  readonly embeddedNodeIds?: readonly string[] | undefined;
  readonly metadata: {
    readonly model: string;
    readonly provider: string;
    /** Physical provider requests issued for this logical embedding batch. */
    readonly providerCalls?: number | undefined;
    readonly usage?: { readonly totalTokens: number } | undefined;
  };
  readonly model: string;
}

export interface VisualEmbeddingProvider {
  /** The provider invokes reserveProviderCall once immediately before every physical request. */
  readonly providerCallAdmission?: "per-provider-call" | undefined;
  embedAssets(input: EmbedVisualAssetsInput): Promise<EmbedVisualAssetsResult>;
}

export interface VisualEmbeddingImageInput extends VisualEmbeddingAssetInput {
  readonly body: Uint8Array;
  readonly contentType?: string | undefined;
  readonly objectKey: string;
}

export interface EmbedVisualImagesInput {
  readonly images: readonly VisualEmbeddingImageInput[];
  /** Document ingestion is the backward-compatible default; query images use the query lane. */
  readonly inputType?: "document" | "query" | undefined;
  readonly model: string;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId?: string;
}

export interface ImageBytesVisualEmbeddingProvider {
  readonly kind?: string | undefined;
  embedImages(input: EmbedVisualImagesInput): Promise<EmbedVisualAssetsResult>;
}

export interface DenseVectorProjectionBuilderOptions {
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  readonly expectedDimension?: number | undefined;
  readonly generateId?: () => string;
  readonly maxBatchSize: number;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly projections: IndexProjectionRepository;
}

export interface FtsProjectionBuilderOptions {
  readonly generateId?: () => string;
  readonly maxBatchSize: number;
  readonly projections: IndexProjectionRepository;
}

export interface VisualEmbeddingProjectionBuilderOptions {
  readonly generateId?: () => string;
  readonly maxBatchSize: number;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly provider: VisualEmbeddingProvider;
  readonly projections: IndexProjectionRepository;
}

export interface TextSurrogateVisualEmbeddingProviderOptions {
  readonly embeddings: EmbeddingProvider;
}

export interface ObjectStorageVisualEmbeddingProviderOptions {
  readonly maxAssetBytes?: number | undefined;
  readonly maxBatchAssetCount?: number | undefined;
  readonly maxBatchBytes?: number | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly preferredVariant?: string | undefined;
  readonly provider: ImageBytesVisualEmbeddingProvider;
}

interface VisualEmbeddingAssetCandidate {
  readonly asset: VisualEmbeddingAssetInput;
  readonly node: KnowledgeNode;
}

export function createDenseVectorProjectionBuilder({
  embeddingResolver,
  embeddings,
  expectedDimension,
  generateId,
  maxBatchSize,
  metrics,
  projections,
}: DenseVectorProjectionBuilderOptions): DenseVectorProjectionBuilder {
  if (!embeddings && !embeddingResolver) {
    throw new Error("Dense vector projection builder requires embeddings or an embeddingResolver");
  }

  if (
    expectedDimension !== undefined &&
    (!Number.isInteger(expectedDimension) || expectedDimension < 1)
  ) {
    throw new Error("Dense vector projection expectedDimension must be a positive integer");
  }

  return {
    build: async ({
      embeddingProfile,
      model,
      modelBudget,
      nodes,
      projectionVersion,
      publicationGenerationId,
      signal,
      status,
      tenantId,
    }) => {
      signal?.throwIfAborted();
      validateDenseVectorProjectionBatch(nodes, maxBatchSize);
      const projectionStatus = normalizeProjectionBuildStatus(status);
      const generationId = normalizePublicationGenerationId(publicationGenerationId);

      if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
        throw new Error("Dense vector projection version must be a positive integer");
      }

      const parsedNodes = nodes.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      const knowledgeSpaceIds = new Set(parsedNodes.map((node) => node.knowledgeSpaceId));
      if (knowledgeSpaceIds.size !== 1) {
        throw new Error("Dense vector projection batch must belong to one knowledge space");
      }
      const knowledgeSpaceId = parsedNodes[0]?.knowledgeSpaceId;
      if (!knowledgeSpaceId) {
        throw new Error("Dense vector projection batch knowledgeSpaceId is required");
      }
      const resolvedEmbedding = embeddingResolver
        ? await embeddingResolver.resolve({
            ...(embeddingProfile ? { profile: embeddingProfile } : {}),
            knowledgeSpaceId,
            tenantId: requiredEmbeddingTenantId(tenantId),
          })
        : null;
      const provider = resolvedEmbedding?.providerInstance ?? embeddings;
      if (!provider) {
        throw new Error(
          `Embedding profile is not configured for knowledge space ${knowledgeSpaceId}`,
        );
      }
      if (
        resolvedEmbedding &&
        model !== resolvedEmbedding.vectorSpaceId &&
        model !== resolvedEmbedding.model
      ) {
        throw new Error(
          `Dense vector projection requested vector space ${model}; active vector space is ${resolvedEmbedding.vectorSpaceId}`,
        );
      }
      const getManyProjections = projections.getMany;
      const reusableByNodeId =
        generationId && resolvedEmbedding && !generateId && getManyProjections
          ? await loadReusableDenseProjections({
              generationId,
              getManyProjections,
              knowledgeSpaceId,
              nodes: parsedNodes,
              projectionStatus,
              projectionVersion,
              vectorSpaceId: resolvedEmbedding.vectorSpaceId,
            })
          : new Map<string, IndexProjection>();
      const nodesToEmbed = parsedNodes.filter((node) => !reusableByNodeId.has(node.id));
      const embeddingTexts = nodesToEmbed.map(textIndexContentForNode);
      if (nodesToEmbed.length === 0) {
        recordIngestionModelCallMetric(metrics, {
          cacheHits: parsedNodes.length,
          durationMs: 0,
          itemCount: parsedNodes.length,
          outcome: "succeeded",
          providerCalls: 0,
          retries: 0,
          stage: "text-embedding",
        });
        return parsedNodes.map((node) =>
          cloneIndexProjection(requiredProjection(reusableByNodeId, node.id)),
        );
      }
      modelBudget?.reserve({
        estimatedTokens: embeddingTexts.reduce(
          (total, text) => total + estimateDocumentModelTokens(text),
          0,
        ),
        itemCount: nodesToEmbed.length,
        stage: "text-embedding",
      });
      const embeddingStartedAt = Date.now();
      let result: Awaited<ReturnType<EmbeddingProvider["embed"]>>;
      try {
        result = await provider.embed({
          inputType: "search_document",
          model: resolvedEmbedding?.model ?? model,
          ...(signal ? { signal } : {}),
          texts: embeddingTexts,
          ...(tenantId ? { tenantId } : {}),
        });
      } catch (error) {
        recordIngestionModelCallMetric(metrics, {
          cacheHits: reusableByNodeId.size,
          durationMs: Math.max(0, Date.now() - embeddingStartedAt),
          itemCount: parsedNodes.length,
          outcome: "failed",
          providerCalls: 1,
          retries: 0,
          stage: "text-embedding",
        });
        throw error;
      }
      recordIngestionModelCallMetric(metrics, {
        cacheHits: reusableByNodeId.size,
        durationMs: Math.max(0, Date.now() - embeddingStartedAt),
        itemCount: parsedNodes.length,
        outcome: "succeeded",
        providerCalls: 1,
        retries: 0,
        stage: "text-embedding",
        ...(result.metadata.usage?.totalTokens === undefined
          ? {}
          : { totalTokens: result.metadata.usage.totalTokens }),
      });
      signal?.throwIfAborted();

      if (result.dense.length !== nodesToEmbed.length) {
        throw new Error(
          `Embedding provider returned ${result.dense.length} vectors for ${nodesToEmbed.length} nodes`,
        );
      }

      const responseDimension = validateProjectionVectors({
        ...(expectedDimension === undefined ? {} : { expectedDimension }),
        label: "Embedding provider",
        reportedDimension: result.metadata.dimension,
        vectors: result.dense,
      });
      if (resolvedEmbedding) {
        assertEmbeddingModelMatchesProfile({
          observedModel: result.model,
          profile: resolvedEmbedding,
        });
        assertObservedEmbeddingDimension({
          observedDimension: responseDimension,
          profile: resolvedEmbedding,
        });
        if (!embeddingProfile) {
          await embeddingResolver?.observeDimension?.({
            dimension: responseDimension,
            knowledgeSpaceId,
            revision: resolvedEmbedding.revision,
            tenantId: requiredEmbeddingTenantId(tenantId),
            vectorSpaceId: resolvedEmbedding.vectorSpaceId,
          });
        }
      }
      const vectorSpaceId = resolvedEmbedding?.vectorSpaceId ?? result.model;

      const denseProjections = nodesToEmbed.map((node, index) => {
        const denseVector = result.dense[index];

        if (!denseVector) {
          throw new Error("Embedding provider returned an invalid dense vector");
        }

        return IndexProjectionSchema.parse({
          id:
            generateId?.() ??
            deterministicChildId(
              node.id,
              generationScopedProjectionIdSeed(
                `projection:dense:${projectionVersion}:${vectorSpaceId}`,
                generationId,
              ),
            ),
          knowledgeSpaceId: node.knowledgeSpaceId,
          metadata: {
            artifactHash: node.artifactHash,
            denseVector: [...denseVector],
            dimension: responseDimension,
            documentAssetId: node.documentAssetId,
            embeddingProvider: result.metadata.provider,
            indexingStrategy: TEXT_INDEXING_STRATEGY,
            embeddingModel: result.model,
            ...(resolvedEmbedding
              ? {
                  embeddingProfile: {
                    pluginId: resolvedEmbedding.pluginId,
                    provider: resolvedEmbedding.provider,
                    revision: resolvedEmbedding.revision,
                  },
                }
              : {}),
            ...multimodalProjectionMetadata(node),
            modelVersion: result.model,
            parseArtifactId: node.parseArtifactId,
            vectorSpaceId,
          },
          model: vectorSpaceId,
          nodeId: node.id,
          projectionVersion,
          ...(generationId ? { publicationGenerationId: generationId } : {}),
          status: projectionStatus,
          type: "dense-vector",
        });
      });

      signal?.throwIfAborted();
      const created = await projections.createMany(denseProjections);
      const createdByNodeId = new Map(created.map((projection) => [projection.nodeId, projection]));
      return parsedNodes.map((node) =>
        cloneIndexProjection(
          reusableByNodeId.get(node.id) ?? requiredProjection(createdByNodeId, node.id),
        ),
      );
    },
  };
}

async function loadReusableDenseProjections({
  generationId,
  getManyProjections,
  knowledgeSpaceId,
  nodes,
  projectionStatus,
  projectionVersion,
  vectorSpaceId,
}: {
  readonly generationId: string;
  readonly getManyProjections: NonNullable<IndexProjectionRepository["getMany"]>;
  readonly knowledgeSpaceId: string;
  readonly nodes: readonly KnowledgeNode[];
  readonly projectionStatus: ProjectionBuildStatus;
  readonly projectionVersion: number;
  readonly vectorSpaceId: string;
}): Promise<Map<string, IndexProjection>> {
  const expectedIds = new Map(
    nodes.map((node) => [
      node.id,
      deterministicChildId(
        node.id,
        generationScopedProjectionIdSeed(
          `projection:dense:${projectionVersion}:${vectorSpaceId}`,
          generationId,
        ),
      ),
    ]),
  );
  const existing = await getManyProjections({
    ids: [...expectedIds.values()],
    knowledgeSpaceId,
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const reusable = new Map<string, IndexProjection>();

  for (const projection of existing) {
    const node = nodesById.get(projection.nodeId);
    if (
      !node ||
      projection.id !== expectedIds.get(node.id) ||
      projection.publicationGenerationId !== generationId ||
      projection.projectionVersion !== projectionVersion ||
      projection.model !== vectorSpaceId ||
      projection.status !== projectionStatus ||
      projection.type !== "dense-vector" ||
      projection.metadata.artifactHash !== node.artifactHash ||
      projection.metadata.documentAssetId !== node.documentAssetId ||
      projection.metadata.parseArtifactId !== node.parseArtifactId ||
      projection.metadata.indexingStrategy !== TEXT_INDEXING_STRATEGY
    ) {
      throw new Error(
        `Persisted generation-scoped dense projection id=${projection.id} cannot be reused`,
      );
    }
    reusable.set(node.id, projection);
  }

  return reusable;
}

function requiredProjection(
  projections: ReadonlyMap<string, IndexProjection>,
  nodeId: string,
): IndexProjection {
  const projection = projections.get(nodeId);
  if (!projection) {
    throw new Error(`Dense projection result is missing for nodeId=${nodeId}`);
  }
  return projection;
}

export function createFtsProjectionBuilder({
  generateId,
  maxBatchSize,
  projections,
}: FtsProjectionBuilderOptions): FtsProjectionBuilder {
  return {
    build: async ({ nodes, projectionVersion, publicationGenerationId, signal, status }) => {
      signal?.throwIfAborted();
      validateFtsProjectionBatch(nodes, maxBatchSize);
      const projectionStatus = normalizeProjectionBuildStatus(status);
      const generationId = normalizePublicationGenerationId(publicationGenerationId);

      if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
        throw new Error("FTS projection version must be a positive integer");
      }

      const parsedNodes = nodes.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      const ftsProjections = parsedNodes.flatMap((node) => {
        const sourceFtsText = normalizeMixedLanguageFtsText(node.text);
        if (!sourceFtsText) {
          return [];
        }
        const ftsText = normalizeMixedLanguageFtsText(textIndexContentForNode(node));

        return [
          IndexProjectionSchema.parse({
            id:
              generateId?.() ??
              deterministicChildId(
                node.id,
                generationScopedProjectionIdSeed(
                  `projection:fts:${projectionVersion}:database-fts@1`,
                  generationId,
                ),
              ),
            knowledgeSpaceId: node.knowledgeSpaceId,
            metadata: {
              artifactHash: node.artifactHash,
              documentAssetId: node.documentAssetId,
              ftsLanguageStrategy: "mixed-cjk-latin-v1",
              ftsText,
              indexingStrategy: TEXT_INDEXING_STRATEGY,
              ...multimodalProjectionMetadata(node),
              parseArtifactId: node.parseArtifactId,
              parser: "database-fts",
            },
            model: "database-fts@1",
            nodeId: node.id,
            projectionVersion,
            ...(generationId ? { publicationGenerationId: generationId } : {}),
            status: projectionStatus,
            type: "fts",
          }),
        ];
      });

      if (ftsProjections.length === 0) {
        return [];
      }

      const getManyProjections = projections.getMany;
      if (generationId && !generateId && getManyProjections) {
        const knowledgeSpaceId = ftsProjections[0]?.knowledgeSpaceId;
        if (!knowledgeSpaceId) {
          throw new Error("FTS projection batch knowledgeSpaceId is required");
        }
        const existing = await getManyProjections({
          ids: ftsProjections.map((projection) => projection.id),
          knowledgeSpaceId,
        });
        const incomingById = new Map(
          ftsProjections.map((projection) => [projection.id, projection]),
        );
        const reusableByNodeId = new Map<string, IndexProjection>();
        for (const projection of existing) {
          const incoming = incomingById.get(projection.id);
          if (
            !incoming ||
            projection.publicationGenerationId !== generationId ||
            projection.nodeId !== incoming.nodeId ||
            projection.projectionVersion !== projectionVersion ||
            projection.model !== "database-fts@1" ||
            projection.status !== projectionStatus ||
            projection.type !== "fts" ||
            projection.metadata.artifactHash !== incoming.metadata.artifactHash ||
            projection.metadata.documentAssetId !== incoming.metadata.documentAssetId ||
            projection.metadata.parseArtifactId !== incoming.metadata.parseArtifactId ||
            projection.metadata.indexingStrategy !== TEXT_INDEXING_STRATEGY ||
            projection.metadata.ftsText !== incoming.metadata.ftsText
          ) {
            throw new Error(
              `Persisted generation-scoped FTS projection id=${projection.id} cannot be reused`,
            );
          }
          reusableByNodeId.set(projection.nodeId, projection);
        }
        const missing = ftsProjections.filter(
          (projection) => !reusableByNodeId.has(projection.nodeId),
        );
        const created = missing.length > 0 ? await projections.createMany(missing) : [];
        const createdByNodeId = new Map(
          created.map((projection) => [projection.nodeId, projection]),
        );
        return ftsProjections.map((projection) =>
          cloneIndexProjection(
            reusableByNodeId.get(projection.nodeId) ??
              requiredProjection(createdByNodeId, projection.nodeId),
          ),
        );
      }

      return projections
        .createMany(ftsProjections)
        .then((items) => items.map(cloneIndexProjection));
    },
  };
}

/**
 * Add trusted semantic navigation context to search indexes without changing the cited source
 * text stored on the knowledge node. Table rows and list continuations commonly omit their parent
 * heading, so indexing only `node.text` makes them impossible to recall from a heading-led query.
 */
function textIndexContentForNode(node: KnowledgeNode): string {
  const sectionPath = node.sourceLocation.sectionPath
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" > ");
  const semanticChunking = isPlainObject(node.metadata.semanticChunking)
    ? node.metadata.semanticChunking
    : undefined;
  const section =
    semanticChunking && isPlainObject(semanticChunking.section)
      ? semanticChunking.section
      : undefined;
  const summary = section && typeof section.summary === "string" ? section.summary.trim() : "";

  return [sectionPath, summary, node.text.trim()].filter(Boolean).join("\n\n");
}

export function createVisualEmbeddingProjectionBuilder({
  generateId,
  maxBatchSize,
  metrics,
  projections,
  provider,
}: VisualEmbeddingProjectionBuilderOptions): VisualEmbeddingProjectionBuilder {
  return {
    build: async ({
      embeddingProfile,
      model,
      modelBudget,
      nodes,
      projectionVersion,
      publicationGenerationId,
      signal,
      status,
      tenantId,
    }) => {
      signal?.throwIfAborted();
      validateVisualEmbeddingProjectionBatch(nodes, maxBatchSize);
      const projectionStatus = normalizeProjectionBuildStatus(status);
      const generationId = normalizePublicationGenerationId(publicationGenerationId);

      if (!model.trim()) {
        throw new Error("Visual embedding projection model is required");
      }

      if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
        throw new Error("Visual embedding projection version must be a positive integer");
      }

      const parsedNodes = nodes.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      const candidates = parsedNodes
        .map(visualEmbeddingAssetCandidateFromNode)
        .filter((candidate) => candidate !== null);

      if (candidates.length === 0) {
        return [];
      }

      const reusableByNodeId =
        generationId && !generateId && projections.getManyByNodeIds
          ? await loadReusableVisualProjections({
              candidates,
              generationId,
              getManyByNodeIds: projections.getManyByNodeIds,
              knowledgeSpaceId: parsedNodes[0]?.knowledgeSpaceId ?? "",
              projectionStatus,
              projectionVersion,
            })
          : new Map<string, IndexProjection>();
      const candidatesToEmbed = candidates.filter(
        (candidate) => !reusableByNodeId.has(candidate.asset.nodeId),
      );
      if (candidatesToEmbed.length === 0) {
        recordIngestionModelCallMetric(metrics, {
          cacheHits: candidates.length,
          durationMs: 0,
          itemCount: candidates.length,
          outcome: "succeeded",
          providerCalls: 0,
          retries: 0,
          stage: "visual-embedding",
        });
        return candidates.map((candidate) =>
          cloneIndexProjection(requiredProjection(reusableByNodeId, candidate.asset.nodeId)),
        );
      }

      const providerOwnsCallAdmission = provider.providerCallAdmission === "per-provider-call";
      if (!providerOwnsCallAdmission) {
        modelBudget?.reserve({
          itemCount: candidatesToEmbed.length,
          stage: "visual-embedding",
        });
      }
      const embeddingStartedAt = Date.now();
      let attemptedProviderCalls = providerOwnsCallAdmission ? 0 : 1;
      const recordOutcome = (outcome: "failed" | "succeeded", totalTokens?: number): void => {
        recordIngestionModelCallMetric(metrics, {
          cacheHits: reusableByNodeId.size,
          durationMs: Math.max(0, Date.now() - embeddingStartedAt),
          itemCount: candidates.length,
          outcome,
          providerCalls: attemptedProviderCalls,
          retries: 0,
          stage: "visual-embedding",
          ...(totalTokens === undefined ? {} : { totalTokens }),
        });
      };
      let result: EmbedVisualAssetsResult;
      try {
        result = await provider.embedAssets({
          assets: candidatesToEmbed.map((candidate) => candidate.asset),
          ...(embeddingProfile ? { embeddingProfile } : {}),
          model,
          ...(providerOwnsCallAdmission
            ? {
                reserveProviderCall: (itemCount: number) => {
                  modelBudget?.reserve({ itemCount, stage: "visual-embedding" });
                  attemptedProviderCalls += 1;
                },
              }
            : {}),
          ...(signal ? { signal } : {}),
          ...(tenantId ? { tenantId } : {}),
        });
        if (providerOwnsCallAdmission && result.metadata.providerCalls !== attemptedProviderCalls) {
          throw new Error(
            `Visual embedding provider reported providerCalls=${String(result.metadata.providerCalls)} after admitting ${attemptedProviderCalls} calls`,
          );
        }
        if (
          !providerOwnsCallAdmission &&
          result.metadata.providerCalls !== undefined &&
          result.metadata.providerCalls !== 1
        ) {
          throw new Error(
            "Visual embedding provider without per-call admission must issue exactly one provider call",
          );
        }
      } catch (error) {
        recordOutcome("failed");
        throw error;
      }

      try {
        signal?.throwIfAborted();

        // Partial-resilience mode: the provider embedded only a subset (some assets unreadable/
        // oversized) and reports which nodeIds got a vector, aligned with `dense`. Build a
        // nodeId -> vector map and create projections only for the embedded assets. Otherwise keep
        // the strict index-aligned contract.
        const vectorByNodeId = result.embeddedNodeIds
          ? new Map(result.embeddedNodeIds.map((nodeId, index) => [nodeId, result.dense[index]]))
          : undefined;

        if (!vectorByNodeId && result.dense.length !== candidatesToEmbed.length) {
          throw new Error(
            `Visual embedding provider returned ${result.dense.length} vectors for ${candidatesToEmbed.length} assets`,
          );
        }

        if (result.embeddedNodeIds && result.embeddedNodeIds.length !== result.dense.length) {
          throw new Error(
            `Visual embedding provider returned ${result.dense.length} vectors for ${result.embeddedNodeIds.length} embedded node ids`,
          );
        }

        const responseDimension =
          result.dense.length > 0
            ? validateProjectionVectors({
                label: "Visual embedding provider",
                vectors: result.dense,
              })
            : undefined;

        const embeddableCandidates = vectorByNodeId
          ? candidatesToEmbed.filter((candidate) => vectorByNodeId.has(candidate.asset.nodeId))
          : candidatesToEmbed;

        if (embeddableCandidates.length === 0) {
          recordOutcome("succeeded", result.metadata.usage?.totalTokens);
          return [];
        }

        const visualProjections = embeddableCandidates.map(({ asset, node }, index) => {
          const denseVector = vectorByNodeId
            ? vectorByNodeId.get(asset.nodeId)
            : result.dense[index];

          if (!denseVector) {
            throw new Error("Visual embedding provider returned an invalid dense vector");
          }

          return IndexProjectionSchema.parse({
            id:
              generateId?.() ??
              deterministicChildId(
                node.id,
                generationScopedProjectionIdSeed(
                  `projection:visual:${projectionVersion}:${result.model}:${result.metadata.provider}`,
                  generationId,
                ),
              ),
            knowledgeSpaceId: node.knowledgeSpaceId,
            metadata: {
              artifactHash: node.artifactHash,
              denseVector: [...denseVector],
              dimension: responseDimension ?? denseVector.length,
              documentAssetId: asset.documentAssetId,
              embeddingProvider: result.metadata.provider,
              modelVersion: result.model,
              multimodal: {
                ...cloneJsonObject(asset.metadata),
                assetRef: cloneJsonObject(asset.assetRef),
                projectionRole: "visual-asset",
                // Image-byte embeddings live in a separate vector space (their own column + retrieval
                // leg); text-surrogate embeddings share the text embedding space, so they stay in the
                // text dense leg and must not be routed to visual_vector.
                vectorSpace: result.metadata.provider.includes(":image-bytes") ? "visual" : "text",
                visualEmbeddingStatus: "provided",
              },
              parseArtifactId: node.parseArtifactId,
            },
            model: result.model,
            nodeId: asset.nodeId,
            projectionVersion,
            ...(generationId ? { publicationGenerationId: generationId } : {}),
            status: projectionStatus,
            type: "dense-vector",
          });
        });

        signal?.throwIfAborted();
        const created = await projections.createMany(visualProjections);
        const createdByNodeId = new Map(
          created.map((projection) => [projection.nodeId, projection]),
        );
        const built = candidates.flatMap((candidate) => {
          const projection =
            reusableByNodeId.get(candidate.asset.nodeId) ??
            createdByNodeId.get(candidate.asset.nodeId);
          return projection ? [cloneIndexProjection(projection)] : [];
        });
        recordOutcome("succeeded", result.metadata.usage?.totalTokens);
        return built;
      } catch (error) {
        recordOutcome("failed");
        throw error;
      }
    },
  };
}

async function loadReusableVisualProjections({
  candidates,
  generationId,
  getManyByNodeIds,
  knowledgeSpaceId,
  projectionStatus,
  projectionVersion,
}: {
  readonly candidates: readonly VisualEmbeddingAssetCandidate[];
  readonly generationId: string;
  readonly getManyByNodeIds: NonNullable<IndexProjectionRepository["getManyByNodeIds"]>;
  readonly knowledgeSpaceId: string;
  readonly projectionStatus: ProjectionBuildStatus;
  readonly projectionVersion: number;
}): Promise<Map<string, IndexProjection>> {
  if (!knowledgeSpaceId) {
    throw new Error("Visual projection batch knowledgeSpaceId is required");
  }
  const candidateByNodeId = new Map(
    candidates.map((candidate) => [candidate.asset.nodeId, candidate]),
  );
  const existing = await getManyByNodeIds({
    knowledgeSpaceId,
    nodeIds: [...candidateByNodeId.keys()],
    projectionVersion,
    publicationGenerationId: generationId,
    type: "dense-vector",
  });
  const reusable = new Map<string, IndexProjection>();
  for (const projection of existing) {
    const multimodal = projection.metadata.multimodal;
    if (!isPlainObject(multimodal) || multimodal.projectionRole !== "visual-asset") continue;
    const candidate = candidateByNodeId.get(projection.nodeId);
    if (
      !candidate ||
      reusable.has(projection.nodeId) ||
      projection.publicationGenerationId !== generationId ||
      projection.projectionVersion !== projectionVersion ||
      projection.status !== projectionStatus ||
      projection.type !== "dense-vector" ||
      projection.metadata.artifactHash !== candidate.node.artifactHash ||
      projection.metadata.documentAssetId !== candidate.asset.documentAssetId ||
      projection.metadata.parseArtifactId !== candidate.node.parseArtifactId
    ) {
      throw new Error(
        `Persisted generation-scoped Visual projection id=${projection.id} cannot be reused`,
      );
    }
    reusable.set(projection.nodeId, projection);
  }
  return reusable;
}

export function createTextSurrogateVisualEmbeddingProvider({
  embeddings,
}: TextSurrogateVisualEmbeddingProviderOptions): VisualEmbeddingProvider {
  return {
    embedAssets: async ({ assets, model, signal, tenantId }) => {
      const result = await embeddings.embed({
        inputType: "search_document",
        model,
        ...(signal ? { signal } : {}),
        texts: assets.map(visualAssetTextSurrogate),
        ...(tenantId ? { tenantId } : {}),
      });

      return {
        dense: result.dense,
        metadata: {
          model: result.model,
          provider: `${result.metadata.provider}:text-surrogate`,
        },
        model: result.model,
      };
    },
  };
}

export function createObjectStorageVisualEmbeddingProvider({
  maxAssetBytes = 20 * 1024 * 1024,
  maxBatchAssetCount = 8,
  maxBatchBytes = 32 * 1024 * 1024,
  objectStorage,
  preferredVariant,
  provider,
}: ObjectStorageVisualEmbeddingProviderOptions): VisualEmbeddingProvider {
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) {
    throw new Error("Object-storage visual embedding maxAssetBytes must be at least 1");
  }
  if (!Number.isSafeInteger(maxBatchAssetCount) || maxBatchAssetCount < 1) {
    throw new Error("Object-storage visual embedding maxBatchAssetCount must be at least 1");
  }
  if (!Number.isSafeInteger(maxBatchBytes) || maxBatchBytes < 1) {
    throw new Error("Object-storage visual embedding maxBatchBytes must be at least 1");
  }
  if (maxBatchBytes < maxAssetBytes) {
    throw new Error(
      `Object-storage visual embedding maxBatchBytes must be at least maxAssetBytes=${maxAssetBytes}`,
    );
  }

  return {
    embedAssets: async ({ assets, model, reserveProviderCall, signal, tenantId }) => {
      // Skip individual unreadable / missing / oversized assets instead of failing the whole batch,
      // so one bad object does not cost a document all of its visual projections.
      let images: VisualEmbeddingImageInput[] = [];
      let imageBytes = 0;
      const dense: (readonly number[])[] = [];
      const embeddedNodeIds: string[] = [];
      let responseIdentity:
        | {
            readonly metadataModel: string;
            readonly model: string;
            readonly provider: string;
          }
        | undefined;
      let providerCalls = 0;
      let responseDimension: number | undefined;
      let totalTokens = 0;
      let usageComplete = true;

      const flush = async (): Promise<void> => {
        if (images.length === 0) return;
        signal?.throwIfAborted();
        reserveProviderCall?.(images.length);
        const requestImages = images;
        images = [];
        imageBytes = 0;
        const result = await provider.embedImages({
          images: requestImages,
          model,
          ...(signal ? { signal } : {}),
          ...(tenantId ? { tenantId } : {}),
        });
        signal?.throwIfAborted();
        if (result.metadata.providerCalls !== undefined && result.metadata.providerCalls !== 1) {
          throw new Error(
            "Visual embedding image provider must issue exactly one physical request per embedImages call",
          );
        }
        const ordered = orderedVisualEmbeddingBatch(result, requestImages);
        const batchDimension =
          ordered.dense.length > 0
            ? validateProjectionVectors({
                label: "Visual embedding image provider",
                vectors: ordered.dense,
              })
            : undefined;
        if (
          responseDimension !== undefined &&
          batchDimension !== undefined &&
          responseDimension !== batchDimension
        ) {
          throw new Error(
            `Visual embedding image provider returned dimension=${batchDimension}; expected dimension=${responseDimension} across batches`,
          );
        }
        responseDimension ??= batchDimension;
        assertConsistentVisualEmbeddingBatch(responseIdentity, result);
        responseIdentity ??= {
          metadataModel: result.metadata.model,
          model: result.model,
          provider: result.metadata.provider,
        };
        dense.push(...ordered.dense);
        embeddedNodeIds.push(...ordered.embeddedNodeIds);
        providerCalls += 1;
        if (result.metadata.usage?.totalTokens === undefined) {
          usageComplete = false;
        } else {
          totalTokens += result.metadata.usage.totalTokens;
        }
      };

      for (const asset of assets) {
        signal?.throwIfAborted();
        // We cannot know the next object's exact byte length without an extra HEAD request. Flush
        // whenever the remaining raw-byte budget cannot admit the configured per-asset maximum;
        // the following bounded GET therefore cannot create a currentBatchBytes + maxAssetBytes
        // resident spike above maxBatchBytes.
        if (
          images.length > 0 &&
          (images.length >= maxBatchAssetCount || maxBatchBytes - imageBytes < maxAssetBytes)
        ) {
          await flush();
        }
        let image: VisualEmbeddingImageInput;
        try {
          image = await readVisualEmbeddingImage({
            asset,
            maxAssetBytes,
            objectStorage,
            preferredVariant,
            signal,
          });
        } catch {
          // intentionally skipped
          signal?.throwIfAborted();
          continue;
        }
        signal?.throwIfAborted();
        images.push(image);
        imageBytes += image.body.byteLength;
        if (images.length >= maxBatchAssetCount || imageBytes >= maxBatchBytes) {
          await flush();
        }
      }
      await flush();

      if (!responseIdentity) {
        return {
          dense: [],
          embeddedNodeIds: [],
          metadata: {
            model,
            provider: provider.kind ? `${provider.kind}:image-bytes` : "image-bytes",
            providerCalls: 0,
          },
          model,
        };
      }

      return {
        dense,
        embeddedNodeIds,
        metadata: {
          model: responseIdentity.metadataModel,
          provider: provider.kind
            ? `${responseIdentity.provider}:${provider.kind}:image-bytes`
            : `${responseIdentity.provider}:image-bytes`,
          providerCalls,
          ...(usageComplete ? { usage: { totalTokens } } : {}),
        },
        model: responseIdentity.model,
      };
    },
    providerCallAdmission: "per-provider-call",
  };
}

function orderedVisualEmbeddingBatch(
  result: EmbedVisualAssetsResult,
  images: readonly VisualEmbeddingImageInput[],
): { readonly dense: readonly (readonly number[])[]; readonly embeddedNodeIds: readonly string[] } {
  if (!result.embeddedNodeIds) {
    if (result.dense.length !== images.length) {
      throw new Error(
        `Visual embedding image provider returned ${result.dense.length} vectors for ${images.length} images`,
      );
    }
    return {
      dense: result.dense,
      embeddedNodeIds: images.map((image) => image.nodeId),
    };
  }
  if (result.embeddedNodeIds.length !== result.dense.length) {
    throw new Error(
      `Visual embedding image provider returned ${result.dense.length} vectors for ${result.embeddedNodeIds.length} embedded node ids`,
    );
  }

  const inputNodeIds = new Set(images.map((image) => image.nodeId));
  const vectorByNodeId = new Map<string, readonly number[]>();
  for (const [index, nodeId] of result.embeddedNodeIds.entries()) {
    const vector = result.dense[index];
    if (!inputNodeIds.has(nodeId) || vectorByNodeId.has(nodeId) || !vector) {
      throw new Error("Visual embedding image provider returned an invalid embedded node id");
    }
    vectorByNodeId.set(nodeId, vector);
  }

  const orderedNodeIds = images
    .map((image) => image.nodeId)
    .filter((nodeId) => vectorByNodeId.has(nodeId));
  return {
    dense: orderedNodeIds.map((nodeId) => {
      const vector = vectorByNodeId.get(nodeId);
      if (!vector) {
        throw new Error("Visual embedding image provider returned an invalid dense vector");
      }
      return vector;
    }),
    embeddedNodeIds: orderedNodeIds,
  };
}

function assertConsistentVisualEmbeddingBatch(
  identity:
    | {
        readonly metadataModel: string;
        readonly model: string;
        readonly provider: string;
      }
    | undefined,
  result: EmbedVisualAssetsResult,
): void {
  if (
    identity &&
    (identity.metadataModel !== result.metadata.model ||
      identity.model !== result.model ||
      identity.provider !== result.metadata.provider)
  ) {
    throw new Error("Visual embedding image provider returned inconsistent batch identities");
  }
}

function visualAssetTextSurrogate(asset: VisualEmbeddingAssetInput): string {
  const caption = metadataString(asset.metadata, "caption");
  const ocrText = metadataString(asset.metadata, "ocrText");
  const title = metadataString(asset.metadata, "title");
  const text = [title, caption, ocrText, asset.sourceText].filter(Boolean).join("\n");

  return text.trim() || `${asset.modality} asset ${asset.nodeId}`;
}

async function readVisualEmbeddingImage({
  asset,
  maxAssetBytes,
  objectStorage,
  preferredVariant,
  signal,
}: {
  readonly asset: VisualEmbeddingAssetInput;
  readonly maxAssetBytes: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly preferredVariant: string | undefined;
  readonly signal: AbortSignal | undefined;
}): Promise<VisualEmbeddingImageInput> {
  const selected = selectVisualEmbeddingAssetRef(asset.assetRef, preferredVariant);

  if (!selected.objectKey) {
    throw new Error("Visual embedding asset objectKey is required for image-byte embedding");
  }

  // Consume the data plane directly with this provider's stricter per-image bound. In particular,
  // do not call getObject: remote adapters may buffer and concatenate up to their broader service
  // limit before this provider can inspect body.byteLength.
  const stream = await objectStorage.getObjectStream(selected.objectKey);

  if (!stream) {
    throw new Error("Visual embedding asset object was not found");
  }
  const body = await readBoundedVisualEmbeddingStream(stream, maxAssetBytes, signal);

  return {
    ...asset,
    body,
    ...(selected.contentType ? { contentType: selected.contentType } : {}),
    objectKey: selected.objectKey,
  };
}

async function readBoundedVisualEmbeddingStream(
  stream: ReadableStream<Uint8Array>,
  maxAssetBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let closed = false;
  let totalBytes = 0;
  const cancel = async (reason?: unknown): Promise<void> => {
    if (closed) return;
    closed = true;
    await reader.cancel(reason).catch(() => undefined);
  };
  const onAbort = () => {
    void cancel(signal?.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        closed = true;
        break;
      }
      // Detect maxAssetBytes + 1 without retaining the overflowing chunk. Only a body already
      // proven to fit is assembled below, so an oversized stream is never concatenated in memory.
      if (value.byteLength > maxAssetBytes - totalBytes) {
        await cancel(new Error(`Visual embedding asset exceeds maxAssetBytes=${maxAssetBytes}`));
        throw new Error(`Visual embedding asset exceeds maxAssetBytes=${maxAssetBytes}`);
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await cancel(signal?.aborted ? signal.reason : undefined);
    reader.releaseLock();
  }

  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0] as Uint8Array;

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function selectVisualEmbeddingAssetRef(
  assetRef: Readonly<Record<string, unknown>>,
  preferredVariant: string | undefined,
): { readonly contentType?: string; readonly objectKey?: string } {
  const variants = isPlainObject(assetRef.variants) ? assetRef.variants : undefined;
  const variant =
    preferredVariant && isPlainObject(variants?.[preferredVariant])
      ? variants[preferredVariant]
      : undefined;
  const candidate = variant ?? assetRef;
  const objectKey = metadataString(candidate, "objectKey");
  const contentType =
    metadataString(candidate, "contentType") ?? metadataString(assetRef, "contentType");

  return {
    ...(contentType ? { contentType } : {}),
    ...(objectKey ? { objectKey } : {}),
  };
}

function visualEmbeddingAssetCandidateFromNode(
  node: KnowledgeNode,
): VisualEmbeddingAssetCandidate | null {
  const textualMetadata = multimodalProjectionMetadata(node);
  const multimodal = isPlainObject(textualMetadata.multimodal)
    ? textualMetadata.multimodal
    : undefined;
  const assetRef = isPlainObject(multimodal?.assetRef)
    ? multimodal.assetRef
    : isPlainObject(node.metadata.assetRef)
      ? node.metadata.assetRef
      : undefined;
  const modality =
    metadataString(multimodal ?? {}, "modality") ?? multimodalProjectionModality(node);

  if (!assetRef || !modality) {
    return null;
  }

  return {
    asset: {
      assetRef: cloneJsonObject(assetRef),
      documentAssetId: node.documentAssetId,
      metadata: {
        ...(multimodal ? cloneJsonObject(multimodal) : {}),
        artifactHash: node.artifactHash,
        documentAssetId: node.documentAssetId,
        parseArtifactId: node.parseArtifactId,
        ...visualEmbeddingSourceMetadata(node.metadata),
      },
      modality,
      nodeId: node.id,
      sourceText: node.text,
    },
    node,
  };
}

function visualEmbeddingSourceMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of ["caption", "ocrText", "textAsHtml", "title"]) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      result[key] = value;
    }
  }

  if (isPlainObject(metadata.table)) {
    result.table = cloneJsonObject(metadata.table);
  }

  return result;
}

function validateDenseVectorProjectionBatch(nodes: readonly KnowledgeNode[], maxBatchSize: number) {
  if (nodes.length < 1) {
    throw new Error("Dense vector projection batch must contain at least 1 node");
  }

  if (nodes.length > maxBatchSize) {
    throw new Error(`Dense vector projection batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateProjectionVectors({
  expectedDimension,
  label,
  reportedDimension,
  vectors,
}: {
  readonly expectedDimension?: number | undefined;
  readonly label: string;
  readonly reportedDimension?: number | undefined;
  readonly vectors: readonly (readonly number[])[];
}): number {
  const dimension = vectors[0]?.length ?? 0;

  if (dimension < 1) {
    throw new Error(`${label} returned an invalid dense vector`);
  }

  if (expectedDimension !== undefined && dimension !== expectedDimension) {
    throw new Error(`${label} returned dimension=${dimension}; expected ${expectedDimension}`);
  }

  if (reportedDimension !== undefined && reportedDimension !== dimension) {
    throw new Error(
      `${label} reported dimension=${reportedDimension}; response vectors have dimension=${dimension}`,
    );
  }

  for (const [index, vector] of vectors.entries()) {
    if (vector.length !== dimension) {
      throw new Error(
        `${label} returned inconsistent dimension=${vector.length} at index ${index}; expected ${dimension}`,
      );
    }

    if (!vector.every((value) => Number.isFinite(value))) {
      throw new Error(`${label} returned a non-finite vector value at index ${index}`);
    }
  }

  return dimension;
}

function validateFtsProjectionBatch(nodes: readonly KnowledgeNode[], maxBatchSize: number) {
  if (nodes.length < 1) {
    throw new Error("FTS projection batch must contain at least 1 node");
  }

  if (nodes.length > maxBatchSize) {
    throw new Error(`FTS projection batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateVisualEmbeddingProjectionBatch(
  nodes: readonly KnowledgeNode[],
  maxBatchSize: number,
) {
  if (nodes.length < 1) {
    throw new Error("Visual embedding projection batch must contain at least 1 node");
  }

  if (nodes.length > maxBatchSize) {
    throw new Error(`Visual embedding projection batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

export function normalizeProjectionBuildStatus(
  status: ProjectionBuildStatus | undefined,
): ProjectionBuildStatus {
  if (status === undefined) {
    return "ready";
  }

  if (status !== "building" && status !== "ready") {
    throw new Error("Index projection build status must be building or ready");
  }

  return status;
}

function normalizePublicationGenerationId(
  publicationGenerationId: string | undefined,
): string | undefined {
  return publicationGenerationId === undefined
    ? undefined
    : PublicationGenerationIdSchema.parse(publicationGenerationId);
}

function generationScopedProjectionIdSeed(
  legacySeed: string,
  publicationGenerationId: string | undefined,
): string {
  return publicationGenerationId === undefined
    ? legacySeed
    : `${legacySeed}:publication-generation:${publicationGenerationId}`;
}

function multimodalProjectionMetadata(node: KnowledgeNode): Record<string, unknown> {
  const modality = multimodalProjectionModality(node);

  if (
    !modality &&
    !isPlainObject(node.metadata.assetRef) &&
    !isPlainObject(node.metadata.boundingBox)
  ) {
    return {};
  }

  const parseElementId =
    metadataString(node.metadata, "parseElementId") ??
    firstMetadataString(node.metadata, "elementIds");

  return {
    multimodal: {
      ...(isPlainObject(node.metadata.assetRef)
        ? { assetRef: cloneJsonObject(node.metadata.assetRef) }
        : {}),
      ...(isPlainObject(node.metadata.boundingBox)
        ? { boundingBox: cloneJsonObject(node.metadata.boundingBox) }
        : {}),
      ...(parseElementId ? { parseElementId } : {}),
      ...(node.sourceLocation.pageNumber ? { pageNumber: node.sourceLocation.pageNumber } : {}),
      projectionRole: "textual-surrogate",
      ...(modality ? { modality } : {}),
      sectionPath: [...node.sourceLocation.sectionPath],
      visualEmbeddingStatus: "missing",
    },
  };
}

function multimodalProjectionModality(node: KnowledgeNode): string | undefined {
  if (node.kind === "image" || node.kind === "table") {
    return node.kind;
  }

  const elementTypes = metadataStringArray(node.metadata, "elementTypes");

  if (elementTypes.includes("image")) {
    return "image";
  }

  if (elementTypes.includes("table")) {
    return "table";
  }

  if (elementTypes.includes("code")) {
    return "code";
  }

  if (elementTypes.includes("page-break")) {
    return "page";
  }

  return undefined;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstMetadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.find((item) => typeof item === "string" && item.trim())
    : undefined;
}

function metadataStringArray(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requiredEmbeddingTenantId(tenantId: string | undefined): string {
  const normalized = tenantId?.trim();

  if (!normalized) {
    throw new Error(
      "Dense vector projection tenantId is required when embeddingResolver is configured",
    );
  }

  return normalized;
}
