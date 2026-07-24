import type { ChunkConfig, ComputeRuntime } from "@knowledge/compute";
import {
  type IndexProjection,
  type KnowledgeNode,
  type KnowledgeSpaceEmbeddingProfile,
  type ParseArtifact,
  ParseArtifactSchema,
  PublicationGenerationIdSchema,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import {
  type DenseVectorProjectionBuilder,
  type FtsProjectionBuilder,
  type ProjectionBuildStatus,
  type VisualEmbeddingProjectionBuilder,
  normalizeProjectionBuildStatus,
} from "./index-projection-builders";
import type { IndexProjectionRepository } from "./index-projection-repository";
import { isPlainObject } from "./json-utils";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";
import { type ParseArtifactRepository, cloneParseArtifact } from "./parse-artifact-repository";

export interface IncrementalReindexInput {
  readonly chunkConfig?: ChunkConfig | undefined;
  /** Zero-based chunk ordinals excluded by an immutable document chunk-state candidate. */
  readonly excludedNodeOrdinals?: readonly number[] | undefined;
  readonly denseModel?: string | undefined;
  /** Immutable profile captured before the reindex started. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly knowledgeSpaceId: string;
  /** Optional normalized BCP-47 document language persisted into every generated node. */
  readonly language?: string | undefined;
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope?: readonly string[] | undefined;
  readonly projectionStatus?: ProjectionBuildStatus | undefined;
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId?: string | undefined;
  readonly visualModel?: string | undefined;
}

export type IncrementalReindexResult =
  | {
      readonly artifact: ParseArtifact;
      readonly nodesCreated: 0;
      readonly projectionsCreated: 0;
      readonly reason: "artifact-hash-unchanged";
      readonly status: "skipped";
    }
  | {
      readonly artifact: ParseArtifact;
      readonly nodeIds?: readonly string[] | undefined;
      readonly nodesCreated: number;
      readonly projectionIds?: readonly string[] | undefined;
      readonly projectionsCreated: number;
      readonly status: "rebuilt";
    };

export interface UpdateIncrementalReindexProjectionStatusInput {
  readonly knowledgeSpaceId: string;
  readonly projectionIds: readonly string[];
}

export interface IncrementalReindexer {
  canonicalizeArtifact?(artifact: ParseArtifact): Promise<ParseArtifact>;
  failProjections?(input: UpdateIncrementalReindexProjectionStatusInput): Promise<number>;
  publishProjections?(input: UpdateIncrementalReindexProjectionStatusInput): Promise<number>;
  reindex(input: IncrementalReindexInput): Promise<IncrementalReindexResult>;
}

export interface IncrementalReindexerOptions {
  readonly artifacts: ParseArtifactRepository;
  readonly compute: ComputeRuntime;
  readonly denseBuilder?: DenseVectorProjectionBuilder | undefined;
  readonly ftsBuilder?: FtsProjectionBuilder | undefined;
  readonly maxNodes: number;
  readonly maxProjectionBatchSize?: number | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
  readonly projections?: IndexProjectionRepository | undefined;
  readonly visualBuilder?: VisualEmbeddingProjectionBuilder | undefined;
}

export function createIncrementalReindexer({
  artifacts,
  compute,
  denseBuilder,
  ftsBuilder,
  maxNodes,
  maxProjectionBatchSize,
  nodes,
  operationLeases,
  projections,
  visualBuilder,
}: IncrementalReindexerOptions): IncrementalReindexer {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Incremental reindexer maxNodes must be at least 1");
  }

  const projectionBatchSize = maxProjectionBatchSize ?? maxNodes;

  if (!Number.isInteger(projectionBatchSize) || projectionBatchSize < 1) {
    throw new Error("Incremental reindexer maxProjectionBatchSize must be at least 1");
  }

  const canUpdateProjectionStatuses = projections?.updateStatusByIds !== undefined;

  const updateProjectionStatus = async ({
    fromStatus,
    input,
    status,
  }: {
    readonly fromStatus: "building" | "ready";
    readonly input: UpdateIncrementalReindexProjectionStatusInput;
    readonly status: "failed" | "ready";
  }): Promise<number> => {
    if (!projections?.updateStatusByIds) {
      return 0;
    }

    let updated = 0;

    for (const projectionIds of chunkStrings(input.projectionIds, projectionBatchSize)) {
      updated += await projections.updateStatusByIds({
        fromStatus,
        knowledgeSpaceId: input.knowledgeSpaceId,
        projectionIds,
        status,
      });
    }

    return updated;
  };

  return {
    canonicalizeArtifact: async (artifact: ParseArtifact) =>
      cloneParseArtifact(
        await artifacts.create(cloneParseArtifact(ParseArtifactSchema.parse(artifact))),
      ),
    ...(canUpdateProjectionStatuses
      ? {
          failProjections: async (input: UpdateIncrementalReindexProjectionStatusInput) => {
            const building = await updateProjectionStatus({
              fromStatus: "building",
              input,
              status: "failed",
            });
            const ready = await updateProjectionStatus({
              fromStatus: "ready",
              input,
              status: "failed",
            });

            return building + ready;
          },
          publishProjections: (input: UpdateIncrementalReindexProjectionStatusInput) =>
            updateProjectionStatus({ fromStatus: "building", input, status: "ready" }),
        }
      : {}),
    reindex: async (input) => {
      validateIncrementalReindexInput(input, { denseBuilder, visualBuilder });
      const parseArtifact = cloneParseArtifact(ParseArtifactSchema.parse(input.parseArtifact));
      const publicationGenerationId =
        input.publicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(input.publicationGenerationId);
      const reindex = async (): Promise<IncrementalReindexResult> => {
        input.signal?.throwIfAborted();
        const storedArtifact = await artifacts.create(parseArtifact);
        input.signal?.throwIfAborted();
        const excludedNodeOrdinals = new Set(input.excludedNodeOrdinals ?? []);
        const chunkedNodes = compute
          .chunkParseArtifact({
            ...(input.chunkConfig ? { config: input.chunkConfig } : {}),
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: storedArtifact,
            ...(input.permissionScope ? { permissionScope: [...input.permissionScope] } : {}),
          })
          .filter((_, ordinal) => !excludedNodeOrdinals.has(ordinal))
          .map((node) =>
            cloneKnowledgeNode(
              publicationGenerationId
                ? {
                    ...node,
                    id: deterministicChildId(publicationGenerationId, `knowledge-node:${node.id}`),
                    ...(input.language
                      ? { metadata: { ...node.metadata, language: input.language } }
                      : {}),
                    publicationGenerationId,
                  }
                : input.language
                  ? { ...node, metadata: { ...node.metadata, language: input.language } }
                  : node,
            ),
          );

        if (chunkedNodes.length > maxNodes) {
          throw new Error(`Incremental reindexer node count exceeds maxNodes=${maxNodes}`);
        }

        const storedNodes =
          chunkedNodes.length > 0
            ? await nodes.upsertMany(chunkedNodes.map(cloneKnowledgeNode))
            : [];
        input.signal?.throwIfAborted();
        const projectionIds: string[] = [];
        const observedVectorSpaces = new Map<
          string,
          { readonly dimension: number; readonly model: string }
        >();
        const requestedProjectionStatus = input.projectionStatus ?? "building";
        const buildProjectionStatus = canUpdateProjectionStatuses
          ? "building"
          : requestedProjectionStatus;

        try {
          if (storedNodes.length > 0 && ftsBuilder) {
            for (const nodeBatch of chunkNodes(storedNodes, projectionBatchSize)) {
              input.signal?.throwIfAborted();
              const built = await ftsBuilder.build({
                nodes: nodeBatch,
                projectionVersion: input.projectionVersion,
                ...(publicationGenerationId ? { publicationGenerationId } : {}),
                ...(input.signal ? { signal: input.signal } : {}),
                status: buildProjectionStatus,
              });
              projectionIds.push(...built.map((projection) => projection.id));
            }
          }

          if (storedNodes.length > 0 && denseBuilder && input.denseModel) {
            for (const nodeBatch of chunkNodes(storedNodes, projectionBatchSize)) {
              input.signal?.throwIfAborted();
              const built = await denseBuilder.build({
                ...(input.embeddingProfile ? { embeddingProfile: input.embeddingProfile } : {}),
                model: input.denseModel,
                nodes: nodeBatch,
                projectionVersion: input.projectionVersion,
                ...(publicationGenerationId ? { publicationGenerationId } : {}),
                ...(input.signal ? { signal: input.signal } : {}),
                status: buildProjectionStatus,
                ...(input.tenantId ? { tenantId: input.tenantId } : {}),
              });
              projectionIds.push(...built.map((projection) => projection.id));
              validateReindexProjectionDimensions(built, observedVectorSpaces);
            }
          }

          if (storedNodes.length > 0 && visualBuilder && input.visualModel) {
            for (const nodeBatch of chunkNodes(storedNodes, projectionBatchSize)) {
              input.signal?.throwIfAborted();
              const built = await visualBuilder.build({
                model: input.visualModel,
                nodes: nodeBatch,
                projectionVersion: input.projectionVersion,
                ...(publicationGenerationId ? { publicationGenerationId } : {}),
                ...(input.signal ? { signal: input.signal } : {}),
                status: buildProjectionStatus,
                ...(input.tenantId ? { tenantId: input.tenantId } : {}),
              });
              projectionIds.push(...built.map((projection) => projection.id));
              validateReindexProjectionDimensions(built, observedVectorSpaces);
            }
          }

          if (requestedProjectionStatus === "ready" && buildProjectionStatus === "building") {
            await updateProjectionStatus({
              fromStatus: "building",
              input: { knowledgeSpaceId: input.knowledgeSpaceId, projectionIds },
              status: "ready",
            });
          }
        } catch (error) {
          await updateProjectionStatus({
            fromStatus: "building",
            input: { knowledgeSpaceId: input.knowledgeSpaceId, projectionIds },
            status: "failed",
          }).catch(() => undefined);
          throw error;
        }

        return {
          artifact: cloneParseArtifact(storedArtifact),
          nodeIds: storedNodes.map((node) => node.id),
          nodesCreated: storedNodes.length,
          projectionIds: [...projectionIds],
          projectionsCreated: projectionIds.length,
          status: "rebuilt",
        };
      };

      return operationLeases && input.tenantId
        ? operationLeases.withLease(
            {
              knowledgeSpaceId: input.knowledgeSpaceId,
              leaseType: "reindex",
              metadata: { documentAssetId: parseArtifact.documentAssetId },
              targetId: parseArtifact.id,
              targetType: "parse-artifact",
              targetVersion: input.projectionVersion,
              tenantId: input.tenantId,
              virtualPath: `/knowledge/artifacts/${parseArtifact.id}`,
            },
            reindex,
          )
        : reindex();
    },
  };
}

function chunkNodes(nodes: readonly KnowledgeNode[], size: number) {
  const chunks: KnowledgeNode[][] = [];

  for (let start = 0; start < nodes.length; start += size) {
    chunks.push(nodes.slice(start, start + size));
  }

  return chunks;
}

function chunkStrings(values: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];

  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }

  return chunks;
}

function validateReindexProjectionDimensions(
  projections: readonly IndexProjection[],
  observedVectorSpaces: Map<string, { readonly dimension: number; readonly model: string }>,
): void {
  for (const projection of projections) {
    if (projection.type !== "dense-vector") {
      continue;
    }

    const dimension = projection.metadata.dimension;

    // Custom builders created by integrators may predate dimension metadata. The production
    // builders always persist it, while repository/query validation still protects legacy rows.
    if (dimension === undefined) {
      continue;
    }

    if (!Number.isSafeInteger(dimension) || (dimension as number) < 1) {
      throw new Error(`Incremental reindexer received invalid projection dimension=${dimension}`);
    }

    const multimodal = isPlainObject(projection.metadata.multimodal)
      ? projection.metadata.multimodal
      : undefined;
    const vectorSpace = multimodal?.vectorSpace === "visual" ? "visual" : "text";
    const observed = observedVectorSpaces.get(vectorSpace);
    const current = { dimension: dimension as number, model: projection.model ?? "" };

    if (
      observed &&
      (observed.dimension !== current.dimension || observed.model !== current.model)
    ) {
      throw new Error(
        `Incremental reindexer received inconsistent ${vectorSpace} embedding space: ` +
          `${current.model}/${current.dimension}; expected ${observed.model}/${observed.dimension}`,
      );
    }

    observedVectorSpaces.set(vectorSpace, current);
  }
}

function validateIncrementalReindexInput(
  input: IncrementalReindexInput,
  {
    denseBuilder,
    visualBuilder,
  }: Pick<IncrementalReindexerOptions, "denseBuilder" | "visualBuilder">,
): void {
  if (!input.knowledgeSpaceId.trim()) {
    throw new Error("Incremental reindexer knowledgeSpaceId is required");
  }

  if (!Number.isInteger(input.projectionVersion) || input.projectionVersion < 1) {
    throw new Error("Incremental reindexer projectionVersion must be a positive integer");
  }

  if (input.projectionStatus !== undefined) {
    normalizeProjectionBuildStatus(input.projectionStatus);
  }

  if (input.publicationGenerationId !== undefined) {
    PublicationGenerationIdSchema.parse(input.publicationGenerationId);
  }

  if (denseBuilder && !input.denseModel?.trim()) {
    throw new Error("Incremental reindexer denseModel is required when denseBuilder is configured");
  }

  if (visualBuilder && !input.visualModel?.trim()) {
    throw new Error(
      "Incremental reindexer visualModel is required when visualBuilder is configured",
    );
  }
}
