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
import {
  type IndexProjectionRepository,
  cloneIndexProjection,
} from "./index-projection-repository";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { cloneKnowledgeNode } from "./knowledge-node-repository";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import { normalizeMixedLanguageFtsText } from "./retrieval-text-utils";

export interface BuildDenseVectorProjectionInput {
  /** Immutable profile captured by a compilation/profile-migration attempt. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly model: string;
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
  readonly model: string;
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
  readonly model: string;
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
  };
  readonly model: string;
}

export interface VisualEmbeddingProvider {
  embedAssets(input: EmbedVisualAssetsInput): Promise<EmbedVisualAssetsResult>;
}

export interface VisualEmbeddingImageInput extends VisualEmbeddingAssetInput {
  readonly body: Uint8Array;
  readonly contentType?: string | undefined;
  readonly objectKey: string;
}

export interface EmbedVisualImagesInput {
  readonly images: readonly VisualEmbeddingImageInput[];
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
  readonly provider: VisualEmbeddingProvider;
  readonly projections: IndexProjectionRepository;
}

export interface TextSurrogateVisualEmbeddingProviderOptions {
  readonly embeddings: EmbeddingProvider;
}

export interface ObjectStorageVisualEmbeddingProviderOptions {
  readonly maxAssetBytes?: number | undefined;
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
      model,
      nodes,
      embeddingProfile,
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
      const result = await provider.embed({
        inputType: "search_document",
        model: resolvedEmbedding?.model ?? model,
        ...(signal ? { signal } : {}),
        texts: parsedNodes.map((node) => node.text),
        ...(tenantId ? { tenantId } : {}),
      });
      signal?.throwIfAborted();

      if (result.dense.length !== parsedNodes.length) {
        throw new Error(
          `Embedding provider returned ${result.dense.length} vectors for ${parsedNodes.length} nodes`,
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

      const denseProjections = parsedNodes.map((node, index) => {
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
      return projections
        .createMany(denseProjections)
        .then((items) => items.map(cloneIndexProjection));
    },
  };
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
      const ftsProjections = parsedNodes.map((node) =>
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
            ftsText: normalizeMixedLanguageFtsText(node.text),
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
      );

      return projections
        .createMany(ftsProjections)
        .then((items) => items.map(cloneIndexProjection));
    },
  };
}

export function createVisualEmbeddingProjectionBuilder({
  generateId,
  maxBatchSize,
  projections,
  provider,
}: VisualEmbeddingProjectionBuilderOptions): VisualEmbeddingProjectionBuilder {
  return {
    build: async ({
      model,
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

      const result = await provider.embedAssets({
        assets: candidates.map((candidate) => candidate.asset),
        model,
        ...(signal ? { signal } : {}),
        ...(tenantId ? { tenantId } : {}),
      });
      signal?.throwIfAborted();

      // Partial-resilience mode: the provider embedded only a subset (some assets unreadable/
      // oversized) and reports which nodeIds got a vector, aligned with `dense`. Build a
      // nodeId -> vector map and create projections only for the embedded assets. Otherwise keep
      // the strict index-aligned contract.
      const vectorByNodeId = result.embeddedNodeIds
        ? new Map(result.embeddedNodeIds.map((nodeId, index) => [nodeId, result.dense[index]]))
        : undefined;

      if (!vectorByNodeId && result.dense.length !== candidates.length) {
        throw new Error(
          `Visual embedding provider returned ${result.dense.length} vectors for ${candidates.length} assets`,
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
        ? candidates.filter((candidate) => vectorByNodeId.has(candidate.asset.nodeId))
        : candidates;

      if (embeddableCandidates.length === 0) {
        return [];
      }

      const visualProjections = embeddableCandidates.map(({ asset, node }, index) => {
        const denseVector = vectorByNodeId ? vectorByNodeId.get(asset.nodeId) : result.dense[index];

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
      return projections
        .createMany(visualProjections)
        .then((items) => items.map(cloneIndexProjection));
    },
  };
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
  objectStorage,
  preferredVariant,
  provider,
}: ObjectStorageVisualEmbeddingProviderOptions): VisualEmbeddingProvider {
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) {
    throw new Error("Object-storage visual embedding maxAssetBytes must be at least 1");
  }

  return {
    embedAssets: async ({ assets, model, signal, tenantId }) => {
      // Skip individual unreadable / missing / oversized assets instead of failing the whole batch,
      // so one bad object does not cost a document all of its visual projections.
      const images: VisualEmbeddingImageInput[] = [];
      for (const asset of assets) {
        signal?.throwIfAborted();
        try {
          images.push(
            await readVisualEmbeddingImage({
              asset,
              maxAssetBytes,
              objectStorage,
              preferredVariant,
            }),
          );
        } catch {
          // intentionally skipped
        }
        signal?.throwIfAborted();
      }

      if (images.length === 0) {
        return {
          dense: [],
          embeddedNodeIds: [],
          metadata: {
            model,
            provider: provider.kind ? `${provider.kind}:image-bytes` : "image-bytes",
          },
          model,
        };
      }

      const result = await provider.embedImages({
        images,
        model,
        ...(signal ? { signal } : {}),
        ...(tenantId ? { tenantId } : {}),
      });
      signal?.throwIfAborted();

      return {
        dense: result.dense,
        embeddedNodeIds: images.map((image) => image.nodeId),
        metadata: {
          ...result.metadata,
          provider: provider.kind
            ? `${result.metadata.provider}:${provider.kind}:image-bytes`
            : `${result.metadata.provider}:image-bytes`,
        },
        model: result.model,
      };
    },
  };
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
}: {
  readonly asset: VisualEmbeddingAssetInput;
  readonly maxAssetBytes: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly preferredVariant: string | undefined;
}): Promise<VisualEmbeddingImageInput> {
  const selected = selectVisualEmbeddingAssetRef(asset.assetRef, preferredVariant);

  if (!selected.objectKey) {
    throw new Error("Visual embedding asset objectKey is required for image-byte embedding");
  }

  const body = await objectStorage.getObject(selected.objectKey);

  if (!body) {
    throw new Error("Visual embedding asset object was not found");
  }

  if (body.byteLength > maxAssetBytes) {
    throw new Error(`Visual embedding asset exceeds maxAssetBytes=${maxAssetBytes}`);
  }

  return {
    ...asset,
    body,
    ...(selected.contentType ? { contentType: selected.contentType } : {}),
    objectKey: selected.objectKey,
  };
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
