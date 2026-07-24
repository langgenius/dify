import type { OpenAPIHono } from "@hono/zod-openapi";
import type { DocumentAsset, KnowledgeSpace, PlatformAdapter } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";
import type { Context, Next } from "hono";

import { uniqueStrings } from "./api-shared-utils";
import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import type { BulkOperationItem, BulkOperationRepository } from "./bulk-operation";
import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
  CandidateVisibilityScanBudgetExceededError,
  candidatePermissionAllowsAsset,
  candidatePermissionScopeSnapshot,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
  type DeletionLifecycleFenceToken,
} from "./deletion-lifecycle-fence";
import {
  type DeletionObjectWriteAdmission,
  DeletionObjectWriteAdmissionError,
} from "./deletion-object-write-admission";
import { createDeletionAdmittedObjectStorage } from "./deletion-object-write-storage";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import {
  DocumentAssetCapacityExceededError,
  type DocumentAssetRepository,
} from "./document-asset-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import { compileDocumentArtifact } from "./document-compilation-pipeline";
import type { DocumentImageVariantGenerator } from "./document-image-variant-generator";
import { buildDocumentKnowledgePath } from "./document-knowledge-paths";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineBuilder } from "./document-outline-builder";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import type { DocumentPdfRasterizer } from "./document-pdf-rasterizer";
import { listReadableDocumentAssets } from "./document-read-handlers";
import { logDocumentUploadDiagnostic } from "./document-upload-diagnostics";
import {
  BulkDocumentUploadTooLargeError,
  BulkDocumentUploadValidationError,
  type DocumentUploadExclusionReason,
  DocumentUploadTooLargeError,
  DocumentUploadValidationError,
  createDocumentAssetStatusUrl,
  createLogicalDocumentTaskStatusUrl,
  readBulkDocumentUploadWithAdmission,
  readDocumentUpload,
  sha256Hex,
} from "./document-upload-utils";
import {
  bulkReindexDocumentsRoute,
  bulkUploadDocumentsRoute,
  uploadDocumentRoute,
} from "./document-write-routes";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { IncrementalReindexer } from "./index-reindexer";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceEmbeddingResolver } from "./knowledge-space-embedding-resolver";
import {
  type KnowledgeSpaceManifestRepository,
  ensureKnowledgeSpaceManifest,
} from "./knowledge-space-manifest-repository";
import {
  type KnowledgeSpaceQuotaAdmissionDelta,
  KnowledgeSpaceQuotaExceededError,
  KnowledgeSpaceQuotaUsageTruncatedError,
  enforceKnowledgeSpaceQuotaAdmission,
} from "./knowledge-space-quota-admission";
import type { KnowledgeSpaceQuotaUsageReader } from "./knowledge-space-quota-usage";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  KnowledgeSpaceDocumentMutationDeletionActiveError,
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAdmissionError,
  type LegacySpacePublicationBootstrapRepository,
  LegacySpacePublicationBootstrapSnapshotConflictError,
  withKnowledgeSpaceDocumentMutationLease,
} from "./legacy-space-publication-bootstrap";
import type { DocumentRevision, LogicalDocumentRepository } from "./logical-document-repository";
import {
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  LogicalDocumentValidationError,
} from "./logical-document-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import type { SemanticIngestionPostProcessor } from "./semantic-ingestion-postprocessor";
import type { SourceDocumentStaleWriteScrubber } from "./source-document-stale-write-scrubber";
import type { StagedCommitRepository } from "./staged-commit-repository";
import { createDocumentObjectKey } from "./storage-path-utils";
import {
  StorageQuotaExceededError,
  type StorageQuotaRepository,
  enforceStorageQuota,
} from "./storage-quota";
import { traceAsync } from "./trace-async";
import type { TraceRecorder } from "./tracing";

export interface RegisterDocumentWriteHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly adapter: PlatformAdapter;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly artifacts: ParseArtifactRepository;
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly bulkOperationRepository: BulkOperationRepository;
  readonly documentCompilationJobs: DocumentCompilationJobStateMachine | undefined;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly documentMutationAdmissionGuard?:
    | Pick<
        LegacySpacePublicationBootstrapRepository,
        | "acquireDocumentMutationLease"
        | "assertDocumentMutationAdmission"
        | "heartbeatDocumentMutationLease"
        | "releaseDocumentMutationLease"
      >
    | undefined;
  readonly denseEmbeddingModel?: string | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly documentMultimodalImageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly documentMultimodalLocalAssetAllowlist?: readonly string[] | undefined;
  readonly documentMultimodalMaxExtractedAssets?: number | undefined;
  readonly documentMultimodalMaxLocalAssetBytes?: number | undefined;
  readonly documentMultimodalMaxPdfRasterizedAssets?: number | undefined;
  readonly documentMultimodalManifests: DocumentMultimodalManifestRepository;
  readonly documentParser: ParserAdapter;
  readonly documentPdfRasterizer?: DocumentPdfRasterizer | undefined;
  readonly effectiveMaxBulkUploadBytes: number;
  readonly generateArtifactSegmentId: () => string;
  readonly generateBulkUploadId: () => string;
  readonly generateDocumentAssetId: () => string;
  readonly generateKnowledgePathId: () => string;
  readonly generateKnowledgeSpaceManifestId: () => string;
  readonly indexProjections: IndexProjectionRepository;
  readonly knowledgePaths: KnowledgePathRepository;
  readonly knowledgeSpaceManifests: KnowledgeSpaceManifestRepository;
  readonly knowledgeSpaceQuotaUsageReader: KnowledgeSpaceQuotaUsageReader;
  readonly logicalDocuments?: LogicalDocumentRepository | undefined;
  readonly maxBulkReindexDocuments: number;
  readonly maxBulkUploadFiles: number;
  readonly maxUploadBytes: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now: () => string;
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly outlineBuilder: DocumentOutlineBuilder;
  readonly outlineSummaryEnhancer?: DocumentOutlineSummaryEnhancer | undefined;
  readonly outlines: DocumentOutlineRepository;
  readonly semanticPostProcessor?: SemanticIngestionPostProcessor | undefined;
  readonly staleWriteScrubber?: SourceDocumentStaleWriteScrubber | undefined;
  readonly spaces: KnowledgeSpaceRepository;
  readonly stagedCommits: StagedCommitRepository;
  readonly storageQuotaRepository: StorageQuotaRepository;
  readonly synchronousUploadReindexer: IncrementalReindexer | null;
  readonly synchronousUploadDenseModel?: string | undefined;
  readonly traces: TraceRecorder;
  readonly visualEmbeddingModel?: string | undefined;
}

interface BulkUploadAcceptedItem {
  readonly asset: DocumentAsset;
  readonly assetStatusUrl: string;
  readonly compilationJob: {
    readonly id: string;
    readonly stage: "queued";
  };
  readonly logicalDocument: {
    readonly id: string;
    readonly revision: number;
  };
  readonly logicalDocumentId: string;
  readonly documentRevision: number;
  readonly status: "accepted";
  readonly statusUrl: string;
}

export function registerDocumentWriteHandlers({
  access,
  adapter,
  app,
  artifacts,
  artifactSegments,
  assets,
  authorization,
  bulkOperationRepository,
  documentCompilationJobs,
  deletionFence,
  documentMutationAdmissionGuard,
  denseEmbeddingModel,
  embeddingResolver,
  documentMultimodalImageVariantGenerator,
  documentMultimodalLocalAssetAllowlist,
  documentMultimodalMaxExtractedAssets,
  documentMultimodalMaxLocalAssetBytes,
  documentMultimodalMaxPdfRasterizedAssets,
  documentMultimodalManifests,
  documentParser,
  documentPdfRasterizer,
  effectiveMaxBulkUploadBytes,
  generateArtifactSegmentId,
  generateBulkUploadId,
  generateDocumentAssetId,
  generateKnowledgePathId,
  generateKnowledgeSpaceManifestId,
  indexProjections,
  knowledgePaths,
  knowledgeSpaceManifests,
  knowledgeSpaceQuotaUsageReader,
  logicalDocuments,
  maxBulkReindexDocuments,
  maxBulkUploadFiles,
  maxUploadBytes,
  nodes,
  now,
  objectWriteAdmission,
  operationLeases,
  outlineBuilder,
  outlineSummaryEnhancer,
  outlines,
  semanticPostProcessor,
  staleWriteScrubber,
  spaces,
  stagedCommits,
  storageQuotaRepository,
  synchronousUploadReindexer,
  synchronousUploadDenseModel,
  traces,
  visualEmbeddingModel,
}: RegisterDocumentWriteHandlersOptions): void {
  registerDocumentMutationLeaseMiddleware({
    app,
    guard: documentMutationAdmissionGuard,
    now,
  });

  app.openapi(bulkReindexDocumentsRoute, async (context) => {
    const subject = context.get("subject");
    const traceId = context.get("traceId");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await traceAsync(traces, traceId, "ingestion.bulk_reindex_space_lookup", () =>
      spaces.get({
        id: knowledgeSpaceId,
        tenantId: subject.tenantId,
      }),
    );

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      await documentMutationAdmissionGuard?.assertDocumentMutationAdmission({
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      if (error instanceof LegacySpacePublicationBootstrapAdmissionError) {
        return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
      }
      throw error;
    }

    if (!documentCompilationJobs) {
      return context.json({ error: "Document compilation jobs are not configured" }, 503);
    }

    const body = context.req.valid("json");
    let selectedAssets: Awaited<ReturnType<typeof listReadableDocumentAssets>> | undefined;
    try {
      selectedAssets = body.all
        ? await traceAsync(traces, traceId, "ingestion.bulk_reindex_asset_list", () =>
            listReadableDocumentAssets({
              candidateGrants,
              knowledgeSpaceId,
              limit: maxBulkReindexDocuments,
              repository: assets,
            }),
          )
        : undefined;
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      throw error;
    }
    const requestedDocumentIds = body.documentIds ? uniqueStrings(body.documentIds) : undefined;

    if (requestedDocumentIds && requestedDocumentIds.length > maxBulkReindexDocuments) {
      return context.json(
        {
          error: `Bulk document reindex maxBulkReindexDocuments=${maxBulkReindexDocuments} exceeded`,
        },
        400,
      );
    }

    if (selectedAssets?.nextCursor) {
      return context.json(
        {
          error: `Bulk document reindex maxBulkReindexDocuments=${maxBulkReindexDocuments} exceeded`,
        },
        400,
      );
    }

    try {
      await traceAsync(traces, traceId, "ingestion.bulk_reindex_manifest_quota_check", () =>
        enforceManifestQuotaAdmission({
          delta: {},
          generateKnowledgeSpaceManifestId,
          knowledgeSpaceId,
          knowledgeSpaceManifests,
          knowledgeSpaceQuotaUsageReader,
          now,
          space,
        }),
      );
    } catch (error) {
      if (isKnowledgeSpaceQuotaAdmissionError(error)) {
        return context.json({ error: error.message }, 413);
      }

      throw error;
    }

    const capabilityGrant = context.get("capabilityV2Grant");
    const permissionSnapshot = capabilityGrant
      ? undefined
      : await issueDocumentOperationPermission({
          access,
          authorization,
          context,
          knowledgeSpaceId,
        });
    if (!capabilityGrant && !permissionSnapshot) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const bulkJobId = generateBulkUploadId();
    const items = [];
    const bulkItems: BulkOperationItem[] = [];
    const enqueueAsset = async (asset: DocumentAsset) => {
      const compilationJob = await traceAsync(
        traces,
        traceId,
        "ingestion.bulk_reindex_job_start",
        () =>
          documentCompilationJobs.start({
            ...(capabilityGrant ? { capabilityGrantId: capabilityGrant.grantId } : {}),
            documentAssetId: asset.id,
            knowledgeSpaceId,
            ...(permissionSnapshot
              ? { permissionSnapshot, requestedBySubjectId: subject.subjectId }
              : {}),
            tenantId: subject.tenantId,
            version: asset.version,
          }),
      );
      bulkItems.push({
        compilationJobId: compilationJob.id,
        documentId: asset.id,
        requiredPermissionScope: requiredPermissionScopeForAsset(asset),
        status: "queued",
      });

      return {
        asset,
        compilationJob: {
          id: compilationJob.id,
          stage: "queued" as const,
        },
        status: "queued" as const,
        statusUrl: createDocumentAssetStatusUrl({ documentAssetId: asset.id, knowledgeSpaceId }),
      };
    };

    for (const documentId of requestedDocumentIds ?? []) {
      const asset = await traceAsync(traces, traceId, "ingestion.bulk_reindex_asset_lookup", () =>
        assets.get({
          id: documentId,
          knowledgeSpaceId,
        }),
      );

      if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
        items.push({
          documentId,
          status: "not_found" as const,
        });
        bulkItems.push({
          documentId,
          status: "not_found",
        });
        continue;
      }

      items.push(await enqueueAsset(asset));
    }

    for (const asset of selectedAssets?.items ?? []) {
      items.push(await enqueueAsset(asset));
    }

    await bulkOperationRepository.create({
      ...(capabilityGrant ? { capabilityGrantId: capabilityGrant.grantId } : {}),
      id: bulkJobId,
      items: bulkItems,
      knowledgeSpaceId,
      ...(permissionSnapshot ? { permissionSnapshot } : {}),
      requestedBySubjectId: subject.subjectId,
      tenantId: subject.tenantId,
      type: "document_reindex",
    });

    return context.json(
      {
        bulkJobId,
        items,
        total: items.length,
      },
      202,
    );
  });

  app.openapi(bulkUploadDocumentsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const traceId = context.get("traceId");
      const knowledgeSpaceId = context.req.valid("param").id;
      const space = await traceAsync(traces, traceId, "ingestion.bulk_space_lookup", () =>
        spaces.get({
          id: knowledgeSpaceId,
          tenantId: subject.tenantId,
        }),
      );

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }
      const deletionToken = await deletionFence?.captureDeletionFence({
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      const assertWritable = () => assertDeletionWritable(deletionFence, deletionToken);
      const admittedObjectStorage = createDeletionAdmittedObjectStorage({
        admission: objectWriteAdmission,
        objectStorage: adapter.objectStorage,
        scope: { knowledgeSpaceId, tenantId: subject.tenantId },
      });

      try {
        await documentMutationAdmissionGuard?.assertDocumentMutationAdmission({
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (error instanceof LegacySpacePublicationBootstrapAdmissionError) {
          return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
        }
        throw error;
      }

      if (!documentCompilationJobs || !logicalDocuments) {
        return context.json(
          { error: "Durable logical document compilation is not configured" },
          503,
        );
      }

      const maxAcceptedBytesByQuota = await traceAsync(
        traces,
        traceId,
        "ingestion.bulk_quota_remaining",
        () =>
          readBulkUploadQuotaRemaining({
            assets,
            generateKnowledgeSpaceManifestId,
            knowledgeSpaceId,
            knowledgeSpaceManifests,
            knowledgeSpaceQuotaUsageReader,
            now,
            space,
            storageQuotaRepository,
            tenantId: subject.tenantId,
          }),
      );
      const admission = await traceAsync(traces, traceId, "ingestion.bulk_upload_read_hash", () =>
        readBulkDocumentUploadWithAdmission(context.req, {
          maxAcceptedBytesByQuota,
          maxBulkUploadBytes: effectiveMaxBulkUploadBytes,
          maxBulkUploadFiles,
          maxUploadBytes,
        }),
      );
      const uploads = admission.accepted.flatMap((item) =>
        item.upload ? [{ admissionIndex: item.index, upload: item.upload }] : [],
      );
      await traceAsync(traces, traceId, "ingestion.bulk_storage_quota_check", () =>
        enforceStorageQuota({
          assets,
          incomingBytes: uploads.reduce((sum, item) => sum + item.upload.body.byteLength, 0),
          knowledgeSpaceId,
          quotas: storageQuotaRepository,
          tenantId: subject.tenantId,
        }),
      );
      await traceAsync(traces, traceId, "ingestion.bulk_manifest_quota_check", () =>
        enforceManifestQuotaAdmission({
          delta: {
            rawDocumentBytes: uploads.reduce((sum, item) => sum + item.upload.body.byteLength, 0),
          },
          generateKnowledgeSpaceManifestId,
          knowledgeSpaceId,
          knowledgeSpaceManifests,
          knowledgeSpaceQuotaUsageReader,
          now,
          space,
        }),
      );
      const permissionSnapshot = await issueDocumentOperationPermission({
        access,
        authorization,
        context,
        knowledgeSpaceId,
      });
      if (!permissionSnapshot) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      const bulkJobId = generateBulkUploadId();
      const objectWrites: { readonly documentAssetId: string; readonly objectKey: string }[] = [];
      const createdAssets: DocumentAsset[] = [];
      const createdLogicalRevisions: DocumentRevision[] = [];
      const startedCompilationJobIds: string[] = [];

      try {
        const acceptedItemsByIndex = new Map<number, BulkUploadAcceptedItem>();
        const runtimeExcludedItemsByIndex = new Map<
          number,
          {
            readonly filename: string;
            readonly index: number;
            readonly mimeType: string;
            readonly reason: Extract<
              DocumentUploadExclusionReason,
              "document_not_found" | "invalid_target" | "processing_failed" | "revision_conflict"
            >;
            readonly sizeBytes: number;
            readonly status: "excluded";
          }
        >();
        const bulkItems: BulkOperationItem[] = [];

        for (const admitted of uploads) {
          const upload = admitted.upload;
          const id = generateDocumentAssetId();
          const objectKey = createDocumentObjectKey({
            assetId: id,
            filename: upload.file.name,
            knowledgeSpaceId,
            tenantId: subject.tenantId,
          });
          objectWrites.push({ documentAssetId: id, objectKey });
          let asset: DocumentAsset | undefined;
          let logicalRevision: DocumentRevision | undefined;
          let compilationJobId: string | undefined;
          let pathCreated = false;

          try {
            await assertWritable();
            await traceAsync(traces, traceId, "ingestion.bulk_object_put", () =>
              admittedObjectStorage.putObject({
                body: upload.body,
                contentType: upload.mimeType,
                key: objectKey,
                metadata: {
                  assetId: id,
                  bulkJobId,
                  knowledgeSpaceId,
                  sha256: upload.sha256,
                  tenantId: subject.tenantId,
                  uploadedBy: subject.subjectId,
                },
              }),
            );
            await assertWritable();

            const createdAsset = await traceAsync(
              traces,
              traceId,
              "ingestion.bulk_asset_create",
              () =>
                assets.create({
                  filename: upload.file.name,
                  id,
                  knowledgeSpaceId,
                  metadata: {
                    bulkJobId,
                    permissionScope: upload.documentId
                      ? [...permissionSnapshot.permissionScopes]
                      : [],
                    tenantId: subject.tenantId,
                    traceId,
                    uploadedBy: subject.subjectId,
                  },
                  mimeType: upload.mimeType,
                  objectKey,
                  sha256: upload.sha256,
                  sizeBytes: upload.body.byteLength,
                  tenantId: subject.tenantId,
                }),
            );
            asset = createdAsset;
            createdAssets.push(createdAsset);
            await assertWritable();
            await traceAsync(traces, traceId, "ingestion.bulk_document_path_upsert", () =>
              knowledgePaths.upsertMany([
                buildDocumentKnowledgePath({
                  asset: createdAsset,
                  id: generateKnowledgePathId(),
                  tenantId: subject.tenantId,
                }),
              ]),
            );
            pathCreated = true;

            logicalRevision = (
              await traceAsync(traces, traceId, "ingestion.bulk_logical_revision_create", () =>
                logicalDocuments.createCandidateRevision({
                  contentHash: upload.sha256,
                  documentAssetId: createdAsset.id,
                  documentAssetVersion: createdAsset.version,
                  ...(upload.documentId ? { documentId: upload.documentId } : {}),
                  ...(upload.expectedActiveRevision !== undefined
                    ? { expectedActiveRevision: upload.expectedActiveRevision }
                    : {}),
                  ...(upload.expectedDocumentRowVersion !== undefined
                    ? { expectedDocumentRowVersion: upload.expectedDocumentRowVersion }
                    : {}),
                  knowledgeSpaceId,
                  mimeType: createdAsset.mimeType,
                  now: now(),
                  permissionSnapshot,
                  requestedBySubjectId: subject.subjectId,
                  sizeBytes: createdAsset.sizeBytes,
                  systemMetadata: {
                    provenance: {
                      documentAssetId: createdAsset.id,
                      uploadedBy: subject.subjectId,
                    },
                  },
                  tenantId: subject.tenantId,
                  title: createdAsset.filename,
                }),
              )
            ).revision;
            const scopedAsset = await assets.get({ id: asset.id, knowledgeSpaceId });
            if (!scopedAsset) {
              throw new LogicalDocumentValidationError(
                "Logical document revision asset disappeared after scope inheritance",
              );
            }
            asset = scopedAsset;
            createdLogicalRevisions.push(logicalRevision);

            await assertWritable();
            const compilationJob = await traceAsync(
              traces,
              traceId,
              "ingestion.bulk_compilation_job_start",
              () =>
                documentCompilationJobs.start({
                  ...(documentCompilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
                  documentAssetId: scopedAsset.id,
                  knowledgeSpaceId,
                  permissionSnapshot,
                  requestedBySubjectId: subject.subjectId,
                  tenantId: subject.tenantId,
                  version: scopedAsset.version,
                }),
            );
            compilationJobId = compilationJob.id;
            startedCompilationJobIds.push(compilationJob.id);
            try {
              await logicalDocuments.bindCompilationAttempt({
                attemptId: compilationJob.id,
                documentId: logicalRevision.documentId,
                knowledgeSpaceId,
                revision: logicalRevision.revision,
                tenantId: subject.tenantId,
              });
              await documentCompilationJobs.releaseDispatch?.(compilationJob.id);
            } catch (error) {
              await documentCompilationJobs
                .cancel(compilationJob.id, "Logical document revision binding failed")
                .catch(() => undefined);
              throw error;
            }
            await assertWritable();
            const assetStatusUrl = createDocumentAssetStatusUrl({
              documentAssetId: asset.id,
              knowledgeSpaceId,
            });
            const statusUrl = createLogicalDocumentTaskStatusUrl({
              documentId: logicalRevision.documentId,
              knowledgeSpaceId,
              taskId: compilationJob.id,
            });

            const responseItem = {
              asset,
              assetStatusUrl,
              compilationJob: {
                id: compilationJob.id,
                stage: "queued" as const,
              },
              logicalDocument: {
                id: logicalRevision.documentId,
                revision: logicalRevision.revision,
              },
              logicalDocumentId: logicalRevision.documentId,
              documentRevision: logicalRevision.revision,
              status: "accepted" as const,
              statusUrl,
            };
            acceptedItemsByIndex.set(admitted.admissionIndex, responseItem);
            bulkItems.push({
              compilationJobId: compilationJob.id,
              documentId: asset.id,
              requiredPermissionScope: requiredPermissionScopeForAsset(asset),
              status: "queued",
            });
          } catch (error) {
            const effectiveError = await resolveDeletionFenceAfterFailure(error, assertWritable);
            if (isDeletionWriteBlocked(effectiveError)) throw effectiveError;

            if (compilationJobId) {
              await documentCompilationJobs
                .cancel(compilationJobId, "Bulk upload item processing failed")
                .catch(() => undefined);
            }
            if (logicalRevision) {
              await failLogicalCandidateIfPending(logicalDocuments, logicalRevision, now()).catch(
                () => undefined,
              );
            }
            if (asset) {
              const failedAsset = asset;
              await traceAsync(traces, traceId, "ingestion.bulk_status_update", () =>
                assets.updateParserStatus({
                  id: failedAsset.id,
                  knowledgeSpaceId,
                  parserStatus: "failed",
                }),
              ).catch(() => undefined);
            }

            // Before an immutable logical revision exists, this item is safe to compensate fully.
            // Once a revision exists, retain its raw asset as a failed, inspectable revision; only
            // this item is failed and previously accepted jobs keep their objects and queue state.
            if (!logicalRevision) {
              if (pathCreated) {
                await knowledgePaths
                  .deleteByDocumentAsset({
                    documentAssetId: id,
                    knowledgeSpaceId,
                    maxPaths: 1,
                  })
                  .catch(() => undefined);
              }
              await scrubStaleDocumentUploadWithRetry(
                // The durable stale-write scrubber is intentionally deletion-fence-only. This
                // branch has already proved deletion did not win, so compensate the unpublished
                // asset and raw object directly instead of requiring a deletion tombstone.
                { assets, objectStorage: adapter.objectStorage },
                {
                  documentAssetId: id,
                  expectedVersion: asset?.version ?? 1,
                  knowledgeSpaceId,
                  objectKey,
                  tenantId: subject.tenantId,
                },
              ).catch(() => undefined);
              const writeIndex = objectWrites.findIndex((write) => write.documentAssetId === id);
              if (writeIndex >= 0) objectWrites.splice(writeIndex, 1);
              const assetIndex = createdAssets.findIndex((created) => created.id === id);
              if (assetIndex >= 0) createdAssets.splice(assetIndex, 1);
            }

            runtimeExcludedItemsByIndex.set(admitted.admissionIndex, {
              filename: upload.file.name,
              index: admitted.admissionIndex,
              mimeType: upload.mimeType,
              reason: bulkRuntimeExclusionReason(effectiveError, Boolean(upload.documentId)),
              sizeBytes: upload.body.byteLength,
              status: "excluded",
            });
          }
        }

        await bulkOperationRepository.create({
          id: bulkJobId,
          items: bulkItems,
          knowledgeSpaceId,
          permissionSnapshot,
          requestedBySubjectId: subject.subjectId,
          tenantId: subject.tenantId,
          type: "document_upload",
        });

        const responseItems = admission.items.map((item) => {
          if (item.status === "accepted") {
            const accepted = acceptedItemsByIndex.get(item.index);
            if (accepted) return accepted;
            const runtimeExcluded = runtimeExcludedItemsByIndex.get(item.index);
            if (runtimeExcluded) return runtimeExcluded;
            throw new Error("Accepted document upload response is missing");
          }
          return {
            filename: item.filename,
            index: item.index,
            mimeType: item.mimeType,
            reason: item.reason ?? "invalid_file",
            sizeBytes: item.sizeBytes,
            status: "excluded" as const,
          };
        });

        return context.json(
          {
            accepted: acceptedItemsByIndex.size,
            bulkJobId,
            excluded: admission.excluded.length + runtimeExcludedItemsByIndex.size,
            items: responseItems,
            total: responseItems.length,
          },
          202,
        );
      } catch (error) {
        const effectiveError = await resolveDeletionFenceAfterFailure(error, assertWritable);
        await Promise.all(
          startedCompilationJobIds.map((jobId) =>
            documentCompilationJobs
              .cancel(jobId, "Bulk upload request failed before operation publication")
              .catch(() => undefined),
          ),
        );
        if (isDeletionWriteBlocked(effectiveError)) {
          await cleanupBulkDeletionWrites({
            assets,
            knowledgeSpaceId,
            objectStorage: adapter.objectStorage,
            objectWrites,
            staleWriteScrubber,
            tenantId: subject.tenantId,
          });
        } else {
          await deleteBulkUploadObjects({
            objectKeys: objectWrites.map(({ objectKey }) => objectKey),
            objectStorage: adapter.objectStorage,
            traceId,
            traces,
          });
        }
        await Promise.all(
          createdAssets.map((asset) =>
            traceAsync(traces, traceId, "ingestion.bulk_status_update", () =>
              assets.updateParserStatus({
                id: asset.id,
                knowledgeSpaceId,
                parserStatus: "failed",
              }),
            ).catch(() => undefined),
          ),
        );
        if (logicalDocuments) {
          await Promise.all(
            createdLogicalRevisions.map((revision) =>
              failLogicalCandidateIfPending(logicalDocuments, revision, now()).catch(
                () => undefined,
              ),
            ),
          );
        }

        if (effectiveError instanceof DocumentAssetCapacityExceededError) {
          throw effectiveError;
        }

        return isDeletionWriteBlocked(effectiveError)
          ? context.json({ error: "Knowledge space deletion is active" }, 409)
          : context.json({ error: "Bulk document upload failed" }, 500);
      }
    } catch (error) {
      if (
        error instanceof DocumentUploadValidationError ||
        error instanceof BulkDocumentUploadValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      if (
        error instanceof DocumentUploadTooLargeError ||
        error instanceof BulkDocumentUploadTooLargeError
      ) {
        return context.json({ error: error.message }, 413);
      }

      if (error instanceof StorageQuotaExceededError) {
        return context.json({ error: error.message }, 413);
      }

      if (isKnowledgeSpaceQuotaAdmissionError(error)) {
        return context.json({ error: error.message }, 413);
      }

      if (error instanceof DocumentAssetCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }

      /* v8 ignore next 2 -- unexpected bulk upload failures should escape to Hono's error handling. */
      throw error;
    }
  });

  app.openapi(uploadDocumentRoute, async (context) => {
    let deletionAssertWritable: (() => Promise<void>) | undefined;
    let deletionCleanup:
      | {
          readonly documentAssetId: string;
          readonly expectedVersion: number;
          readonly knowledgeSpaceId: string;
          readonly objectKey: string;
          readonly sourceId?: string | undefined;
          readonly stagedCommitId: string;
          readonly tenantId: string;
        }
      | undefined;
    let logicalRevision: DocumentRevision | undefined;
    try {
      const subject = context.get("subject");
      const traceId = context.get("traceId");
      const knowledgeSpaceId = context.req.valid("param").id;
      const space = await traceAsync(traces, traceId, "ingestion.space_lookup", () =>
        spaces.get({
          id: knowledgeSpaceId,
          tenantId: subject.tenantId,
        }),
      );

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      try {
        await documentMutationAdmissionGuard?.assertDocumentMutationAdmission({
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (error instanceof LegacySpacePublicationBootstrapAdmissionError) {
          return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
        }
        throw error;
      }

      const { sha256, upload } = await traceAsync(
        traces,
        traceId,
        "ingestion.upload_read_hash",
        async () => {
          const documentUpload = await readDocumentUpload(context.req, maxUploadBytes);
          return {
            sha256: await sha256Hex(documentUpload.body),
            upload: documentUpload,
          };
        },
      );
      await traceAsync(traces, traceId, "ingestion.storage_quota_check", () =>
        enforceStorageQuota({
          assets,
          incomingBytes: upload.body.byteLength,
          knowledgeSpaceId,
          quotas: storageQuotaRepository,
          tenantId: subject.tenantId,
        }),
      );
      await traceAsync(traces, traceId, "ingestion.manifest_quota_check", () =>
        enforceManifestQuotaAdmission({
          delta: { rawDocumentBytes: upload.body.byteLength },
          generateKnowledgeSpaceManifestId,
          knowledgeSpaceId,
          knowledgeSpaceManifests,
          knowledgeSpaceQuotaUsageReader,
          now,
          space,
        }),
      );
      const issuedPermissionSnapshot = documentCompilationJobs
        ? await issueDocumentOperationPermission({
            access,
            authorization,
            context,
            knowledgeSpaceId,
          })
        : undefined;
      if (documentCompilationJobs && !issuedPermissionSnapshot) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      const compilationAuthorization =
        documentCompilationJobs && issuedPermissionSnapshot
          ? {
              jobs: documentCompilationJobs,
              permissionSnapshot: issuedPermissionSnapshot,
            }
          : undefined;
      if (logicalDocuments && !compilationAuthorization) {
        return context.json({ error: "Logical document uploads require durable compilation" }, 503);
      }
      const id = generateDocumentAssetId();
      const objectKey = createDocumentObjectKey({
        assetId: id,
        filename: upload.file.name,
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      const stagedCommitScope = {
        id,
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      };
      const createAsset = () =>
        assets.create({
          filename: upload.file.name,
          id,
          knowledgeSpaceId,
          metadata: {
            permissionScope:
              upload.documentId && issuedPermissionSnapshot
                ? [...issuedPermissionSnapshot.permissionScopes]
                : [],
            tenantId: subject.tenantId,
            traceId,
            uploadedBy: subject.subjectId,
          },
          mimeType: upload.mimeType,
          objectKey,
          sha256,
          sizeBytes: upload.body.byteLength,
          ...(upload.sourceId ? { sourceId: upload.sourceId } : {}),
          tenantId: subject.tenantId,
        });
      let sourceOwnedPendingAsset: DocumentAsset | undefined;
      deletionCleanup = {
        documentAssetId: id,
        expectedVersion: 1,
        knowledgeSpaceId,
        objectKey,
        ...(upload.sourceId ? { sourceId: upload.sourceId } : {}),
        stagedCommitId: id,
        tenantId: subject.tenantId,
      };
      const deletionToken = await deletionFence?.captureDeletionFence({
        documentAssetId: id,
        knowledgeSpaceId,
        ...(upload.sourceId ? { sourceId: upload.sourceId } : {}),
        tenantId: subject.tenantId,
      });
      const assertWritable = () => assertDeletionWritable(deletionFence, deletionToken);
      deletionAssertWritable = assertWritable;
      const admittedObjectStorage = createDeletionAdmittedObjectStorage({
        admission: objectWriteAdmission,
        objectStorage: adapter.objectStorage,
        scope: { knowledgeSpaceId, tenantId: subject.tenantId },
      });

      await assertWritable();
      await traceAsync(traces, traceId, "ingestion.staged_commit_received", () =>
        stagedCommits.create({
          checksum: sha256,
          createdAt: now(),
          ...(upload.sourceId ? { documentAssetId: id } : {}),
          id,
          idempotencyKey: `document-upload:${id}`,
          knowledgeSpaceId,
          operationType: "document-upload",
          rawObjectKey: objectKey,
          sizeBytes: upload.body.byteLength,
          status: "received",
          tenantId: subject.tenantId,
          updatedAt: now(),
        }),
      );
      await assertWritable();

      if (upload.sourceId) {
        // A source-owned asset is the durable ownership ledger for the external object write.
        // Persist it before putObject so Source deletion can inventory the exact document prefix
        // even when this process dies after the object store commits but before putObject returns.
        sourceOwnedPendingAsset = await traceAsync(
          traces,
          traceId,
          "ingestion.source_asset_reservation",
          createAsset,
        );
        await assertWritable();
      }

      await traceAsync(traces, traceId, "ingestion.object_put", () =>
        admittedObjectStorage.putObject({
          body: upload.body,
          contentType: upload.mimeType,
          key: objectKey,
          metadata: {
            assetId: id,
            knowledgeSpaceId,
            sha256,
            tenantId: subject.tenantId,
            uploadedBy: subject.subjectId,
          },
        }),
      );
      await assertWritable();
      await traceAsync(traces, traceId, "ingestion.staged_commit_object_staged", () =>
        stagedCommits.transition({
          ...stagedCommitScope,
          status: "object-staged",
          updatedAt: now(),
        }),
      );
      await assertWritable();

      try {
        await traceAsync(traces, traceId, "ingestion.object_verify", async () => {
          const metadata = await adapter.objectStorage.headObject(objectKey);

          if (!metadata) {
            throw new StagedObjectVerificationError("Staged object is missing after upload");
          }

          if (metadata.sizeBytes !== upload.body.byteLength) {
            throw new StagedObjectVerificationError(
              `Staged object size mismatch: expected ${upload.body.byteLength}, got ${metadata.sizeBytes}`,
            );
          }

          if (metadata.metadata.sha256 !== sha256) {
            throw new StagedObjectVerificationError("Staged object checksum metadata mismatch");
          }
        });
        await traceAsync(traces, traceId, "ingestion.staged_commit_object_verified", () =>
          stagedCommits.transition({
            ...stagedCommitScope,
            status: "object-verified",
            updatedAt: now(),
          }),
        );
        await assertWritable();
      } catch (error) {
        const effectiveError = await resolveDeletionFenceAfterFailure(error, assertWritable);
        if (isDeletionWriteBlocked(effectiveError)) throw effectiveError;
        await traceAsync(traces, traceId, "ingestion.staged_commit_object_failed", () =>
          stagedCommits.transition({
            ...stagedCommitScope,
            patch: {
              errorCode: "object_verification_failed",
              errorMessage: errorMessage(effectiveError),
            },
            status: "failed-retryable",
            updatedAt: now(),
          }),
        ).catch(() => undefined);
        if (sourceOwnedPendingAsset) {
          await traceAsync(traces, traceId, "ingestion.cleanup_source_asset_reservation", () =>
            assets.rollbackStaleWrite({
              expectedObjectKey: objectKey,
              expectedVersion: sourceOwnedPendingAsset.version,
              id: sourceOwnedPendingAsset.id,
              knowledgeSpaceId,
            }),
          );
        }
        await traceAsync(traces, traceId, "ingestion.cleanup_unverified_object", () =>
          adapter.objectStorage.deleteObject(objectKey),
        );

        return context.json({ error: "Document upload failed" }, 500);
      }

      let metadataAsset: DocumentAsset | undefined;
      let metadataPathCreated = false;
      try {
        await assertWritable();
        let asset =
          sourceOwnedPendingAsset ??
          (await traceAsync(traces, traceId, "ingestion.asset_create", createAsset));
        metadataAsset = asset;
        await assertWritable();
        if (logicalDocuments) {
          logicalRevision = (
            await traceAsync(traces, traceId, "ingestion.logical_revision_create", () =>
              logicalDocuments.createCandidateRevision({
                contentHash: sha256,
                documentAssetId: asset.id,
                documentAssetVersion: asset.version,
                ...(upload.documentId ? { documentId: upload.documentId } : {}),
                ...(upload.expectedActiveRevision !== undefined
                  ? { expectedActiveRevision: upload.expectedActiveRevision }
                  : {}),
                ...(upload.expectedDocumentRowVersion !== undefined
                  ? { expectedDocumentRowVersion: upload.expectedDocumentRowVersion }
                  : {}),
                knowledgeSpaceId,
                mimeType: asset.mimeType,
                now: now(),
                permissionSnapshot: compilationAuthorization?.permissionSnapshot,
                requestedBySubjectId: subject.subjectId,
                sizeBytes: asset.sizeBytes,
                systemMetadata: {
                  provenance: { documentAssetId: asset.id, uploadedBy: subject.subjectId },
                },
                tenantId: subject.tenantId,
                title: asset.filename,
              }),
            )
          ).revision;
          const scopedAsset = await assets.get({ id: asset.id, knowledgeSpaceId });
          if (!scopedAsset) {
            throw new LogicalDocumentValidationError(
              "Logical document revision asset disappeared after scope inheritance",
            );
          }
          asset = scopedAsset;
          metadataAsset = asset;
        }
        await traceAsync(traces, traceId, "ingestion.document_path_upsert", () =>
          knowledgePaths.upsertMany([
            buildDocumentKnowledgePath({
              asset,
              id: generateKnowledgePathId(),
              tenantId: subject.tenantId,
            }),
          ]),
        );
        metadataPathCreated = true;
        await assertWritable();
        await traceAsync(traces, traceId, "ingestion.staged_commit_metadata_prepared", () =>
          stagedCommits.transition({
            ...stagedCommitScope,
            patch: {
              documentAssetId: asset.id,
              publishedObjectKey: objectKey,
            },
            status: "metadata-prepared",
            updatedAt: now(),
          }),
        );
        await assertWritable();

        if (compilationAuthorization) {
          await assertWritable();
          const compilationJob = await traceAsync(
            traces,
            traceId,
            "ingestion.compilation_job_start",
            async () => {
              try {
                return await compilationAuthorization.jobs.start({
                  ...(compilationAuthorization.jobs.releaseDispatch ? { deferDispatch: true } : {}),
                  documentAssetId: asset.id,
                  knowledgeSpaceId,
                  permissionSnapshot: compilationAuthorization.permissionSnapshot,
                  requestedBySubjectId: subject.subjectId,
                  tenantId: subject.tenantId,
                  version: asset.version,
                });
              } catch (error) {
                await traceAsync(traces, traceId, "ingestion.status_update", () =>
                  assets.updateParserStatus({
                    id: asset.id,
                    knowledgeSpaceId,
                    parserStatus: "failed",
                  }),
                ).catch(() => undefined);
                throw error;
              }
            },
          );
          if (logicalRevision && logicalDocuments) {
            try {
              await logicalDocuments.bindCompilationAttempt({
                attemptId: compilationJob.id,
                documentId: logicalRevision.documentId,
                knowledgeSpaceId,
                revision: logicalRevision.revision,
                tenantId: subject.tenantId,
              });
              await compilationAuthorization.jobs.releaseDispatch?.(compilationJob.id);
            } catch (error) {
              await compilationAuthorization.jobs
                .cancel(compilationJob.id, "Logical document revision binding failed")
                .catch(() => undefined);
              throw error;
            }
          }
          await assertWritable();
          if (!logicalRevision) {
            throw new Error("Logical document revision is required for durable upload");
          }
          const assetStatusUrl = createDocumentAssetStatusUrl({
            documentAssetId: asset.id,
            knowledgeSpaceId,
          });
          const statusUrl = createLogicalDocumentTaskStatusUrl({
            documentId: logicalRevision.documentId,
            knowledgeSpaceId,
            taskId: compilationJob.id,
          });
          context.header("Location", statusUrl);
          return context.json(
            {
              asset,
              assetStatusUrl,
              compilationJob: {
                id: compilationJob.id,
                stage: "queued" as const,
              },
              logicalDocument: {
                id: logicalRevision.documentId,
                revision: logicalRevision.revision,
              },
              logicalDocumentId: logicalRevision.documentId,
              documentRevision: logicalRevision.revision,
              statusUrl,
            },
            202,
          );
        }

        try {
          await compileDocumentArtifact(
            {
              asset,
              body: upload.body,
              knowledgeSpaceId,
              permissionScope: [],
              tenantId: subject.tenantId,
              traceId,
            },
            {
              artifacts,
              artifactSegments,
              denseEmbeddingModel,
              embeddingResolver,
              documentMultimodalImageVariantGenerator,
              documentMultimodalLocalAssetAllowlist,
              documentMultimodalMaxExtractedAssets,
              documentMultimodalMaxLocalAssetBytes,
              documentMultimodalMaxPdfRasterizedAssets,
              documentMultimodalManifests,
              documentParser,
              documentPdfRasterizer,
              generateArtifactSegmentId,
              generateKnowledgePathId,
              knowledgePaths,
              now,
              objectStorage: admittedObjectStorage,
              outlineBuilder,
              outlineSummaryEnhancer,
              outlines,
              semanticPostProcessor,
              synchronousUploadDenseModel,
              synchronousUploadReindexer,
              traces,
              visualEmbeddingModel,
            },
          );
          await assertWritable();
          await traceAsync(traces, traceId, "ingestion.staged_commit_artifacts_built", () =>
            stagedCommits.transition({
              ...stagedCommitScope,
              status: "artifacts-built",
              updatedAt: now(),
            }),
          );
          await assertWritable();
          const parsedAsset = await traceAsync(traces, traceId, "ingestion.status_update", () =>
            assets.updateParserStatus({
              id: asset.id,
              knowledgeSpaceId,
              parserStatus: "parsed",
            }),
          );
          await assertWritable();

          if (!parsedAsset) {
            return context.json({ error: "Document upload failed" }, 500);
          }

          await traceAsync(traces, traceId, "ingestion.staged_commit_published", () =>
            stagedCommits.transition({
              ...stagedCommitScope,
              patch: {
                documentAssetId: parsedAsset.id,
                publishedObjectKey: objectKey,
              },
              status: "published",
              updatedAt: now(),
            }),
          );
          await assertWritable();

          return context.json(parsedAsset, 201);
        } catch (error) {
          const effectiveError = await resolveDeletionFenceAfterFailure(error, assertWritable);
          if (isDeletionWriteBlocked(effectiveError)) throw effectiveError;
          logDocumentUploadDiagnostic({
            asset,
            error: effectiveError,
            knowledgeSpaceId,
            stage: "upload",
            traceId,
          });
          await traceAsync(traces, traceId, "ingestion.status_update", () =>
            assets.updateParserStatus({
              id: asset.id,
              knowledgeSpaceId,
              parserStatus: "failed",
            }),
          ).catch(() => undefined);
          await traceAsync(traces, traceId, "ingestion.staged_commit_parser_failed", () =>
            stagedCommits.transition({
              ...stagedCommitScope,
              patch: {
                documentAssetId: asset.id,
                errorCode: "parser_failed",
                errorMessage: errorMessage(effectiveError),
                publishedObjectKey: objectKey,
              },
              status: "failed-terminal",
              updatedAt: now(),
            }),
          ).catch(() => undefined);

          return context.json({ error: "Document parsing failed" }, 500);
        }
      } catch (error) {
        const effectiveError = await resolveDeletionFenceAfterFailure(error, assertWritable);
        if (isDeletionWriteBlocked(effectiveError)) throw effectiveError;
        if (logicalRevision && logicalDocuments) {
          await failLogicalCandidateIfPending(logicalDocuments, logicalRevision, now()).catch(
            () => undefined,
          );
        }
        if (logicalRevision && metadataAsset) {
          const failedAsset = metadataAsset;
          // Once an immutable revision exists, preserve its raw asset for inspection/retry and
          // make the failed state explicit instead of deleting the referenced object.
          await traceAsync(traces, traceId, "ingestion.status_update", () =>
            assets.updateParserStatus({
              id: failedAsset.id,
              knowledgeSpaceId,
              parserStatus: "failed",
            }),
          ).catch(() => undefined);
        }
        await traceAsync(traces, traceId, "ingestion.staged_commit_metadata_failed", () =>
          stagedCommits.transition({
            ...stagedCommitScope,
            patch: {
              errorCode: "metadata_prepare_failed",
              errorMessage: errorMessage(effectiveError),
            },
            status: "failed-retryable",
            updatedAt: now(),
          }),
        ).catch(() => undefined);
        if (!logicalRevision) {
          if (metadataPathCreated) {
            await knowledgePaths.deleteByDocumentAsset({
              documentAssetId: id,
              knowledgeSpaceId,
              maxPaths: 1,
            });
          }
          if (metadataAsset) {
            await scrubStaleDocumentUploadWithRetry(
              // This is ordinary pre-publication compensation, not deletion cleanup.
              { assets, objectStorage: adapter.objectStorage },
              {
                documentAssetId: metadataAsset.id,
                expectedVersion: metadataAsset.version,
                knowledgeSpaceId,
                objectKey,
                ...(upload.sourceId ? { sourceId: upload.sourceId } : {}),
                tenantId: subject.tenantId,
              },
            );
          } else {
            await traceAsync(traces, traceId, "ingestion.cleanup_object", () =>
              adapter.objectStorage.deleteObject(objectKey),
            );
          }
        }

        if (effectiveError instanceof DocumentAssetCapacityExceededError) {
          throw effectiveError;
        }
        if (
          effectiveError instanceof LogicalDocumentConflictError ||
          effectiveError instanceof LogicalDocumentNotFoundError ||
          effectiveError instanceof LogicalDocumentValidationError
        ) {
          throw effectiveError;
        }
        return context.json({ error: "Document upload failed" }, 500);
      }
    } catch (error) {
      const effectiveError = deletionAssertWritable
        ? await resolveDeletionFenceAfterFailure(error, deletionAssertWritable)
        : error;
      if (isDeletionWriteBlocked(effectiveError) && deletionCleanup) {
        await stagedCommits
          .transition({
            id: deletionCleanup.stagedCommitId,
            knowledgeSpaceId: deletionCleanup.knowledgeSpaceId,
            status: "canceled",
            tenantId: deletionCleanup.tenantId,
            updatedAt: now(),
          })
          .catch(() => undefined);
        await scrubStaleDocumentUploadWithRetry(
          {
            assets,
            objectStorage: adapter.objectStorage,
            staleWriteScrubber,
          },
          deletionCleanup,
        );
        return context.json({ error: "Knowledge space or source deletion is active" }, 409);
      }
      if (effectiveError instanceof DocumentUploadValidationError) {
        return context.json({ error: effectiveError.message }, 400);
      }

      if (effectiveError instanceof DocumentUploadTooLargeError) {
        return context.json({ error: effectiveError.message }, 413);
      }

      if (effectiveError instanceof StorageQuotaExceededError) {
        return context.json({ error: effectiveError.message }, 413);
      }

      if (isKnowledgeSpaceQuotaAdmissionError(effectiveError)) {
        return context.json({ error: effectiveError.message }, 413);
      }

      if (effectiveError instanceof DocumentAssetCapacityExceededError) {
        return context.json({ error: effectiveError.message }, 429);
      }

      if (logicalRevision && logicalDocuments) {
        await failLogicalCandidateIfPending(logicalDocuments, logicalRevision, now()).catch(
          () => undefined,
        );
      }
      if (effectiveError instanceof LogicalDocumentConflictError) {
        return context.json({ error: effectiveError.message }, 409);
      }
      if (effectiveError instanceof LogicalDocumentNotFoundError) {
        return context.json({ error: effectiveError.message }, 404);
      }
      if (effectiveError instanceof LogicalDocumentValidationError) {
        return context.json({ error: effectiveError.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected upload failures should escape to Hono's error handling. */
      throw effectiveError;
    }
  });
}

async function failLogicalCandidateIfPending(
  logicalDocuments: LogicalDocumentRepository,
  revision: DocumentRevision,
  timestamp: string,
): Promise<void> {
  const current = await logicalDocuments.getRevision({
    documentId: revision.documentId,
    knowledgeSpaceId: revision.knowledgeSpaceId,
    revision: revision.revision,
    tenantId: revision.tenantId,
  });
  if (current?.state === "candidate") {
    await logicalDocuments.failCandidate({
      documentId: revision.documentId,
      knowledgeSpaceId: revision.knowledgeSpaceId,
      now: timestamp,
      revision: revision.revision,
      tenantId: revision.tenantId,
    });
  }
}

async function resolveDeletionFenceAfterFailure(
  error: unknown,
  assertWritable: () => Promise<void>,
): Promise<unknown> {
  if (isDeletionWriteBlocked(error)) return error;
  try {
    await assertWritable();
    return error;
  } catch (fenceError) {
    if (isDeletionWriteBlocked(fenceError)) return fenceError;
    throw fenceError;
  }
}

function isDeletionWriteBlocked(error: unknown): boolean {
  return (
    error instanceof DeletionLifecycleFenceActiveError ||
    error instanceof DeletionObjectWriteAdmissionError
  );
}

async function cleanupBulkDeletionWrites({
  assets,
  knowledgeSpaceId,
  objectStorage,
  objectWrites,
  staleWriteScrubber,
  tenantId,
}: {
  readonly assets: Pick<DocumentAssetRepository, "rollbackStaleWrite">;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: Pick<PlatformAdapter["objectStorage"], "deleteObject">;
  readonly objectWrites: readonly {
    readonly documentAssetId: string;
    readonly objectKey: string;
  }[];
  readonly staleWriteScrubber?: SourceDocumentStaleWriteScrubber | undefined;
  readonly tenantId: string;
}): Promise<void> {
  const errors: unknown[] = [];
  for (const write of objectWrites) {
    try {
      await scrubStaleDocumentUploadWithRetry(
        { assets, objectStorage, staleWriteScrubber },
        {
          documentAssetId: write.documentAssetId,
          expectedVersion: 1,
          knowledgeSpaceId,
          objectKey: write.objectKey,
          tenantId,
        },
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to compensate bulk document writes after deletion");
  }
}

async function deleteBulkUploadObjects({
  objectKeys,
  objectStorage,
  traceId,
  traces,
}: {
  readonly objectKeys: readonly string[];
  readonly objectStorage: Pick<PlatformAdapter["objectStorage"], "deleteObject">;
  readonly traceId: string;
  readonly traces: TraceRecorder;
}): Promise<void> {
  const errors: unknown[] = [];
  for (const objectKey of objectKeys) {
    try {
      await traceAsync(traces, traceId, "ingestion.bulk_cleanup_object", () =>
        objectStorage.deleteObject(objectKey),
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clean up bulk document upload objects");
  }
}

async function scrubStaleDocumentUpload(
  deps: {
    readonly assets: Pick<DocumentAssetRepository, "rollbackStaleWrite">;
    readonly objectStorage: Pick<PlatformAdapter["objectStorage"], "deleteObject">;
    readonly staleWriteScrubber?: SourceDocumentStaleWriteScrubber | undefined;
  },
  input: {
    readonly documentAssetId: string;
    readonly expectedVersion: number;
    readonly knowledgeSpaceId: string;
    readonly objectKey: string;
    readonly sourceId?: string | undefined;
    readonly tenantId: string;
  },
): Promise<void> {
  if (deps.staleWriteScrubber) {
    await deps.staleWriteScrubber.scrub(input);
    return;
  }

  const errors: unknown[] = [];
  await deps.assets
    .rollbackStaleWrite({
      expectedObjectKey: input.objectKey,
      expectedVersion: input.expectedVersion,
      id: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    })
    .catch((error) => errors.push(error));
  await deps.objectStorage.deleteObject(input.objectKey).catch((error) => errors.push(error));
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to scrub stale document upload");
  }
}

async function scrubStaleDocumentUploadWithRetry(
  deps: Parameters<typeof scrubStaleDocumentUpload>[0],
  input: Parameters<typeof scrubStaleDocumentUpload>[1],
): Promise<void> {
  const errors: unknown[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await scrubStaleDocumentUpload(deps, input);
      return;
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, "Stale document upload compensation exhausted its retry budget");
}

async function assertDeletionWritable(
  guard: DeletionLifecycleFenceGuard | undefined,
  token: DeletionLifecycleFenceToken | undefined,
): Promise<void> {
  if (guard && token) await guard.assertDeletionFenceUnchanged(token);
}

async function issueDocumentOperationPermission({
  access,
  authorization,
  context,
  knowledgeSpaceId,
}: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0];
  readonly knowledgeSpaceId: string;
}): Promise<KnowledgeSpacePermissionSnapshot | null> {
  const subject = context.get("subject");
  const callerKind = context.get("callerKind") ?? "interactive";
  const authenticatedApiKey = context.get("authenticatedApiKey");
  const expiresAt = Math.min(
    Date.now() + 60 * 60_000,
    authenticatedApiKey?.expiresAt
      ? Date.parse(authenticatedApiKey.expiresAt)
      : Number.POSITIVE_INFINITY,
  );
  try {
    const snapshot = await issueKnowledgeSpaceDurablePermission({
      access,
      ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
      authorization,
      callerKind,
      expiresAt: new Date(expiresAt).toISOString(),
      knowledgeSpaceId,
      requiredAccess: "write",
      subject,
    });
    return snapshot;
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return null;
    }
    throw error;
  }
}

function requiredPermissionScopeForAsset(asset: DocumentAsset): readonly string[] {
  const requiredPermissionScope = candidatePermissionScopeSnapshot(asset.metadata.permissionScope);
  if (!requiredPermissionScope) {
    throw new Error("Authorized document asset has malformed candidate permission scope");
  }
  return requiredPermissionScope;
}

function registerDocumentMutationLeaseMiddleware({
  app,
  guard,
  now,
}: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly guard: RegisterDocumentWriteHandlersOptions["documentMutationAdmissionGuard"];
  readonly now: () => string;
}): void {
  if (!guard) {
    return;
  }
  const middleware =
    (operation: "bulk-delete" | "bulk-reindex" | "bulk-upload" | "upload") =>
    async (context: Context<KnowledgeGatewayEnv>, next: Next): Promise<Response | undefined> => {
      const subject = context.get("subject");
      const knowledgeSpaceId = context.req.param("id");
      if (!knowledgeSpaceId) {
        await next();
        return;
      }
      let mutationStarted = false;
      try {
        await withKnowledgeSpaceDocumentMutationLease({
          acquiredAt: now(),
          knowledgeSpaceId,
          mutate: async () => {
            mutationStarted = true;
            await next();
          },
          operation,
          repository: guard,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (
          !mutationStarted &&
          error instanceof LegacySpacePublicationBootstrapSnapshotConflictError
        ) {
          await next();
          return;
        }
        if (
          error instanceof KnowledgeSpaceDocumentMutationDeletionActiveError ||
          error instanceof LegacySpacePublicationBootstrapAdmissionError ||
          error instanceof KnowledgeSpaceDocumentMutationLeaseActiveError
        ) {
          return context.json(
            {
              error:
                error instanceof KnowledgeSpaceDocumentMutationDeletionActiveError
                  ? "Knowledge space deletion is active"
                  : "Knowledge space publication bootstrap is active",
            },
            409,
          );
        }
        throw error;
      }
    };

  app.use("/knowledge-spaces/:id/documents", middleware("upload"));
  app.use("/knowledge-spaces/:id/documents/bulk/reindex", middleware("bulk-reindex"));
  app.use("/knowledge-spaces/:id/documents/bulk", async (context, next) => {
    if (context.req.method === "POST") {
      return middleware("bulk-upload")(context, next);
    }
    if (context.req.method === "DELETE") {
      return middleware("bulk-delete")(context, next);
    }
    await next();
  });
}

async function enforceManifestQuotaAdmission({
  delta,
  generateKnowledgeSpaceManifestId,
  knowledgeSpaceId,
  knowledgeSpaceManifests,
  knowledgeSpaceQuotaUsageReader,
  now,
  space,
}: {
  readonly delta: KnowledgeSpaceQuotaAdmissionDelta;
  readonly generateKnowledgeSpaceManifestId: () => string;
  readonly knowledgeSpaceId: string;
  readonly knowledgeSpaceManifests: KnowledgeSpaceManifestRepository;
  readonly knowledgeSpaceQuotaUsageReader: KnowledgeSpaceQuotaUsageReader;
  readonly now: () => string;
  readonly space: KnowledgeSpace;
}): Promise<void> {
  const manifest = await ensureKnowledgeSpaceManifest({
    generateId: generateKnowledgeSpaceManifestId,
    manifests: knowledgeSpaceManifests,
    now,
    space,
  });

  await enforceKnowledgeSpaceQuotaAdmission({
    delta,
    knowledgeSpaceId,
    manifest,
    projectionVersion: projectionVersionFromManifest(manifest.projectionSetVersion),
    usageReader: knowledgeSpaceQuotaUsageReader,
  });
}

async function readBulkUploadQuotaRemaining({
  assets,
  generateKnowledgeSpaceManifestId,
  knowledgeSpaceId,
  knowledgeSpaceManifests,
  knowledgeSpaceQuotaUsageReader,
  now,
  space,
  storageQuotaRepository,
  tenantId,
}: {
  readonly assets: Pick<DocumentAssetRepository, "getStorageUsage">;
  readonly generateKnowledgeSpaceManifestId: () => string;
  readonly knowledgeSpaceId: string;
  readonly knowledgeSpaceManifests: KnowledgeSpaceManifestRepository;
  readonly knowledgeSpaceQuotaUsageReader: KnowledgeSpaceQuotaUsageReader;
  readonly now: () => string;
  readonly space: KnowledgeSpace;
  readonly storageQuotaRepository: StorageQuotaRepository;
  readonly tenantId: string;
}): Promise<number | null> {
  const [storagePolicy, storageUsage, manifest] = await Promise.all([
    storageQuotaRepository.get({ knowledgeSpaceId, tenantId }),
    assets.getStorageUsage({ knowledgeSpaceId }),
    ensureKnowledgeSpaceManifest({
      generateId: generateKnowledgeSpaceManifestId,
      manifests: knowledgeSpaceManifests,
      now,
      space,
    }),
  ]);
  const remaining: number[] = [];
  if (storagePolicy.maxRawDocumentBytes !== null) {
    remaining.push(storagePolicy.maxRawDocumentBytes - storageUsage.rawDocumentBytes);
  }
  if (manifest.quotaPolicy.maxRawDocumentBytes !== null) {
    const usage = await knowledgeSpaceQuotaUsageReader.read({
      knowledgeSpaceId,
      projectionVersion: projectionVersionFromManifest(manifest.projectionSetVersion),
    });
    if (usage.truncated) throw new KnowledgeSpaceQuotaUsageTruncatedError();
    remaining.push(manifest.quotaPolicy.maxRawDocumentBytes - usage.rawDocumentBytes);
  }
  return remaining.length === 0 ? null : Math.max(0, Math.min(...remaining));
}

function projectionVersionFromManifest(projectionSetVersion: string): number {
  const match = /(?:^|[^0-9])v?([1-9][0-9]*)$/.exec(projectionSetVersion);

  return match ? Number(match[1]) : 1;
}

function isKnowledgeSpaceQuotaAdmissionError(
  error: unknown,
): error is KnowledgeSpaceQuotaExceededError | KnowledgeSpaceQuotaUsageTruncatedError {
  return (
    error instanceof KnowledgeSpaceQuotaExceededError ||
    error instanceof KnowledgeSpaceQuotaUsageTruncatedError
  );
}

class StagedObjectVerificationError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 2_000) : "Unknown error";
}

function bulkRuntimeExclusionReason(
  error: unknown,
  targeted: boolean,
): Extract<
  DocumentUploadExclusionReason,
  "document_not_found" | "invalid_target" | "processing_failed" | "revision_conflict"
> {
  if (!targeted) return "processing_failed";
  if (error instanceof LogicalDocumentConflictError) return "revision_conflict";
  // Permission-denied explicit targets are deliberately represented by the same concealed result.
  if (error instanceof LogicalDocumentNotFoundError) return "document_not_found";
  if (error instanceof LogicalDocumentValidationError) return "invalid_target";
  return "processing_failed";
}
