import { z } from "@hono/zod-openapi";
import type { ChunkConfig } from "@knowledge/compute";
import {
  type DocumentAsset,
  type DocumentMultimodalManifest,
  type DocumentOutline,
  type JobPayload,
  type KnowledgePath,
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceRetrievalProfile,
  type ParseArtifact,
  type PlatformAdapter,
  PublicationGenerationIdSchema,
  TenantIdSchema,
} from "@knowledge/core";
import type { ParserAdapter, ParserRouteHints } from "@knowledge/parsers";

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
import type { DocumentModelBudget } from "./document-model-budget";
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
import type { JointSemanticGraphMaterializer } from "./document-semantic-enrichment-processor";
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
  readonly assertDocumentAvailable?:
    | ((input: {
        readonly documentAssetId: string;
        readonly documentAssetVersion: number;
        readonly knowledgeSpaceId: string;
        readonly tenantId: string;
      }) => Promise<void>)
    | undefined;
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
  readonly jointSemanticGraph?: JointSemanticGraphMaterializer | undefined;
  readonly knowledgePaths?: KnowledgePathRepository | undefined;
  readonly multimodalImageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly multimodalLocalAssetAllowlist?: readonly string[] | undefined;
  readonly multimodalMaxExtractedAssets?: number | undefined;
  readonly multimodalMaxLocalAssetBytes?: number | undefined;
  readonly multimodalMaxPdfRasterizedAssets?: number | undefined;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly modelBudget?: DocumentModelBudget | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly parser: ParserAdapter;
  readonly pdfRasterizer?: DocumentPdfRasterizer | undefined;
  readonly reindexer: IncrementalReindexer;
  /** Persists optional graph work before the searchable candidate is published. */
  readonly semanticEnrichmentAdmission?: DocumentSemanticEnrichmentAdmission | undefined;
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
  process(
    payload: JobPayload,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<DocumentCompilationJob>;
}

export interface DocumentSemanticEnrichmentAdmission {
  enqueue(input: {
    readonly compilationAttemptId: string;
    readonly documentAssetId: string;
    readonly documentVersion: number;
    readonly knowledgeSpaceId: string;
    readonly parseArtifactId: string;
    readonly publicationGenerationId: string;
    readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
    readonly tenantId: string;
  }): Promise<void>;
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
  assertDocumentAvailable,
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
  jointSemanticGraph,
  knowledgePaths,
  multimodalImageVariantGenerator,
  multimodalLocalAssetAllowlist,
  multimodalMaxExtractedAssets,
  multimodalMaxLocalAssetBytes,
  multimodalMaxPdfRasterizedAssets,
  multimodalManifests,
  modelBudget,
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
  semanticEnrichmentAdmission,
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
    process: async (payload, processOptions) => {
      const input = DocumentCompilationPayloadSchema.parse(payload);
      const signal = processOptions?.signal;
      const publicationGenerationId = input.publicationGenerationId;
      const legacyStagedProjectionPublication = publicationGenerationId
        ? null
        : stagedProjectionPublication;

      let asset: Awaited<ReturnType<DocumentAssetRepository["get"]>> | null | undefined;
      let stagedProjectionIds: readonly string[] = [];
      let assertWritable = async (): Promise<void> => {
        signal?.throwIfAborted();
      };
      let cleanupStaleObjectWrites = async (): Promise<void> => undefined;

      try {
        await assertDocumentAvailable?.({
          documentAssetId: input.documentAssetId,
          documentAssetVersion: input.version,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        });
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
          signal?.throwIfAborted();
          if (deletionToken) {
            await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
          }
          signal?.throwIfAborted();
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
          const initialJob = await jobs.get(input.documentCompilationJobId);
          if (!initialJob) {
            throw new Error("Document compilation job not found");
          }
          const resumeParsedGeneration =
            publicationGenerationId !== undefined &&
            hasReachedCompilationStage(initialJob.stage, "parsed");
          const resumeOutlineGeneration =
            publicationGenerationId !== undefined &&
            hasReachedCompilationStage(initialJob.stage, "outline_built");
          let canonicalArtifact: ParseArtifact;
          if (resumeParsedGeneration) {
            if (!reindexer.getCanonicalArtifact) {
              throw new Error(
                `Document compilation checkpoint=${initialJob.stage} cannot load its parse artifact`,
              );
            }
            const persistedArtifact = await reindexer.getCanonicalArtifact({
              documentAssetId: activeAsset.id,
              version: activeAsset.version,
            });
            if (!persistedArtifact) {
              throw new Error(
                `Document compilation checkpoint=${initialJob.stage} parse artifact is missing`,
              );
            }
            canonicalArtifact = persistedArtifact;
          } else {
            const body = await objectStorage.getObject(activeAsset.objectKey);

            if (!body) {
              throw new Error("Document compilation object not found");
            }

            const parsedArtifact = await parser.parse({
              body,
              documentAssetId: activeAsset.id,
              filename: activeAsset.filename,
              mimeType: activeAsset.mimeType,
              parserHints: documentParserHints({
                assetMetadata: activeAsset.metadata,
                requiresImages: Boolean(
                  visualEmbeddingModel || multimodalImageVariantGenerator || pdfRasterizer,
                ),
              }),
              ...(signal ? { signal } : {}),
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
            canonicalArtifact = reindexer.canonicalizeArtifact
              ? await reindexer.canonicalizeArtifact(artifact)
              : artifact;
          }
          const documentIndexOverrides = indexOverrides
            ? await indexOverrides.resolve({
                compilationAttemptId: input.documentCompilationJobId,
                documentAssetId: activeAsset.id,
                documentAssetVersion: activeAsset.version,
                knowledgeSpaceId: input.knowledgeSpaceId,
                tenantId: input.tenantId,
              })
            : {};
          let documentOutlineIds: readonly string[] = [];
          let knowledgePathIds: readonly string[] = [];
          let persistedManifest: DocumentMultimodalManifest;
          const deferOutlineUntilSemanticNodes = Boolean(
            publicationGenerationId && frozenRetrievalProfile,
          );
          if (resumeOutlineGeneration && publicationGenerationId) {
            const [persistedOutline, resumedManifest] = await Promise.all([
              outlines?.getByDocumentVersion({
                documentAssetId: activeAsset.id,
                publicationGenerationId,
                version: activeAsset.version,
              }),
              multimodalManifests.getByDocumentVersion({
                documentAssetId: activeAsset.id,
                publicationGenerationId,
                version: activeAsset.version,
              }),
            ]);
            if (!persistedOutline || !resumedManifest) {
              throw new Error(
                `Document compilation checkpoint=${initialJob.stage} derived components are missing`,
              );
            }
            assertResumableCompilationComponents({
              artifact: canonicalArtifact,
              asset: activeAsset,
              manifest: resumedManifest,
              outline: persistedOutline,
              publicationGenerationId,
            });
            persistedManifest = resumedManifest;
            documentOutlineIds = [persistedOutline.id];
            knowledgePathIds = buildCompilationKnowledgePaths({
              asset: activeAsset,
              generateId: () => publicationGenerationId,
              manifest: persistedManifest,
              outline: persistedOutline,
              publicationGenerationId,
              tenantId: input.tenantId,
            }).map((path) => path.id);
          } else {
            await assertWritable();
            await jobs.advance(input.documentCompilationJobId, "parsed");
            const multimodalManifest = createDocumentMultimodalManifestBuilder().build({
              artifact: canonicalArtifact,
              knowledgeSpaceId: input.knowledgeSpaceId,
              ...(publicationGenerationId ? { publicationGenerationId } : {}),
            });
            if (outlineBuilder && outlines && !deferOutlineUntilSemanticNodes) {
              const deterministicOutline = outlineBuilder.build({
                knowledgeSpaceId: input.knowledgeSpaceId,
                parseArtifact: canonicalArtifact,
                ...(publicationGenerationId ? { publicationGenerationId } : {}),
              });
              const outline =
                documentIndexOverrides.enablePageIndex !== false && outlineSummaryEnhancer
                  ? await outlineSummaryEnhancer.enhance({
                      ...(modelBudget ? { modelBudget } : {}),
                      outline: deterministicOutline,
                      parseArtifact: canonicalArtifact,
                      ...(frozenRetrievalProfile
                        ? { retrievalProfile: frozenRetrievalProfile }
                        : {}),
                      ...(signal ? { signal } : {}),
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
                const persistedPaths = await knowledgePaths.upsertMany(
                  buildCompilationKnowledgePaths({
                    asset: activeAsset,
                    generateId: generateKnowledgePathId,
                    manifest: multimodalManifest,
                    outline: persistedOutline,
                    ...(publicationGenerationId ? { publicationGenerationId } : {}),
                    tenantId: input.tenantId,
                  }),
                );
                knowledgePathIds = persistedPaths.map((path) => path.id);
              }
            }
            await assertWritable();
            persistedManifest = await multimodalManifests.upsert(multimodalManifest);
            if (!deferOutlineUntilSemanticNodes) {
              await assertWritable();
              await jobs.advance(input.documentCompilationJobId, "outline_built");
            }
          }

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
            enableGraph: documentIndexOverrides.enableGraph !== false,
            enablePageIndex: documentIndexOverrides.enablePageIndex !== false,
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(modelBudget ? { modelBudget } : {}),
            ...(documentIndexOverrides.language
              ? { language: documentIndexOverrides.language }
              : {}),
            parseArtifact: canonicalArtifact,
            permissionScope: stringArrayMetadata(activeAsset.metadata.permissionScope),
            projectionStatus:
              publicationGenerationId || legacyStagedProjectionPublication ? "building" : "ready",
            projectionVersion: input.version,
            ...(publicationGenerationId ? { publicationGenerationId } : {}),
            ...(frozenRetrievalProfile ? { retrievalProfile: frozenRetrievalProfile } : {}),
            ...(initialJob.stage !== "queued" ? { resetFailedProjections: true } : {}),
            ...(signal ? { signal } : {}),
            ...(frozenRetrievalProfile && !resolvedEmbedding ? { skipDense: true as const } : {}),
            tenantId: input.tenantId,
            ...(visualEmbeddingModel ? { visualModel: visualEmbeddingModel } : {}),
          });
          if (
            deferOutlineUntilSemanticNodes &&
            !resumeOutlineGeneration &&
            publicationGenerationId
          ) {
            if (
              reindexResult.status !== "rebuilt" ||
              !reindexResult.outlineArtifact ||
              !outlineBuilder ||
              !outlines
            ) {
              throw new Error(
                "Generation-scoped semantic compilation requires a semantic outline artifact",
              );
            }
            const deterministicOutline = outlineBuilder.build({
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifact: reindexResult.outlineArtifact,
              publicationGenerationId,
            });
            const outline =
              documentIndexOverrides.enablePageIndex !== false && outlineSummaryEnhancer
                ? await outlineSummaryEnhancer.enhance({
                    ...(modelBudget ? { modelBudget } : {}),
                    outline: deterministicOutline,
                    parseArtifact: reindexResult.outlineArtifact,
                    retrievalProfile: frozenRetrievalProfile,
                    ...(signal ? { signal } : {}),
                    tenantId: input.tenantId,
                  })
                : deterministicOutline;
            await assertWritable();
            const persistedOutline = await outlines.upsert(outline);
            if (documentIndexOverrides.enablePageIndex !== false) {
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
              const persistedPaths = await knowledgePaths.upsertMany(
                buildCompilationKnowledgePaths({
                  asset: activeAsset,
                  generateId: generateKnowledgePathId,
                  manifest: persistedManifest,
                  outline: persistedOutline,
                  publicationGenerationId,
                  tenantId: input.tenantId,
                }),
              );
              knowledgePathIds = persistedPaths.map((path) => path.id);
            }
            await assertWritable();
            await jobs.advance(input.documentCompilationJobId, "outline_built");
          }
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
            jointSemanticGraph &&
            publicationGenerationId &&
            frozenRetrievalProfile &&
            reindexResult.status === "rebuilt" &&
            documentIndexOverrides.enableGraph !== false
          ) {
            await assertWritable();
            const semanticResult = await jointSemanticGraph.materialize({
              createdAt: activeAsset.updatedAt ?? activeAsset.createdAt,
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifactId: canonicalArtifact.id,
              publicationGenerationId,
              retrievalProfile: frozenRetrievalProfile,
            });
            await assertWritable();
            graphEntityIds = semanticResult.graphEntityIds;
            graphRelationIds = semanticResult.graphRelationIds;
          }
          if (
            semanticEnrichmentAdmission &&
            !jointSemanticGraph &&
            publicationGenerationId &&
            frozenRetrievalProfile &&
            reindexResult.status === "rebuilt" &&
            documentIndexOverrides.enableGraph !== false
          ) {
            await semanticEnrichmentAdmission.enqueue({
              compilationAttemptId: input.documentCompilationJobId,
              documentAssetId: activeAsset.id,
              documentVersion: activeAsset.version,
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifactId: canonicalArtifact.id,
              publicationGenerationId,
              retrievalProfile: frozenRetrievalProfile,
              tenantId: input.tenantId,
            });
          }
          if (
            semanticPostProcessor &&
            !publicationGenerationId &&
            reindexResult.status === "rebuilt" &&
            documentIndexOverrides.enableGraph !== false
          ) {
            await assertWritable();
            const postprocess = semanticPostProcessor.process({
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifact: canonicalArtifact,
              ...(publicationGenerationId ? { publicationGenerationId } : {}),
              ...(frozenRetrievalProfile ? { retrievalProfile: frozenRetrievalProfile } : {}),
              tenantId: input.tenantId,
            });
            const semanticResult = await postprocess.catch(() => undefined);
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

function documentParserHints(input: {
  readonly assetMetadata: Readonly<Record<string, unknown>>;
  readonly requiresImages: boolean;
}): ParserRouteHints {
  const language =
    typeof input.assetMetadata.language === "string" && input.assetMetadata.language.trim()
      ? input.assetMetadata.language.trim()
      : undefined;
  const layoutComplexity =
    input.assetMetadata.layoutComplexity === "complex" ||
    input.assetMetadata.layoutComplexity === "simple"
      ? input.assetMetadata.layoutComplexity
      : undefined;
  return {
    ...(language ? { language } : {}),
    ...(layoutComplexity ? { layoutComplexity } : {}),
    requiresImages: input.requiresImages,
    ...(input.assetMetadata.requiresOcr === true ? { requiresOcr: true } : {}),
    ...(input.assetMetadata.requiresTables === true ? { requiresTables: true } : {}),
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

const resumableCompilationStages: readonly DocumentCompilationJob["stage"][] = [
  "queued",
  "parsed",
  "outline_built",
  "nodes_generated",
  "projection_built",
  "smoke_eval_passed",
  "published",
];

function hasReachedCompilationStage(
  current: DocumentCompilationJob["stage"],
  expected: DocumentCompilationJob["stage"],
): boolean {
  const currentIndex = resumableCompilationStages.indexOf(current);
  const expectedIndex = resumableCompilationStages.indexOf(expected);

  return currentIndex >= expectedIndex && expectedIndex >= 0;
}

function assertResumableCompilationComponents({
  artifact,
  asset,
  manifest,
  outline,
  publicationGenerationId,
}: {
  readonly artifact: ParseArtifact;
  readonly asset: DocumentAsset;
  readonly manifest: DocumentMultimodalManifest;
  readonly outline: DocumentOutline;
  readonly publicationGenerationId: string;
}): void {
  const hasArtifactLineage =
    artifact.documentAssetId === asset.id &&
    artifact.version === asset.version &&
    outline.documentAssetId === asset.id &&
    outline.knowledgeSpaceId === asset.knowledgeSpaceId &&
    outline.version === asset.version &&
    outline.parseArtifactId === artifact.id &&
    outline.artifactHash === artifact.artifactHash &&
    outline.publicationGenerationId === publicationGenerationId &&
    manifest.documentAssetId === asset.id &&
    manifest.knowledgeSpaceId === asset.knowledgeSpaceId &&
    manifest.version === asset.version &&
    manifest.parseArtifactId === artifact.id &&
    manifest.artifactHash === artifact.artifactHash &&
    manifest.publicationGenerationId === publicationGenerationId;
  if (!hasArtifactLineage) {
    throw new Error("Document compilation checkpoint derived component lineage is invalid");
  }
}

function buildCompilationKnowledgePaths({
  asset,
  generateId,
  manifest,
  outline,
  publicationGenerationId,
  tenantId,
}: {
  readonly asset: DocumentAsset;
  readonly generateId: () => string;
  readonly manifest: DocumentMultimodalManifest;
  readonly outline: DocumentOutline;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
}): KnowledgePath[] {
  return [
    ...(publicationGenerationId
      ? [
          buildDocumentKnowledgePath({
            asset,
            id: generateId(),
            publicationGenerationId,
            tenantId,
          }),
        ]
      : []),
    buildDocumentMultimodalManifestKnowledgePath({
      asset,
      id: generateId(),
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      tenantId,
    }),
    ...buildDocumentMultimodalAssetKnowledgePaths({
      asset,
      generateId,
      manifest,
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      tenantId,
    }),
    ...buildDocumentMultimodalResourceKnowledgePaths({
      asset,
      generateId,
      manifest,
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      tenantId,
    }),
    buildDocumentOutlineKnowledgePath({
      asset,
      id: generateId(),
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      tenantId,
    }),
    ...buildDocumentSectionKnowledgePaths({
      asset,
      generateId,
      outline,
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      tenantId,
    }),
  ];
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
