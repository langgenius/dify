import { z } from "@hono/zod-openapi";
import type { ChunkConfig } from "@knowledge/compute";
import {
  type JobPayload,
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceRetrievalProfile,
  type PlatformAdapter,
  PublicationGenerationIdSchema,
  TenantIdSchema,
} from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
} from "./deletion-lifecycle-fence";
import {
  type DeletionObjectWriteAdmission,
  DeletionObjectWriteAdmissionError,
} from "./deletion-object-write-admission";
import { withDeletionObjectWriteAdmission } from "./deletion-object-write-storage";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type { DocumentCompilationCandidateComponentReceipt } from "./document-compilation-publication-coordinator";
import type { DocumentImageVariantGenerator } from "./document-image-variant-generator";
import {
  buildDocumentKnowledgePath,
  buildDocumentMultimodalAssetKnowledgePaths,
  buildDocumentMultimodalManifestKnowledgePath,
  buildDocumentMultimodalResourceKnowledgePaths,
  buildDocumentOutlineKnowledgePath,
  buildDocumentSectionKnowledgePaths,
} from "./document-knowledge-paths";
import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineBuilder } from "./document-outline-builder";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import {
  type DocumentPdfRasterizer,
  rasterizeDocumentPdfMultimodalAssets,
} from "./document-pdf-rasterizer";
import { logDocumentUploadDiagnostic } from "./document-upload-diagnostics";
import type { IncrementalReindexer } from "./index-reindexer";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { KnowledgeSpaceEmbeddingResolver } from "./knowledge-space-embedding-resolver";
import type { PublishedPageIndexBuildRepository } from "./page-index-build-repository";
import {
  type RetrievalEvaluationReport,
  cloneRetrievalEvaluationReport,
} from "./retrieval-evaluation-reports";
import type { RetrievalEvaluationRunner } from "./retrieval-evaluation-runners";
import type { SemanticIngestionPostProcessor } from "./semantic-ingestion-postprocessor";

export interface DocumentCompilationWorkerOptions {
  readonly assets: DocumentAssetRepository;
  readonly candidateComposer?: DocumentCompilationWorkerCandidateComposer | undefined;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly denseEmbeddingModel?: string | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  /** Immutable profile loaded from the durable attempt; production candidate builds always set it. */
  readonly frozenEmbeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  /** Immutable reasoning/rerank snapshot used to build PageIndex Summary/Outline artifacts. */
  readonly frozenRetrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly indexOverrides?: DocumentCompilationIndexOverrideResolver | undefined;
  /**
   * Durable runners own retry/terminal transitions and must keep transient failures out of the
   * asset and legacy job records. The default preserves the existing legacy worker contract.
   */
  readonly failureManagement?: "caller" | "worker" | undefined;
  readonly generateKnowledgePathId?: (() => string) | undefined;
  readonly jobs: DocumentCompilationJobStateMachine;
  readonly knowledgePaths?: KnowledgePathRepository | undefined;
  readonly multimodalImageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly multimodalLocalAssetAllowlist?: readonly string[] | undefined;
  readonly multimodalMaxExtractedAssets?: number | undefined;
  readonly multimodalMaxLocalAssetBytes?: number | undefined;
  readonly multimodalMaxPdfRasterizedAssets?: number | undefined;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly parser: ParserAdapter;
  readonly pdfRasterizer?: DocumentPdfRasterizer | undefined;
  readonly reindexer: IncrementalReindexer;
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
  readonly outlineBuilder?: DocumentOutlineBuilder | undefined;
  readonly outlineSummaryEnhancer?: DocumentOutlineSummaryEnhancer | undefined;
  readonly outlines?: DocumentOutlineRepository | undefined;
  readonly pageIndexBuild?:
    | Pick<PublishedPageIndexBuildRepository, "materializeBuilding">
    | undefined;
  readonly semanticPostProcessor?: SemanticIngestionPostProcessor | undefined;
  readonly smokeEvaluation?: IngestionSmokeEvaluationGate | undefined;
  readonly visualEmbeddingModel?: string | undefined;
}

export interface DocumentCompilationIndexOverrides {
  readonly chunkConfig?: ChunkConfig | undefined;
  readonly enableGraph?: boolean | undefined;
  readonly enablePageIndex?: boolean | undefined;
  readonly excludedNodeOrdinals?: readonly number[] | undefined;
  readonly language?: string | undefined;
}

export interface DocumentCompilationIndexOverrideResolver {
  resolve(input: {
    readonly compilationAttemptId: string;
    readonly documentAssetId: string;
    readonly documentAssetVersion?: number | undefined;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<DocumentCompilationIndexOverrides>;
}

export interface DocumentCompilationWorker {
  process(payload: JobPayload): Promise<DocumentCompilationJob>;
}

export interface ComposeDocumentCompilationWorkerCandidateInput {
  readonly componentReceipt: DocumentCompilationCandidateComponentReceipt;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
  readonly tenantId: string;
}

/** A per-execution adapter binds the receipt to the durable coordinator and its lease fence. */
export interface DocumentCompilationWorkerCandidateComposer {
  compose(input: ComposeDocumentCompilationWorkerCandidateInput): Promise<void>;
}

export interface IngestionSmokeEvaluationThresholds {
  readonly maxNoAnswerRate: number;
  readonly minCitationHitRate: number;
  readonly minRecallAtK: number;
}

export interface IngestionSmokeEvaluationGateOptions {
  readonly evaluation: RetrievalEvaluationRunner;
  readonly limit: number;
  readonly thresholds: IngestionSmokeEvaluationThresholds;
  readonly topK: number;
}

export interface RunIngestionSmokeEvaluationInput {
  readonly knowledgeSpaceId: string;
}

export type IngestionSmokeEvaluationResult =
  | {
      readonly decision: "passed";
      readonly evaluation: RetrievalEvaluationReport;
    }
  | {
      readonly decision: "failed";
      readonly evaluation: RetrievalEvaluationReport;
      readonly rejectedReason: string;
    };

export interface IngestionSmokeEvaluationGate {
  evaluate(input: RunIngestionSmokeEvaluationInput): Promise<IngestionSmokeEvaluationResult>;
}

const DocumentCompilationPayloadSchema = z.object({
  documentAssetId: z.string().min(1),
  documentCompilationJobId: z.string().min(1),
  knowledgeSpaceId: z.string().min(1),
  publicationGenerationId: PublicationGenerationIdSchema.optional(),
  tenantId: TenantIdSchema,
  version: z.number().int().positive(),
});

export function createDocumentCompilationWorker({
  assets,
  candidateComposer,
  deletionFence,
  denseEmbeddingModel,
  embeddingResolver,
  frozenEmbeddingProfile,
  frozenRetrievalProfile,
  indexOverrides,
  failureManagement = "worker",
  generateKnowledgePathId,
  jobs,
  knowledgePaths,
  multimodalImageVariantGenerator,
  multimodalLocalAssetAllowlist,
  multimodalMaxExtractedAssets,
  multimodalMaxLocalAssetBytes,
  multimodalMaxPdfRasterizedAssets,
  multimodalManifests,
  objectStorage,
  objectWriteAdmission,
  operationLeases,
  outlineBuilder,
  outlineSummaryEnhancer,
  outlines,
  pageIndexBuild,
  parser,
  pdfRasterizer,
  reindexer,
  semanticPostProcessor,
  smokeEvaluation,
  visualEmbeddingModel,
}: DocumentCompilationWorkerOptions): DocumentCompilationWorker {
  const stagedProjectionPublication =
    reindexer.publishProjections && reindexer.failProjections
      ? {
          fail: reindexer.failProjections,
          publish: reindexer.publishProjections,
        }
      : null;

  return {
    process: async (payload) => {
      const input = DocumentCompilationPayloadSchema.parse(payload);
      const publicationGenerationId = input.publicationGenerationId;
      const legacyStagedProjectionPublication = publicationGenerationId
        ? null
        : stagedProjectionPublication;

      let asset: Awaited<ReturnType<DocumentAssetRepository["get"]>> | null | undefined;
      let stagedProjectionIds: readonly string[] = [];
      let assertWritable = async (): Promise<void> => undefined;
      let cleanupStaleObjectWrites = async (): Promise<void> => undefined;

      try {
        if (publicationGenerationId !== undefined && !candidateComposer) {
          throw new Error(
            "Generation-scoped document compilation requires a publication coordinator",
          );
        }
        if (
          publicationGenerationId !== undefined &&
          (!outlineBuilder ||
            !outlines ||
            !knowledgePaths ||
            !generateKnowledgePathId ||
            !pageIndexBuild)
        ) {
          throw new Error(
            "Generation-scoped document compilation requires outline, PageIndex, and knowledge-path builders",
          );
        }

        asset = await assets.get({
          id: input.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
        });

        if (!asset || asset.version !== input.version) {
          throw new Error("Document compilation asset not found");
        }

        const activeAsset = asset;
        const deletionToken = await deletionFence?.captureDeletionFence({
          documentAssetId: activeAsset.id,
          knowledgeSpaceId: input.knowledgeSpaceId,
          ...(activeAsset.sourceId ? { sourceId: activeAsset.sourceId } : {}),
          tenantId: input.tenantId,
        });
        assertWritable = async () => {
          if (deletionToken) {
            await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
          }
        };
        const multimodalObjectStorage =
          deletionToken || objectWriteAdmission
            ? createDeletionFencedCompilationObjectStorage({
                assertWritable,
                objectWriteAdmission,
                objectStorage,
                onCleanupReady: (cleanup) => {
                  cleanupStaleObjectWrites = cleanup;
                },
                scope: { knowledgeSpaceId: input.knowledgeSpaceId, tenantId: input.tenantId },
              })
            : objectStorage;
        const compile = async () => {
          const body = await objectStorage.getObject(activeAsset.objectKey);

          if (!body) {
            throw new Error("Document compilation object not found");
          }

          const parsedArtifact = await parser.parse({
            body,
            documentAssetId: activeAsset.id,
            filename: activeAsset.filename,
            mimeType: activeAsset.mimeType,
            version: activeAsset.version,
          });
          await assertWritable();
          const rasterized = await rasterizeDocumentPdfMultimodalAssets({
            artifact: parsedArtifact,
            documentBody: body,
            documentMimeType: activeAsset.mimeType,
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(multimodalMaxPdfRasterizedAssets
              ? { maxRasterizedAssets: multimodalMaxPdfRasterizedAssets }
              : {}),
            objectStorage: multimodalObjectStorage,
            ...(pdfRasterizer ? { rasterizer: pdfRasterizer } : {}),
            tenantId: input.tenantId,
          });
          await assertWritable();
          const { artifact } = await extractDocumentMultimodalAssets({
            ...(multimodalLocalAssetAllowlist
              ? { allowLocalAssetPaths: multimodalLocalAssetAllowlist }
              : {}),
            artifact: rasterized.artifact,
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(multimodalMaxExtractedAssets
              ? { maxExtractedAssets: multimodalMaxExtractedAssets }
              : {}),
            ...(multimodalMaxLocalAssetBytes
              ? { maxLocalAssetBytes: multimodalMaxLocalAssetBytes }
              : {}),
            ...(multimodalImageVariantGenerator
              ? { imageVariantGenerator: multimodalImageVariantGenerator }
              : {}),
            objectStorage: multimodalObjectStorage,
            tenantId: input.tenantId,
          });
          await assertWritable();
          const canonicalArtifact = reindexer.canonicalizeArtifact
            ? await reindexer.canonicalizeArtifact(artifact)
            : artifact;
          const documentIndexOverrides = indexOverrides
            ? await indexOverrides.resolve({
                compilationAttemptId: input.documentCompilationJobId,
                documentAssetId: activeAsset.id,
                documentAssetVersion: activeAsset.version,
                knowledgeSpaceId: input.knowledgeSpaceId,
                tenantId: input.tenantId,
              })
            : {};
          await assertWritable();
          await jobs.advance(input.documentCompilationJobId, "parsed");
          const multimodalManifest = createDocumentMultimodalManifestBuilder().build({
            artifact: canonicalArtifact,
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(publicationGenerationId ? { publicationGenerationId } : {}),
          });
          let documentOutlineIds: readonly string[] = [];
          let knowledgePathIds: readonly string[] = [];
          if (outlineBuilder && outlines) {
            const deterministicOutline = outlineBuilder.build({
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifact: canonicalArtifact,
              ...(publicationGenerationId ? { publicationGenerationId } : {}),
            });
            const outline = outlineSummaryEnhancer
              ? await outlineSummaryEnhancer.enhance({
                  outline: deterministicOutline,
                  parseArtifact: canonicalArtifact,
                  ...(frozenRetrievalProfile ? { retrievalProfile: frozenRetrievalProfile } : {}),
                  tenantId: input.tenantId,
                })
              : deterministicOutline;
            await assertWritable();
            const persistedOutline = await outlines.upsert(outline);
            if (publicationGenerationId && documentIndexOverrides.enablePageIndex !== false) {
              await assertWritable();
              await pageIndexBuild?.materializeBuilding({
                builtAt: persistedOutline.updatedAt ?? persistedOutline.createdAt,
                outline: persistedOutline,
                tenantId: input.tenantId,
              });
            }
            documentOutlineIds = [persistedOutline.id];
            if (knowledgePaths && generateKnowledgePathId) {
              await assertWritable();
              const persistedPaths = await knowledgePaths.upsertMany([
                ...(publicationGenerationId
                  ? [
                      buildDocumentKnowledgePath({
                        asset: activeAsset,
                        id: generateKnowledgePathId(),
                        publicationGenerationId,
                        tenantId: input.tenantId,
                      }),
                    ]
                  : []),
                buildDocumentMultimodalManifestKnowledgePath({
                  asset: activeAsset,
                  id: generateKnowledgePathId(),
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  tenantId: input.tenantId,
                }),
                ...buildDocumentMultimodalAssetKnowledgePaths({
                  asset: activeAsset,
                  generateId: generateKnowledgePathId,
                  manifest: multimodalManifest,
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  tenantId: input.tenantId,
                }),
                ...buildDocumentMultimodalResourceKnowledgePaths({
                  asset: activeAsset,
                  generateId: generateKnowledgePathId,
                  manifest: multimodalManifest,
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  tenantId: input.tenantId,
                }),
                buildDocumentOutlineKnowledgePath({
                  asset: activeAsset,
                  id: generateKnowledgePathId(),
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  tenantId: input.tenantId,
                }),
                ...buildDocumentSectionKnowledgePaths({
                  asset: activeAsset,
                  generateId: generateKnowledgePathId,
                  outline: persistedOutline,
                  ...(publicationGenerationId ? { publicationGenerationId } : {}),
                  tenantId: input.tenantId,
                }),
              ]);
              knowledgePathIds = persistedPaths.map((path) => path.id);
            }
          }
          await assertWritable();
          const persistedManifest = await multimodalManifests.upsert(multimodalManifest);
          await assertWritable();
          await jobs.advance(input.documentCompilationJobId, "outline_built");

          const resolvedEmbedding = frozenEmbeddingProfile
            ? frozenEmbeddingProfile
            : frozenRetrievalProfile
              ? null
              : embeddingResolver
                ? await embeddingResolver.resolve({
                    knowledgeSpaceId: input.knowledgeSpaceId,
                    tenantId: input.tenantId,
                  })
                : null;
          const denseModel = frozenRetrievalProfile
            ? resolvedEmbedding?.vectorSpaceId
            : (resolvedEmbedding?.vectorSpaceId ?? denseEmbeddingModel);
          await assertWritable();
          const reindexResult = await reindexer.reindex({
            ...(documentIndexOverrides.chunkConfig
              ? { chunkConfig: documentIndexOverrides.chunkConfig }
              : {}),
            ...(denseModel ? { denseModel } : {}),
            ...(documentIndexOverrides.excludedNodeOrdinals
              ? { excludedNodeOrdinals: documentIndexOverrides.excludedNodeOrdinals }
              : {}),
            ...(frozenEmbeddingProfile ? { embeddingProfile: frozenEmbeddingProfile } : {}),
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(documentIndexOverrides.language
              ? { language: documentIndexOverrides.language }
              : {}),
            parseArtifact: canonicalArtifact,
            permissionScope: stringArrayMetadata(activeAsset.metadata.permissionScope),
            projectionStatus:
              publicationGenerationId || legacyStagedProjectionPublication ? "building" : "ready",
            projectionVersion: input.version,
            ...(publicationGenerationId ? { publicationGenerationId } : {}),
            tenantId: input.tenantId,
            ...(visualEmbeddingModel ? { visualModel: visualEmbeddingModel } : {}),
          });
          await assertWritable();
          if (legacyStagedProjectionPublication && reindexResult.status === "rebuilt") {
            stagedProjectionIds = [...(reindexResult.projectionIds ?? [])];

            if (stagedProjectionIds.length !== reindexResult.projectionsCreated) {
              throw new Error(
                "Document compilation staged projection ids do not match projectionsCreated",
              );
            }
          }
          const candidateProjectionIds =
            publicationGenerationId && reindexResult.status === "rebuilt"
              ? [...(reindexResult.projectionIds ?? [])]
              : [];
          if (
            publicationGenerationId &&
            reindexResult.status === "rebuilt" &&
            candidateProjectionIds.length !== reindexResult.projectionsCreated
          ) {
            throw new Error(
              "Generation-scoped document compilation projection receipt is incomplete",
            );
          }
          if (
            publicationGenerationId &&
            reindexResult.status === "rebuilt" &&
            (reindexResult.nodeIds?.length ?? 0) !== reindexResult.nodesCreated
          ) {
            throw new Error("Generation-scoped document compilation node receipt is incomplete");
          }
          await assertWritable();
          await jobs.advance(input.documentCompilationJobId, "nodes_generated");
          let graphEntityIds: readonly string[] = [];
          let graphRelationIds: readonly string[] = [];
          if (
            semanticPostProcessor &&
            reindexResult.status === "rebuilt" &&
            documentIndexOverrides.enableGraph !== false
          ) {
            await assertWritable();
            const postprocess = semanticPostProcessor.process({
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifact: canonicalArtifact,
              ...(publicationGenerationId ? { publicationGenerationId } : {}),
              tenantId: input.tenantId,
            });
            const semanticResult = publicationGenerationId
              ? await postprocess
              : await postprocess.catch(() => undefined);
            await assertWritable();
            graphEntityIds = semanticResult?.graphEntityIds ?? [];
            graphRelationIds = semanticResult?.graphRelationIds ?? [];
          }
          if (publicationGenerationId) {
            await assertWritable();
            await candidateComposer?.compose({
              componentReceipt: {
                documentOutlines: componentReferences(documentOutlineIds, publicationGenerationId),
                graphEntities: componentReferences(graphEntityIds, publicationGenerationId),
                graphRelations: componentReferences(graphRelationIds, publicationGenerationId),
                indexProjections: componentReferences(
                  candidateProjectionIds,
                  publicationGenerationId,
                ),
                knowledgePaths: componentReferences(knowledgePathIds, publicationGenerationId),
                multimodalManifests: componentReferences(
                  [persistedManifest.id],
                  publicationGenerationId,
                ),
                schemaVersion: 1,
              },
              documentAssetId: activeAsset.id,
              documentVersion: activeAsset.version,
              knowledgeSpaceId: input.knowledgeSpaceId,
              publicationGenerationId,
              tenantId: input.tenantId,
            });
          }
          await assertWritable();
          let advanced = await jobs.advance(input.documentCompilationJobId, "projection_built");

          if (publicationGenerationId) {
            // The durable publication processor owns candidate-only evaluation and the head CAS.
            // Returning here prevents this shadow build from being mistaken for published work.
            return advanced;
          }

          if (smokeEvaluation) {
            const result = await smokeEvaluation.evaluate({
              knowledgeSpaceId: input.knowledgeSpaceId,
            });

            if (result.decision === "failed") {
              throw new Error(
                `Document compilation smoke evaluation failed: ${result.rejectedReason}`,
              );
            }

            await assertWritable();
            advanced = await jobs.advance(input.documentCompilationJobId, "smoke_eval_passed");
          } else {
            await assertWritable();
            advanced = await jobs.advance(input.documentCompilationJobId, "smoke_eval_passed");
          }

          if (legacyStagedProjectionPublication && stagedProjectionIds.length > 0) {
            await assertWritable();
            const published = await legacyStagedProjectionPublication.publish({
              knowledgeSpaceId: input.knowledgeSpaceId,
              projectionIds: stagedProjectionIds,
            });

            if (published !== stagedProjectionIds.length) {
              throw new Error(
                `Document compilation published ${published} of ${stagedProjectionIds.length} staged projections`,
              );
            }
          }

          await assertWritable();
          await assets.updateParserStatus({
            id: activeAsset.id,
            knowledgeSpaceId: activeAsset.knowledgeSpaceId,
            parserStatus: "parsed",
          });

          await assertWritable();
          return jobs.advance(advanced.id, "published");
        };

        return await (operationLeases
          ? operationLeases.withLease(
              {
                knowledgeSpaceId: input.knowledgeSpaceId,
                leaseType: "publish",
                metadata: { documentCompilationJobId: input.documentCompilationJobId },
                targetId: activeAsset.id,
                targetType: "document-asset",
                targetVersion: activeAsset.version,
                tenantId: input.tenantId,
                virtualPath: documentAssetVirtualPath(activeAsset.id),
              },
              compile,
            )
          : compile());
      } catch (error) {
        let effectiveError = error;
        if (!isDeletionWriteBlocked(effectiveError)) {
          try {
            await assertWritable();
          } catch (fenceError) {
            if (isDeletionWriteBlocked(fenceError)) {
              effectiveError = fenceError;
            } else {
              throw fenceError;
            }
          }
        }
        if (isDeletionWriteBlocked(effectiveError)) {
          await cleanupStaleObjectWrites();
          throw effectiveError;
        }
        if (legacyStagedProjectionPublication && stagedProjectionIds.length > 0) {
          await legacyStagedProjectionPublication
            .fail({
              knowledgeSpaceId: input.knowledgeSpaceId,
              projectionIds: stagedProjectionIds,
            })
            .catch(() => undefined);
        }
        logDocumentUploadDiagnostic({
          ...(asset ? { asset } : {}),
          error: effectiveError,
          knowledgeSpaceId: input.knowledgeSpaceId,
          stage: "compilation",
        });
        if (failureManagement === "worker") {
          await assets
            .updateParserStatus({
              id: input.documentAssetId,
              knowledgeSpaceId: input.knowledgeSpaceId,
              parserStatus: "failed",
            })
            .catch(() => undefined);
          await jobs
            .fail(input.documentCompilationJobId, errorMessage(effectiveError))
            .catch(() => undefined);
        }
        throw effectiveError;
      }
    },
  };
}

function isDeletionWriteBlocked(error: unknown): boolean {
  return (
    error instanceof DeletionLifecycleFenceActiveError ||
    error instanceof DeletionObjectWriteAdmissionError
  );
}

/**
 * Multimodal object writes are external to the database transaction that owns compilation state.
 * Fence every individual put and remember only keys that did not exist before this execution. If
 * deletion wins after its inventory scan, the post-put fence (or the worker's next fence) removes
 * those late keys without deleting a pre-existing object that a retained document may reference.
 */
function createDeletionFencedCompilationObjectStorage({
  assertWritable,
  objectWriteAdmission,
  objectStorage,
  onCleanupReady,
  scope,
}: {
  readonly assertWritable: () => Promise<void>;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly onCleanupReady: (cleanup: () => Promise<void>) => void;
  readonly scope: { readonly knowledgeSpaceId: string; readonly tenantId: string };
}): PlatformAdapter["objectStorage"] {
  const createdKeys = new Set<string>();
  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const key of [...createdKeys]) {
      const keyFailures: unknown[] = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await objectStorage.deleteObject(key);
          createdKeys.delete(key);
          break;
        } catch (error) {
          keyFailures.push(error);
        }
      }
      if (createdKeys.has(key)) {
        failures.push(
          new AggregateError(keyFailures, `Failed to compensate late object write key=${key}`),
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Document compilation could not compensate ${failures.length} late object write(s)`,
      );
    }
  };
  onCleanupReady(cleanup);

  return {
    ...(objectStorage.close
      ? {
          close: () => objectStorage.close?.() ?? Promise.resolve(),
        }
      : {}),
    deleteObject: (key) => objectStorage.deleteObject(key),
    getObject: (key) => objectStorage.getObject(key),
    getObjectStream: (key) => objectStorage.getObjectStream(key),
    headObject: (key) => objectStorage.headObject(key),
    health: () => objectStorage.health(),
    kind: objectStorage.kind,
    listObjects: (input) => objectStorage.listObjects(input),
    putObject: async (input) => {
      await assertWritable();
      const existedBefore = (await objectStorage.headObject(input.key)) !== null;
      await assertWritable();
      const stored = await withDeletionObjectWriteAdmission(objectWriteAdmission, scope, () =>
        objectStorage.putObject(input),
      );
      if (!existedBefore) createdKeys.add(input.key);
      try {
        await assertWritable();
      } catch (error) {
        if (!existedBefore) {
          try {
            await objectStorage.deleteObject(input.key);
            createdKeys.delete(input.key);
          } catch {
            // The outer worker catch retries cleanup and surfaces a hard failure if it still fails.
          }
        }
        throw error;
      }
      return stored;
    },
  };
}

function componentReferences(
  componentKeys: readonly string[],
  generationId: string,
): DocumentCompilationCandidateComponentReceipt["indexProjections"] {
  return componentKeys.map((componentKey) => ({ componentKey, generationId }));
}

function documentAssetVirtualPath(documentAssetId: string): string {
  return `/sources/documents/${documentAssetId}`;
}

export function createIngestionSmokeEvaluationGate({
  evaluation,
  limit,
  thresholds,
  topK,
}: IngestionSmokeEvaluationGateOptions): IngestionSmokeEvaluationGate {
  validateIngestionSmokeEvaluationGateOptions({ limit, thresholds, topK });

  return {
    evaluate: async ({ knowledgeSpaceId }) => {
      if (!knowledgeSpaceId.trim()) {
        throw new Error("Ingestion smoke evaluation knowledgeSpaceId is required");
      }

      const report = await evaluation.run({ knowledgeSpaceId, limit, topK });
      const rejectedReason = retrievalEvaluationRejectionReason(report.metrics, thresholds);

      if (rejectedReason) {
        return {
          decision: "failed",
          evaluation: cloneRetrievalEvaluationReport(report),
          rejectedReason,
        };
      }

      return {
        decision: "passed",
        evaluation: cloneRetrievalEvaluationReport(report),
      };
    },
  };
}

function validateIngestionSmokeEvaluationGateOptions({
  limit,
  thresholds,
  topK,
}: Pick<IngestionSmokeEvaluationGateOptions, "limit" | "thresholds" | "topK">): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Ingestion smoke evaluation limit must be at least 1");
  }

  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("Ingestion smoke evaluation topK must be at least 1");
  }

  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Ingestion smoke evaluation threshold ${name} must be between 0 and 1`);
    }
  }
}

function retrievalEvaluationRejectionReason(
  metrics: {
    readonly citationHitRate: number;
    readonly noAnswerRate: number;
    readonly recallAtK: number;
  },
  thresholds: IngestionSmokeEvaluationThresholds,
): string | null {
  const reasons: string[] = [];

  if (metrics.recallAtK < thresholds.minRecallAtK) {
    reasons.push(`recallAtK ${metrics.recallAtK} < ${thresholds.minRecallAtK}`);
  }

  if (metrics.citationHitRate < thresholds.minCitationHitRate) {
    reasons.push(`citationHitRate ${metrics.citationHitRate} < ${thresholds.minCitationHitRate}`);
  }

  if (metrics.noAnswerRate > thresholds.maxNoAnswerRate) {
    reasons.push(`noAnswerRate ${metrics.noAnswerRate} > ${thresholds.maxNoAnswerRate}`);
  }

  return reasons.length > 0 ? reasons.join("; ") : null;
}

function stringArrayMetadata(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Document compilation failed";
}
