import { createHash } from "node:crypto";

import type { ChunkConfig, ComputeRuntime } from "@knowledge/compute";
import {
  type IndexProjection,
  type KnowledgeNode,
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  type ParseArtifact,
  ParseArtifactSchema,
  PublicationGenerationIdSchema,
  stableJson,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import type { DocumentModelBudget } from "./document-model-budget";
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
import {
  type KnowledgeNodeGenerationCompletionReceipt,
  type KnowledgeNodeGenerationReceipt,
  type KnowledgeNodeGenerationUnitRangeReceipt,
  type KnowledgeNodeGenerationWindowReceipt,
  type KnowledgeNodeRepository,
  type KnowledgeNodeSemanticGenerationConfig,
  cloneKnowledgeNode,
} from "./knowledge-node-repository";
import {
  type SemanticChunker,
  assertValidLlmSemanticGenerationReplay,
  assertValidLlmSemanticWindowManifestReplay,
  preflightLlmSemanticWindows,
} from "./llm-semantic-chunker";
import {
  type MaterializeParseArtifactResult,
  type ParseArtifactLookupInput,
  type ParseArtifactRepository,
  cloneParseArtifact,
} from "./parse-artifact-repository";
import {
  MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES,
  llmSemanticCompletionFingerprint,
  maximumKnowledgeNodeGenerationReceiptSerializedBytes,
} from "./semantic-generation-receipt";

export interface IncrementalReindexInput {
  readonly chunkConfig?: ChunkConfig | undefined;
  /** Zero-based chunk ordinals excluded by an immutable document chunk-state candidate. */
  readonly excludedNodeOrdinals?: readonly number[] | undefined;
  readonly denseModel?: string | undefined;
  /** Immutable profile captured before the reindex started. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  /** Whether Graph facts from this semantic generation will be materialized by the caller. */
  readonly enableGraph?: boolean | undefined;
  /** Whether PageIndex paths and summaries will be materialized by the caller. */
  readonly enablePageIndex?: boolean | undefined;
  readonly knowledgeSpaceId: string;
  /** Optional normalized BCP-47 document language persisted into every generated node. */
  readonly language?: string | undefined;
  readonly modelBudget?: DocumentModelBudget | undefined;
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope?: readonly string[] | undefined;
  readonly projectionStatus?: ProjectionBuildStatus | undefined;
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  /** Removes failed projections from an unpublished generation before rebuilding a retry. */
  readonly resetFailedProjections?: boolean | undefined;
  /** Clone already-published chunks from this generation when only projections are migrating. */
  readonly reuseNodeGenerationId?: string | undefined;
  /** Immutable per-space reasoning profile captured by the durable compilation attempt. */
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  /** Explicit FTS-only build for a published retrieval profile with no active embedding profile. */
  readonly skipDense?: true | undefined;
  /** Preserve existing visual projections instead of rebuilding them in a text-only migration. */
  readonly skipVisual?: true | undefined;
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
      /** Ephemeral semantic-node projection used to build the published outline and PageIndex. */
      readonly outlineArtifact?: ParseArtifact | undefined;
      readonly projectionIds?: readonly string[] | undefined;
      readonly projectionsCreated: number;
      readonly status: "rebuilt";
    };

export interface UpdateIncrementalReindexProjectionStatusInput {
  readonly knowledgeSpaceId: string;
  readonly projectionIds: readonly string[];
}

export interface IncrementalReindexer {
  canonicalizeArtifact?(artifact: ParseArtifact): Promise<MaterializeParseArtifactResult>;
  failProjections?(input: UpdateIncrementalReindexProjectionStatusInput): Promise<number>;
  getCanonicalArtifact?(input: ParseArtifactLookupInput): Promise<ParseArtifact | null>;
  publishProjections?(input: UpdateIncrementalReindexProjectionStatusInput): Promise<number>;
  reindex(input: IncrementalReindexInput): Promise<IncrementalReindexResult>;
}

export interface IncrementalReindexerOptions {
  readonly artifacts: ParseArtifactRepository;
  readonly compute: ComputeRuntime;
  readonly denseBuilder?: DenseVectorProjectionBuilder | undefined;
  readonly ftsBuilder?: FtsProjectionBuilder | undefined;
  readonly maxNodes: number;
  /** Repository-safe page size used when replaying immutable generation nodes. */
  readonly maxNodeReplayPageSize?: number | undefined;
  readonly maxProjectionBatchSize?: number | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
  readonly projections?: IndexProjectionRepository | undefined;
  readonly semanticChunker?: SemanticChunker | undefined;
  readonly visualBuilder?: VisualEmbeddingProjectionBuilder | undefined;
}

export function createIncrementalReindexer({
  artifacts,
  compute,
  denseBuilder,
  ftsBuilder,
  maxNodes,
  maxNodeReplayPageSize,
  maxProjectionBatchSize,
  nodes,
  operationLeases,
  projections,
  semanticChunker,
  visualBuilder,
}: IncrementalReindexerOptions): IncrementalReindexer {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Incremental reindexer maxNodes must be at least 1");
  }

  const projectionBatchSize = maxProjectionBatchSize ?? maxNodes;
  const nodeReplayPageSize = maxNodeReplayPageSize ?? Math.min(maxNodes, 100);

  if (!Number.isInteger(projectionBatchSize) || projectionBatchSize < 1) {
    throw new Error("Incremental reindexer maxProjectionBatchSize must be at least 1");
  }

  if (!Number.isInteger(nodeReplayPageSize) || nodeReplayPageSize < 1) {
    throw new Error("Incremental reindexer maxNodeReplayPageSize must be at least 1");
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
    canonicalizeArtifact: async (artifact: ParseArtifact) => {
      const materialized = await artifacts.materialize(
        cloneParseArtifact(ParseArtifactSchema.parse(artifact)),
      );
      return { ...materialized, artifact: cloneParseArtifact(materialized.artifact) };
    },
    getCanonicalArtifact: async (input: ParseArtifactLookupInput) => {
      const persisted = await artifacts.getByDocumentVersion(input);

      if (!persisted) return null;
      const materialized = await artifacts.materialize(cloneParseArtifact(persisted));
      return cloneParseArtifact(materialized.artifact);
    },
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
      validateIncrementalReindexInput(input, {
        nodes,
        semanticChunker,
        visualBuilder,
      });
      const parseArtifact = cloneParseArtifact(ParseArtifactSchema.parse(input.parseArtifact));
      const publicationGenerationId =
        input.publicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(input.publicationGenerationId);
      if (input.resetFailedProjections && !publicationGenerationId) {
        throw new Error(
          "Incremental reindexer can reset failed projections only for a publication generation",
        );
      }
      if (input.resetFailedProjections && !projections) {
        throw new Error(
          "Incremental reindexer requires a projection repository to reset failed projections",
        );
      }
      const retrievalProfile = input.retrievalProfile
        ? KnowledgeSpaceRetrievalProfileSchema.parse(input.retrievalProfile)
        : undefined;
      const reindex = async (): Promise<IncrementalReindexResult> => {
        input.signal?.throwIfAborted();
        const storedArtifact = await artifacts.create(parseArtifact);
        input.signal?.throwIfAborted();
        const excludedNodeOrdinals = new Set(input.excludedNodeOrdinals ?? []);
        const semanticReceiptRequest =
          publicationGenerationId && semanticChunker && retrievalProfile
            ? semanticGenerationReceiptRequest({
                chunkConfig: input.chunkConfig,
                excludedNodeOrdinals,
                knowledgeSpaceId: input.knowledgeSpaceId,
                language: input.language,
                maxNodes,
                modelSelection: retrievalProfile.reasoningModel,
                parseArtifact: storedArtifact,
                permissionScope: input.permissionScope ?? [],
                publicationGenerationId,
                semanticChunker,
              })
            : undefined;
        const generationReceipt = semanticReceiptRequest
          ? await nodes.getGenerationReceipt?.({
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifactId: storedArtifact.id,
              publicationGenerationId: semanticReceiptRequest.publicationGenerationId,
            })
          : null;
        // Durable candidate retries must not call a non-deterministic semantic model again after
        // generation-scoped nodes have been persisted. Those rows are immutable and already carry
        // the exact chunk boundaries and joint extraction response used by the candidate.
        const replayedNodes = publicationGenerationId
          ? await listGenerationArtifactNodes({
              knowledgeSpaceId: input.knowledgeSpaceId,
              maxNodes,
              pageSize: nodeReplayPageSize,
              nodes,
              parseArtifactId: storedArtifact.id,
              publicationGenerationId,
            })
          : [];
        const sourceGenerationNodes = input.reuseNodeGenerationId
          ? await listGenerationArtifactNodes({
              knowledgeSpaceId: input.knowledgeSpaceId,
              maxNodes,
              pageSize: nodeReplayPageSize,
              nodes,
              parseArtifactId: storedArtifact.id,
              publicationGenerationId: input.reuseNodeGenerationId,
            })
          : [];
        if (generationReceipt && semanticReceiptRequest) {
          assertSemanticGenerationReceiptReplay({
            expected: semanticReceiptRequest,
            nodes: replayedNodes,
            parseArtifact: storedArtifact,
            receipt: generationReceipt,
          });
        }
        if (input.reuseNodeGenerationId && sourceGenerationNodes.length === 0) {
          throw new Error(
            "Incremental reindexer could not load source generation nodes for projection-only migration",
          );
        }
        const reusedSourceNodes =
          publicationGenerationId && sourceGenerationNodes.length > 0
            ? sourceGenerationNodes.map((node) =>
                cloneKnowledgeNode({
                  ...node,
                  id: deterministicChildId(
                    publicationGenerationId,
                    `knowledge-node-reuse:${node.id}`,
                  ),
                  publicationGenerationId,
                }),
              )
            : [];
        if (replayedNodes.length > 0) {
          if (reusedSourceNodes.length > 0) {
            assertExactReusedGenerationReplay(replayedNodes, reusedSourceNodes);
          } else if (semanticChunker && retrievalProfile) {
            const replayMaxChunkChars =
              input.chunkConfig?.maxChunkChars ?? semanticChunker.replayDefaults?.maxChunkChars;
            const replayMaxWindowChars = semanticChunker.replayDefaults
              ? Math.max(
                  semanticChunker.replayDefaults.maxWindowChars,
                  replayMaxChunkChars ?? semanticChunker.replayDefaults.maxChunkChars,
                )
              : undefined;
            assertValidLlmSemanticGenerationReplay({
              config: {
                ...(replayMaxChunkChars === undefined
                  ? {}
                  : { maxChunkChars: replayMaxChunkChars }),
                ...(replayMaxWindowChars === undefined
                  ? {}
                  : { maxWindowChars: replayMaxWindowChars }),
                maxNodes: input.chunkConfig?.maxNodes ?? maxNodes,
                ...(input.chunkConfig?.overlapChars === undefined
                  ? {}
                  : { overlapChars: input.chunkConfig.overlapChars }),
              },
              excludedNodeOrdinals,
              ...(input.language ? { language: input.language } : {}),
              modelSelection: retrievalProfile.reasoningModel,
              nodes: replayedNodes,
              parseArtifact: storedArtifact,
              permissionScope: input.permissionScope ?? [],
              ...(semanticChunker.replayDefaults?.promptVersion
                ? { promptVersion: semanticChunker.replayDefaults.promptVersion }
                : {}),
              publicationGenerationId,
            });
          }
        }
        if (
          semanticReceiptRequest &&
          !generationReceipt &&
          replayedNodes.length === 0 &&
          reusedSourceNodes.length === 0
        ) {
          const preflight = preflightLlmSemanticWindows({
            config: {
              maxChunkChars: semanticReceiptRequest.semanticConfig.maxChunkChars,
              maxNodes: semanticReceiptRequest.semanticConfig.maxNodes,
              maxWindowChars: semanticReceiptRequest.semanticConfig.maxWindowChars,
              overlapChars: semanticReceiptRequest.semanticConfig.overlapChars,
            },
            parseArtifact: storedArtifact,
            promptVersion: semanticReceiptRequest.semanticConfig.promptVersion,
          });
          assertSemanticGenerationReceiptAdmission({
            maximumChunkCount: Math.min(
              preflight.unitCount,
              semanticReceiptRequest.semanticConfig.maxNodes,
            ),
            maximumWindowCount: preflight.maximumWindowCount,
            request: semanticReceiptRequest,
          });
        }
        const generatedNodes =
          generationReceipt || replayedNodes.length > 0 || reusedSourceNodes.length > 0
            ? []
            : semanticChunker && retrievalProfile
              ? await semanticChunker.chunk({
                  config: {
                    ...(input.chunkConfig?.maxChunkChars !== undefined
                      ? { maxChunkChars: input.chunkConfig.maxChunkChars }
                      : {}),
                    maxNodes: input.chunkConfig?.maxNodes ?? maxNodes,
                    ...(input.chunkConfig?.overlapChars !== undefined
                      ? { overlapChars: input.chunkConfig.overlapChars }
                      : {}),
                  },
                  knowledgeSpaceId: input.knowledgeSpaceId,
                  enableGraph: input.enableGraph !== false,
                  enablePageIndex: input.enablePageIndex !== false,
                  ...(input.modelBudget ? { modelBudget: input.modelBudget } : {}),
                  parseArtifact: storedArtifact,
                  ...(input.permissionScope ? { permissionScope: [...input.permissionScope] } : {}),
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  retrievalProfile,
                  ...(input.tenantId ? { tenantId: input.tenantId } : {}),
                })
              : compute.chunkParseArtifact({
                  ...(input.chunkConfig ? { config: input.chunkConfig } : {}),
                  knowledgeSpaceId: input.knowledgeSpaceId,
                  parseArtifact: storedArtifact,
                  ...(input.permissionScope ? { permissionScope: [...input.permissionScope] } : {}),
                });
        input.signal?.throwIfAborted();
        const chunkedNodes =
          replayedNodes.length > 0
            ? replayedNodes
            : reusedSourceNodes.length > 0
              ? reusedSourceNodes
              : generatedNodes
                  .filter((_, ordinal) => !excludedNodeOrdinals.has(ordinal))
                  .map((node) =>
                    cloneKnowledgeNode(
                      publicationGenerationId
                        ? {
                            ...node,
                            id:
                              node.publicationGenerationId === publicationGenerationId
                                ? node.id
                                : deterministicChildId(
                                    publicationGenerationId,
                                    `knowledge-node:${node.id}`,
                                  ),
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

        const generationReceiptToPersist =
          semanticReceiptRequest &&
          !generationReceipt &&
          replayedNodes.length === 0 &&
          reusedSourceNodes.length === 0
            ? createSemanticGenerationReceipt({
                generatedNodes,
                request: semanticReceiptRequest,
                storedNodes: chunkedNodes,
              })
            : undefined;

        if (chunkedNodes.length > maxNodes) {
          throw new Error(`Incremental reindexer node count exceeds maxNodes=${maxNodes}`);
        }

        const storedNodes =
          replayedNodes.length > 0
            ? replayedNodes.map(cloneKnowledgeNode)
            : generationReceiptToPersist
              ? ((
                  await nodes.completeGenerationAtomically?.({
                    nodes: chunkedNodes.map(cloneKnowledgeNode),
                    receipt: generationReceiptToPersist,
                  })
                )?.nodes ??
                (() => {
                  throw new Error(
                    "Incremental reindexer requires atomic semantic generation receipts",
                  );
                })())
              : chunkedNodes.length > 0
                ? publicationGenerationId && nodes.upsertGenerationAtomically
                  ? await nodes.upsertGenerationAtomically(chunkedNodes.map(cloneKnowledgeNode))
                  : await nodes.upsertMany(chunkedNodes.map(cloneKnowledgeNode))
                : [];
        input.signal?.throwIfAborted();
        if (input.resetFailedProjections && projections) {
          for (const nodeBatch of chunkNodes(storedNodes, projectionBatchSize)) {
            await projections.deleteByNodeIds({
              knowledgeSpaceId: input.knowledgeSpaceId,
              maxProjections: nodeBatch.length * 3,
              nodeIds: nodeBatch.map((node) => node.id),
            });
          }
        }
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
                ...(input.modelBudget ? { modelBudget: input.modelBudget } : {}),
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
                ...(input.modelBudget ? { modelBudget: input.modelBudget } : {}),
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
          ...(semanticChunker && retrievalProfile
            ? { outlineArtifact: semanticOutlineArtifact(storedArtifact, storedNodes) }
            : {}),
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

function semanticOutlineArtifact(
  parseArtifact: ParseArtifact,
  nodes: readonly KnowledgeNode[],
): ParseArtifact {
  return ParseArtifactSchema.parse({
    ...cloneParseArtifact(parseArtifact),
    elements: nodes.map((node) => {
      const semantic = isPlainObject(node.metadata.semanticChunking)
        ? node.metadata.semanticChunking
        : undefined;
      const section = semantic && isPlainObject(semantic.section) ? semantic.section : undefined;
      const summary = section && typeof section.summary === "string" ? section.summary : undefined;
      return {
        id: node.id,
        metadata: {
          ...(summary ? { semanticSectionSummary: summary } : {}),
          sourceKnowledgeNodeId: node.id,
        },
        ...(node.sourceLocation.pageNumber === undefined
          ? {}
          : { pageNumber: node.sourceLocation.pageNumber }),
        sectionPath: [...node.sourceLocation.sectionPath],
        sourceLocation: {
          endOffset: node.endOffset,
          startOffset: node.startOffset,
        },
        text: node.text,
        type: node.kind === "table" ? "table" : node.kind === "image" ? "image" : "paragraph",
      };
    }),
    metadata: {
      ...parseArtifact.metadata,
      semanticCompilation: {
        nodeCount: nodes.length,
        source: "llm-semantic-v2",
      },
    },
  });
}

interface SemanticGenerationReceiptRequest {
  readonly artifactHash: string;
  readonly documentAssetId: string;
  readonly excludedNodeOrdinals: readonly number[];
  readonly knowledgeSpaceId: string;
  readonly language?: string | undefined;
  readonly modelSelection: KnowledgeSpaceRetrievalProfile["reasoningModel"];
  readonly parseArtifactId: string;
  readonly permissionScope: readonly string[];
  readonly publicationGenerationId: string;
  readonly requestFingerprint: string;
  readonly semanticConfig: KnowledgeNodeSemanticGenerationConfig;
}

function semanticGenerationReceiptRequest({
  chunkConfig,
  excludedNodeOrdinals,
  knowledgeSpaceId,
  language,
  maxNodes,
  modelSelection,
  parseArtifact,
  permissionScope,
  publicationGenerationId,
  semanticChunker,
}: {
  readonly chunkConfig?: ChunkConfig | undefined;
  readonly excludedNodeOrdinals: ReadonlySet<number>;
  readonly knowledgeSpaceId: string;
  readonly language?: string | undefined;
  readonly maxNodes: number;
  readonly modelSelection: KnowledgeSpaceRetrievalProfile["reasoningModel"];
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope: readonly string[];
  readonly publicationGenerationId: string;
  readonly semanticChunker: SemanticChunker;
}): SemanticGenerationReceiptRequest {
  if (!semanticChunker.replayDefaults) {
    throw new Error(
      "Incremental reindexer semantic chunker must expose replay defaults for durable receipts",
    );
  }
  const maxChunkChars = chunkConfig?.maxChunkChars ?? semanticChunker.replayDefaults.maxChunkChars;
  const semanticConfig: KnowledgeNodeSemanticGenerationConfig = {
    maxChunkChars,
    maxNodes: chunkConfig?.maxNodes ?? maxNodes,
    maxWindowChars: Math.max(semanticChunker.replayDefaults.maxWindowChars, maxChunkChars),
    overlapChars: chunkConfig?.overlapChars ?? 0,
    promptVersion: semanticChunker.replayDefaults.promptVersion,
  };
  const request = {
    artifactHash: parseArtifact.artifactHash,
    documentAssetId: parseArtifact.documentAssetId,
    excludedNodeOrdinals: [...excludedNodeOrdinals].sort((left, right) => left - right),
    knowledgeSpaceId,
    ...(language ? { language } : {}),
    modelSelection,
    parseArtifactId: parseArtifact.id,
    permissionScope: [...permissionScope],
    publicationGenerationId,
    semanticConfig,
  };
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Incremental reindexer semantic receipt knowledgeSpaceId is required");
  }
  return {
    ...request,
    requestFingerprint: sha256StableJson(request),
  };
}

function createSemanticGenerationReceipt({
  generatedNodes,
  request,
  storedNodes,
}: {
  readonly generatedNodes: readonly KnowledgeNode[];
  readonly request: SemanticGenerationReceiptRequest;
  readonly storedNodes: readonly KnowledgeNode[];
}): KnowledgeNodeGenerationReceipt {
  const { completionCatalog, windowManifest } = semanticGenerationWindowManifest(generatedNodes);
  const responseFingerprint = sha256StableJson({ completionCatalog, windowManifest });
  return {
    artifactHash: request.artifactHash,
    completionCatalog,
    documentAssetId: request.documentAssetId,
    documentChunkCount: generatedNodes.length,
    excludedNodeOrdinals: [...request.excludedNodeOrdinals],
    knowledgeSpaceId: request.knowledgeSpaceId,
    ...(request.language ? { language: request.language } : {}),
    modelSelection: request.modelSelection,
    parseArtifactId: request.parseArtifactId,
    permissionScope: [...request.permissionScope],
    promptResponseFingerprint: sha256StableJson({
      requestFingerprint: request.requestFingerprint,
      responseFingerprint,
    }),
    publicationGenerationId: request.publicationGenerationId,
    requestFingerprint: request.requestFingerprint,
    responseFingerprint,
    schemaVersion: 1,
    semanticConfig: request.semanticConfig,
    storedNodeCount: storedNodes.length,
    storedResponseFingerprint: semanticNodesResponseFingerprint(storedNodes),
    windowManifest,
  };
}

function assertSemanticGenerationReceiptAdmission({
  maximumChunkCount,
  maximumWindowCount,
  request,
}: {
  readonly maximumChunkCount: number;
  readonly maximumWindowCount: number;
  readonly request: SemanticGenerationReceiptRequest;
}): void {
  if (
    request.excludedNodeOrdinals.some(
      (ordinal) => !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= maximumChunkCount,
    )
  ) {
    throw new Error(
      "Incremental reindexer semantic generation exclusions exceed the canonical chunk upper bound",
    );
  }
  const emptyFingerprint = `sha256:${"0".repeat(64)}`;
  const emptyReceipt: KnowledgeNodeGenerationReceipt = {
    artifactHash: request.artifactHash,
    completionCatalog: [],
    documentAssetId: request.documentAssetId,
    documentChunkCount: maximumChunkCount,
    excludedNodeOrdinals: [...request.excludedNodeOrdinals],
    knowledgeSpaceId: request.knowledgeSpaceId,
    ...(request.language ? { language: request.language } : {}),
    modelSelection: request.modelSelection,
    parseArtifactId: request.parseArtifactId,
    permissionScope: [...request.permissionScope],
    promptResponseFingerprint: emptyFingerprint,
    publicationGenerationId: request.publicationGenerationId,
    requestFingerprint: request.requestFingerprint,
    responseFingerprint: emptyFingerprint,
    schemaVersion: 1,
    semanticConfig: request.semanticConfig,
    storedNodeCount: maximumChunkCount,
    storedResponseFingerprint: emptyFingerprint,
    windowManifest: [],
  };
  const maximumBytes = maximumKnowledgeNodeGenerationReceiptSerializedBytes({
    emptyReceipt,
    maximumChunkCount,
    maximumWindowCount,
  });
  if (maximumBytes > MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES) {
    throw new Error(
      `Incremental reindexer semantic generation receipt admission exceeds maxBytes=${MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES} (upperBoundBytes=${maximumBytes})`,
    );
  }
}

function assertSemanticGenerationReceiptReplay({
  expected,
  nodes,
  parseArtifact,
  receipt,
}: {
  readonly expected: SemanticGenerationReceiptRequest;
  readonly nodes: readonly KnowledgeNode[];
  readonly parseArtifact: ParseArtifact;
  readonly receipt: KnowledgeNodeGenerationReceipt;
}): void {
  const expectedIdentity = {
    artifactHash: expected.artifactHash,
    documentAssetId: expected.documentAssetId,
    excludedNodeOrdinals: expected.excludedNodeOrdinals,
    knowledgeSpaceId: expected.knowledgeSpaceId,
    ...(expected.language ? { language: expected.language } : {}),
    modelSelection: expected.modelSelection,
    parseArtifactId: expected.parseArtifactId,
    permissionScope: expected.permissionScope,
    publicationGenerationId: expected.publicationGenerationId,
    requestFingerprint: expected.requestFingerprint,
    semanticConfig: expected.semanticConfig,
  };
  const receiptIdentity = {
    artifactHash: receipt.artifactHash,
    documentAssetId: receipt.documentAssetId,
    excludedNodeOrdinals: receipt.excludedNodeOrdinals,
    knowledgeSpaceId: receipt.knowledgeSpaceId,
    ...(receipt.language ? { language: receipt.language } : {}),
    modelSelection: receipt.modelSelection,
    parseArtifactId: receipt.parseArtifactId,
    permissionScope: receipt.permissionScope,
    publicationGenerationId: receipt.publicationGenerationId,
    requestFingerprint: receipt.requestFingerprint,
    semanticConfig: receipt.semanticConfig,
  };
  if (stableJson(expectedIdentity) !== stableJson(receiptIdentity)) {
    throw new Error("LLM semantic replay validation failed: generation receipt request mismatch");
  }
  const responseFingerprint = sha256StableJson({
    completionCatalog: receipt.completionCatalog,
    windowManifest: receipt.windowManifest,
  });
  const promptResponseFingerprint = sha256StableJson({
    requestFingerprint: receipt.requestFingerprint,
    responseFingerprint,
  });
  if (
    receipt.responseFingerprint !== responseFingerprint ||
    receipt.promptResponseFingerprint !== promptResponseFingerprint
  ) {
    throw new Error(
      "LLM semantic replay validation failed: generation receipt provenance mismatch",
    );
  }
  assertValidLlmSemanticWindowManifestReplay({
    completionCatalog: receipt.completionCatalog,
    config: {
      maxChunkChars: receipt.semanticConfig.maxChunkChars,
      maxNodes: receipt.semanticConfig.maxNodes,
      maxWindowChars: receipt.semanticConfig.maxWindowChars,
      overlapChars: receipt.semanticConfig.overlapChars,
    },
    documentChunkCount: receipt.documentChunkCount,
    modelSelection: receipt.modelSelection,
    parseArtifact,
    promptVersion: receipt.semanticConfig.promptVersion,
    windowManifest: receipt.windowManifest,
  });
  if (
    receipt.storedNodeCount !== nodes.length ||
    receipt.storedResponseFingerprint !== semanticNodesResponseFingerprint(nodes)
  ) {
    throw new Error(
      "LLM semantic replay validation failed: generation receipt stored-node mismatch",
    );
  }
  const manifestChunks = new Map(
    receipt.windowManifest.flatMap((window) =>
      window.chunkRanges.map(
        (unitRange, offset) =>
          [window.firstChunkIndex + offset, { unitRange, windowId: window.windowId }] as const,
      ),
    ),
  );
  for (const node of nodes) {
    const chunkIndex = node.metadata.chunkIndex;
    const expectedChunk =
      Number.isSafeInteger(chunkIndex) && manifestChunks.get(chunkIndex as number);
    const semanticMarker = node.metadata.semanticChunking;
    const unitRange = isPlainObject(semanticMarker)
      ? semanticMarkerUnitRangeReceipt(semanticMarker.unitRange)
      : undefined;
    const markerWindowId = isPlainObject(semanticMarker) ? semanticMarker.windowId : undefined;
    if (
      !expectedChunk ||
      !unitRange ||
      markerWindowId !== expectedChunk.windowId ||
      stableJson(unitRange) !== stableJson(expectedChunk.unitRange)
    ) {
      throw new Error("LLM semantic replay validation failed: generation receipt node mismatch");
    }
  }
}

function semanticGenerationWindowManifest(nodes: readonly KnowledgeNode[]): {
  readonly completionCatalog: KnowledgeNodeGenerationCompletionReceipt[];
  readonly windowManifest: KnowledgeNodeGenerationWindowReceipt[];
} {
  const completionCatalog: KnowledgeNodeGenerationCompletionReceipt[] = [];
  const completionIndexes = new Map<string, number>();
  const windows = new Map<
    string,
    {
      readonly payloads: Readonly<Record<string, unknown>>[];
      readonly receipt: KnowledgeNodeGenerationWindowReceipt;
    }
  >();
  const ordered = [...nodes].sort(
    (left, right) =>
      Number(left.metadata.chunkIndex) - Number(right.metadata.chunkIndex) ||
      left.id.localeCompare(right.id),
  );
  for (const [ordinal, node] of ordered.entries()) {
    const marker = node.metadata.semanticChunking;
    const unitRange = isPlainObject(marker)
      ? semanticMarkerUnitRangeReceipt(marker.unitRange)
      : undefined;
    const coreUnitRange = isPlainObject(marker)
      ? semanticMarkerUnitRangeReceipt(marker.windowCoreUnitRange)
      : undefined;
    const committedUnitRange = isPlainObject(marker)
      ? semanticMarkerUnitRangeReceipt(marker.windowCommittedUnitRange)
      : undefined;
    const lookAheadUnitRange = isPlainObject(marker)
      ? semanticMarkerUnitRangeReceipt(marker.windowLookAheadUnitRange)
      : undefined;
    const windowId = isPlainObject(marker) ? marker.windowId : undefined;
    const inputFingerprint = isPlainObject(marker) ? marker.inputFingerprint : undefined;
    const chunkIndex = node.metadata.chunkIndex;
    if (
      !isPlainObject(marker) ||
      !unitRange ||
      !coreUnitRange ||
      !committedUnitRange ||
      typeof windowId !== "string" ||
      !windowId.trim() ||
      typeof inputFingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(inputFingerprint) ||
      !Number.isSafeInteger(chunkIndex) ||
      chunkIndex !== ordinal
    ) {
      throw new Error(
        "Incremental reindexer cannot build semantic window receipt from node marker",
      );
    }
    const completion = semanticGenerationCompletionReceipt(marker);
    let completionIndex = completionIndexes.get(completion.fingerprint);
    if (completionIndex === undefined) {
      completionIndex = completionCatalog.length;
      completionIndexes.set(completion.fingerprint, completionIndex);
      completionCatalog.push(completion);
    } else if (stableJson(completionCatalog[completionIndex]) !== stableJson(completion)) {
      throw new Error("Incremental reindexer semantic completion fingerprint collision");
    }
    const payload = semanticNodeResponsePayload(node);
    const existing = windows.get(windowId);
    if (existing) {
      if (
        existing.receipt.inputFingerprint !== inputFingerprint ||
        existing.receipt.completionIndex !== completionIndex ||
        stableJson(existing.receipt.coreUnitRange) !== stableJson(coreUnitRange) ||
        stableJson(existing.receipt.committedUnitRange) !== stableJson(committedUnitRange) ||
        stableJson(existing.receipt.lookAheadUnitRange) !== stableJson(lookAheadUnitRange) ||
        existing.receipt.firstChunkIndex + existing.receipt.chunkRanges.length !== chunkIndex
      ) {
        throw new Error("Incremental reindexer semantic window provenance is inconsistent");
      }
      const chunkRanges = [...existing.receipt.chunkRanges, unitRange];
      const payloads = [...existing.payloads, payload];
      windows.set(windowId, {
        payloads,
        receipt: {
          ...existing.receipt,
          chunkRanges,
          responseFingerprint: sha256StableJson(payloads),
        },
      });
      continue;
    }
    windows.set(windowId, {
      payloads: [payload],
      receipt: {
        chunkRanges: [unitRange],
        committedUnitRange,
        completionIndex,
        coreUnitRange,
        firstChunkIndex: chunkIndex as number,
        inputFingerprint,
        ...(lookAheadUnitRange ? { lookAheadUnitRange } : {}),
        responseFingerprint: sha256StableJson([payload]),
        windowId,
      },
    });
  }
  return {
    completionCatalog,
    windowManifest: [...windows.values()].map(({ receipt }) => receipt),
  };
}

function semanticGenerationCompletionReceipt(
  marker: Readonly<Record<string, unknown>>,
): KnowledgeNodeGenerationCompletionReceipt {
  const completion = marker.completion;
  const actual = isPlainObject(completion) ? completion.actual : undefined;
  if (!isPlainObject(actual)) {
    throw new Error("Incremental reindexer semantic completion identity is missing");
  }
  const identity = {
    ...optionalSemanticCompletionField(actual.model, "actualModel"),
    ...optionalSemanticCompletionField(actual.provider, "actualProvider"),
    ...optionalSemanticCompletionField(actual.finishReason, "finishReason"),
    ...optionalSemanticCompletionField(marker.provider, "transportProvider"),
  };
  return {
    fingerprint: llmSemanticCompletionFingerprint(identity),
    ...identity,
  };
}

function optionalSemanticCompletionField(
  value: unknown,
  field: "actualModel" | "actualProvider" | "finishReason" | "transportProvider",
): Partial<Record<typeof field, string>> {
  if (value === undefined) return {};
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Incremental reindexer semantic completion ${field} is invalid`);
  }
  return { [field]: value.trim() } as Partial<Record<typeof field, string>>;
}

function semanticMarkerUnitRangeReceipt(
  value: unknown,
): KnowledgeNodeGenerationUnitRangeReceipt | undefined {
  if (!isPlainObject(value)) return undefined;
  const startUnitId = value.startUnitId;
  const endUnitId = value.endUnitId;
  return typeof startUnitId === "string" &&
    startUnitId.trim() &&
    typeof endUnitId === "string" &&
    endUnitId.trim()
    ? [startUnitId.trim(), endUnitId.trim()]
    : undefined;
}

function semanticNodesResponseFingerprint(nodes: readonly KnowledgeNode[]): string {
  return sha256StableJson(
    [...nodes]
      .sort(
        (left, right) =>
          Number(left.metadata.chunkIndex) - Number(right.metadata.chunkIndex) ||
          left.id.localeCompare(right.id),
      )
      .map(semanticNodeResponsePayload),
  );
}

function semanticNodeResponsePayload(node: KnowledgeNode): Readonly<Record<string, unknown>> {
  return {
    chunkIndex: node.metadata.chunkIndex,
    endOffset: node.endOffset,
    entityExtraction: node.metadata.entityExtraction,
    extractedEntities: extractionResponseWithoutQuality(node.metadata.extractedEntities),
    extractedRelations: extractionResponseWithoutQuality(node.metadata.extractedRelations),
    id: node.id,
    kind: node.kind,
    relationExtraction: node.metadata.relationExtraction,
    semanticChunking: node.metadata.semanticChunking,
    sourceLocation: node.sourceLocation,
    startOffset: node.startOffset,
    text: node.text,
  };
}

function extractionResponseWithoutQuality(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isPlainObject(item)) return item;
    const { quality: _quality, ...response } = JSON.parse(JSON.stringify(item)) as Record<
      string,
      unknown
    >;
    return response;
  });
}

function sha256StableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function chunkNodes(nodes: readonly KnowledgeNode[], size: number) {
  const chunks: KnowledgeNode[][] = [];

  for (let start = 0; start < nodes.length; start += size) {
    chunks.push(nodes.slice(start, start + size));
  }

  return chunks;
}

async function listGenerationArtifactNodes({
  knowledgeSpaceId,
  maxNodes,
  nodes,
  pageSize,
  parseArtifactId,
  publicationGenerationId,
}: {
  readonly knowledgeSpaceId: string;
  readonly maxNodes: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly pageSize: number;
  readonly parseArtifactId: string;
  readonly publicationGenerationId: string;
}): Promise<KnowledgeNode[]> {
  const collected: KnowledgeNode[] = [];
  let cursor: Awaited<ReturnType<KnowledgeNodeRepository["listByArtifact"]>>["nextCursor"];

  do {
    const page = await nodes.listByArtifact({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId,
      limit: Math.min(pageSize, maxNodes - collected.length),
      parseArtifactId,
      publicationGenerationId,
    });
    collected.push(...page.items.map(cloneKnowledgeNode));
    cursor = page.nextCursor;
    if (cursor && collected.length >= maxNodes) {
      throw new Error(`Incremental reindexer node count exceeds maxNodes=${maxNodes}`);
    }
  } while (cursor);

  return collected;
}

function chunkStrings(values: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];

  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }

  return chunks;
}

function assertExactReusedGenerationReplay(
  replayedNodes: readonly KnowledgeNode[],
  expectedNodes: readonly KnowledgeNode[],
): void {
  if (
    replayedNodes.length !== expectedNodes.length ||
    replayedNodes.some((node, index) => stableJson(node) !== stableJson(expectedNodes[index]))
  ) {
    throw new Error(
      "Incremental reindexer found an incomplete projection-only node generation replay",
    );
  }
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
    nodes,
    semanticChunker,
    visualBuilder,
  }: Pick<IncrementalReindexerOptions, "nodes" | "semanticChunker" | "visualBuilder">,
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

  if (input.reuseNodeGenerationId !== undefined) {
    PublicationGenerationIdSchema.parse(input.reuseNodeGenerationId);
    if (!input.publicationGenerationId) {
      throw new Error(
        "Incremental reindexer reuseNodeGenerationId requires publicationGenerationId",
      );
    }
    if (input.reuseNodeGenerationId === input.publicationGenerationId) {
      throw new Error("Incremental reindexer source and target node generations must be different");
    }
  }

  if (input.skipDense && (input.denseModel?.trim() || input.embeddingProfile)) {
    throw new Error("Incremental reindexer skipDense cannot include dense model configuration");
  }

  if (input.skipVisual && input.visualModel?.trim()) {
    throw new Error("Incremental reindexer skipVisual cannot include visual model configuration");
  }

  if (visualBuilder && !input.skipVisual && !input.visualModel?.trim()) {
    throw new Error(
      "Incremental reindexer visualModel is required when visualBuilder is configured",
    );
  }

  if (semanticChunker && input.retrievalProfile && !input.tenantId?.trim()) {
    throw new Error(
      "Incremental reindexer tenantId is required for profile-scoped semantic chunking",
    );
  }
  if (
    semanticChunker &&
    input.retrievalProfile &&
    input.publicationGenerationId &&
    (!nodes.completeGenerationAtomically || !nodes.getGenerationReceipt)
  ) {
    throw new Error(
      "Incremental reindexer generation-scoped semantic chunking requires durable generation receipts",
    );
  }
}
