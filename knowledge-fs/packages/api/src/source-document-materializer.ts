import type { DocumentAsset } from "@knowledge/core";

import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
} from "./deletion-lifecycle-fence";
import {
  type DeletionObjectWriteAdmission,
  DeletionObjectWriteAdmissionError,
} from "./deletion-object-write-admission";
import { createDeletionAdmittedObjectStorage } from "./deletion-object-write-storage";
import type { DocumentAssetRepository } from "./document-asset-repository";
import {
  type CompileDocumentArtifactDeps,
  compileDocumentArtifact,
} from "./document-compilation-pipeline";
import { sha256Hex } from "./document-upload-utils";
import {
  type LegacySpacePublicationBootstrapRepository,
  withKnowledgeSpaceDocumentMutationLease,
} from "./legacy-space-publication-bootstrap";
import {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  type SourceDocumentStaleWriteScrubber,
  type SourceDocumentWorkflowOwnership,
  createSourceWorkflowDocumentAssetId,
} from "./source-document-stale-write-scrubber";
import { safeSourceOperationError } from "./source-operation-error";
import { createDocumentObjectKey } from "./storage-path-utils";

/** A source-provided document to materialize (a crawled page's markdown, a downloaded file, …). */
export interface SourceDocumentInput {
  readonly body: Uint8Array;
  readonly filename: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly mimeType: string;
}

export interface MaterializeSourceDocumentsInput {
  readonly documents: readonly SourceDocumentInput[];
  readonly knowledgeSpaceId: string;
  readonly permissionScope: readonly string[];
  readonly sourceId: string;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
  readonly workflowExecution?:
    | {
        readonly assertActive: () => Promise<void>;
        readonly items: readonly SourceDocumentWorkflowOwnership[];
        readonly signal: AbortSignal;
      }
    | undefined;
}

export interface MaterializedSourceDocument {
  readonly documentAssetVersion: number;
  readonly documentAssetId: string;
  readonly filename: string;
  readonly mimeType: string;
  /** Internal exact-compensation proof; never exposed by Source response schemas. */
  readonly objectKey?: string | undefined;
  readonly sizeBytes: number;
  /** Internal exact-compensation proof; never exposed by Source response schemas. */
  readonly workflowOwnership?: SourceDocumentWorkflowOwnership | undefined;
}

export interface FailedSourceDocument {
  readonly code: string;
  readonly error: string;
  readonly filename: string;
}

export interface MaterializeSourceDocumentsResult {
  readonly documents: readonly MaterializedSourceDocument[];
  readonly failed: readonly FailedSourceDocument[];
}

export interface SourceDocumentMaterializerDeps extends CompileDocumentArtifactDeps {
  readonly assets: DocumentAssetRepository;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly documentMutationAdmissionGuard?:
    | Pick<
        LegacySpacePublicationBootstrapRepository,
        "acquireDocumentMutationLease" | "releaseDocumentMutationLease"
      >
    | undefined;
  readonly generateDocumentAssetId: () => string;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly staleWriteScrubber?: SourceDocumentStaleWriteScrubber | undefined;
}

export interface SourceDocumentMaterializer {
  materialize(input: MaterializeSourceDocumentsInput): Promise<MaterializeSourceDocumentsResult>;
  compensate(input: {
    readonly documents: readonly MaterializedSourceDocument[];
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<void>;
}

/**
 * Materializes source-provided documents (crawled pages, imported Notion pages, …) into the same
 * pipeline uploads use: store the bytes, create a `DocumentAsset` (carrying `sourceId` + provenance
 * metadata), then run the shared synchronous compile (parse → projections → segments). Per-document
 * failures are isolated: the asset's parser status is marked failed and the document is reported in
 * `failed` rather than aborting the whole batch.
 */
export function createSourceDocumentMaterializer(
  deps: SourceDocumentMaterializerDeps,
): SourceDocumentMaterializer {
  const compensate: SourceDocumentMaterializer["compensate"] = async ({
    documents,
    knowledgeSpaceId,
    sourceId,
    tenantId,
  }) => {
    for (const document of documents) {
      if (!document.objectKey || !document.workflowOwnership || !deps.staleWriteScrubber) {
        throw new Error("Source workflow compensation ownership proof is unavailable");
      }
      await deps.staleWriteScrubber.scrubOwned({
        documentAssetId: document.documentAssetId,
        expectedVersion: document.documentAssetVersion,
        knowledgeSpaceId,
        objectKey: document.objectKey,
        ownership: document.workflowOwnership,
        sourceId,
        tenantId,
      });
    }
  };

  return {
    compensate,
    materialize: async ({
      documents,
      knowledgeSpaceId,
      permissionScope,
      sourceId,
      tenantId,
      traceId,
      workflowExecution,
    }) => {
      if (workflowExecution && workflowExecution.items.length !== documents.length) {
        throw new Error("Source workflow ownership batch does not match materialization batch");
      }
      const assertWorkflowActive = async (): Promise<void> => {
        throwIfAborted(workflowExecution?.signal);
        await workflowExecution?.assertActive();
        throwIfAborted(workflowExecution?.signal);
      };
      await assertWorkflowActive();
      await deps.deletionFence?.captureDeletionFence({
        knowledgeSpaceId,
        sourceId,
        tenantId,
      });
      return withKnowledgeSpaceDocumentMutationLease({
        acquiredAt: deps.now(),
        knowledgeSpaceId,
        operation: "source-materialize",
        repository: deps.documentMutationAdmissionGuard,
        tenantId,
        mutate: async () => {
          const admittedObjectStorage = createDeletionAdmittedObjectStorage({
            admission: deps.objectWriteAdmission,
            objectStorage: deps.objectStorage,
            scope: { knowledgeSpaceId, tenantId },
          });
          const materialized: MaterializedSourceDocument[] = [];
          const failed: FailedSourceDocument[] = [];
          const compileTraceId = traceId ?? "source-document-materialize";

          for (const [index, document] of documents.entries()) {
            const ownership = workflowExecution?.items[index];
            const body = document.body;
            const sha256 = await sha256Hex(body);
            if (ownership && ownership.contentHash !== sha256) {
              throw new Error(
                "Source workflow ownership content hash changed before materialization",
              );
            }
            const id = ownership
              ? createSourceWorkflowDocumentAssetId(ownership)
              : deps.generateDocumentAssetId();
            const deletionToken = await deps.deletionFence?.captureDeletionFence({
              documentAssetId: id,
              knowledgeSpaceId,
              sourceId,
              tenantId,
            });
            const assertWritable = async (): Promise<void> => {
              await assertWorkflowActive();
              if (deletionToken) {
                await deps.deletionFence?.assertDeletionFenceUnchanged(deletionToken);
              }
              await assertWorkflowActive();
            };
            const objectKey = createDocumentObjectKey({
              assetId: id,
              filename: document.filename,
              knowledgeSpaceId,
              tenantId,
            });

            try {
              await assertWritable();
              // Persist the source-owned pending asset before the external object write. This is
              // the durable ownership ledger for the crash window between putObject and the next
              // fence check: deletion can always rediscover the document prefix from sourceId.
              let asset = ownership
                ? await deps.assets.getForDeletion({ id, knowledgeSpaceId })
                : null;
              if (asset) {
                assertOwnedAssetMatches(asset, {
                  filename: document.filename,
                  mimeType: document.mimeType,
                  objectKey,
                  ownership,
                  sha256,
                  sizeBytes: body.byteLength,
                  sourceId,
                  tenantId,
                });
              } else {
                asset = await deps.assets.create({
                  filename: document.filename,
                  id,
                  knowledgeSpaceId,
                  metadata: {
                    ...(document.metadata ?? {}),
                    permissionScope: [...permissionScope],
                    tenantId,
                    ...(ownership
                      ? { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: { ...ownership } }
                      : {}),
                  },
                  mimeType: document.mimeType,
                  objectKey,
                  sha256,
                  sizeBytes: body.byteLength,
                  sourceId,
                  tenantId,
                });
              }
              await assertWritable();
              await admittedObjectStorage.putObject({
                body,
                contentType: document.mimeType,
                key: objectKey,
                metadata: {
                  assetId: id,
                  knowledgeSpaceId,
                  sha256,
                  tenantId,
                  ...(ownership ? { sourceWorkflowRunId: ownership.runId } : {}),
                },
              });
              await assertWritable();
              // Durable Source workflows compile through the publication job. Running the legacy
              // synchronous compiler here would create unleased side effects after a workflow
              // timeout and duplicate every projection write.
              if (!workflowExecution) {
                await compileDocumentArtifact(
                  {
                    asset,
                    body,
                    knowledgeSpaceId,
                    permissionScope,
                    tenantId,
                    traceId: compileTraceId,
                  },
                  { ...deps, objectStorage: admittedObjectStorage },
                );
                await assertWritable();
                await deps.assets.updateParserStatus({
                  id: asset.id,
                  knowledgeSpaceId,
                  parserStatus: "parsed",
                });
              }
              await assertWritable();

              materialized.push({
                documentAssetId: asset.id,
                documentAssetVersion: asset.version,
                filename: asset.filename,
                mimeType: asset.mimeType,
                ...(ownership ? { objectKey, workflowOwnership: ownership } : {}),
                sizeBytes: asset.sizeBytes,
              });
            } catch (error) {
              let effectiveError = error;
              if (!ownership && !isDeletionWriteBlocked(effectiveError)) {
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
              if (ownership) {
                await compensate({
                  documents: [
                    {
                      documentAssetId: id,
                      documentAssetVersion: 1,
                      filename: document.filename,
                      mimeType: document.mimeType,
                      objectKey,
                      sizeBytes: body.byteLength,
                      workflowOwnership: ownership,
                    },
                  ],
                  knowledgeSpaceId,
                  sourceId,
                  tenantId,
                });
                if (workflowExecution?.signal.aborted) {
                  throw abortReason(workflowExecution.signal);
                }
                try {
                  await assertWorkflowActive();
                } catch {
                  throw effectiveError;
                }
              } else if (isDeletionWriteBlocked(effectiveError)) {
                await scrubStaleSourceDocumentWrite(deps, {
                  documentAssetId: id,
                  expectedVersion: 1,
                  knowledgeSpaceId,
                  objectKey,
                  sourceId,
                  tenantId,
                });
                throw effectiveError;
              }
              if (!ownership) {
                await deps.assets
                  .updateParserStatus({ id, knowledgeSpaceId, parserStatus: "failed" })
                  .catch(() => undefined);
              }
              const failure = safeSourceOperationError("documentMaterialization", effectiveError);
              failed.push({
                code: failure.code,
                error: failure.message,
                filename: document.filename,
              });
            }
          }

          return { documents: materialized, failed };
        },
      });
    },
  };
}

function isDeletionWriteBlocked(error: unknown): boolean {
  return (
    error instanceof DeletionLifecycleFenceActiveError ||
    error instanceof DeletionObjectWriteAdmissionError
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Source workflow materialization was aborted");
}

function assertOwnedAssetMatches(
  asset: DocumentAsset,
  expected: {
    readonly filename: string;
    readonly mimeType: string;
    readonly objectKey: string;
    readonly ownership: SourceDocumentWorkflowOwnership | undefined;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly sourceId: string;
    readonly tenantId: string;
  },
): void {
  const ownership = asset.metadata[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY];
  const proof =
    ownership && typeof ownership === "object" && !Array.isArray(ownership)
      ? (ownership as Record<string, unknown>)
      : undefined;
  if (
    !expected.ownership ||
    asset.filename !== expected.filename ||
    asset.mimeType !== expected.mimeType ||
    asset.objectKey !== expected.objectKey ||
    asset.sha256 !== expected.sha256 ||
    asset.sizeBytes !== expected.sizeBytes ||
    asset.sourceId !== expected.sourceId ||
    (typeof asset.metadata.tenantId === "string" &&
      asset.metadata.tenantId !== expected.tenantId) ||
    proof?.runId !== expected.ownership.runId ||
    proof?.itemKey !== expected.ownership.itemKey ||
    proof?.contentHash !== expected.ownership.contentHash
  ) {
    throw new Error("Source workflow asset id is already owned by different immutable content");
  }
}

async function scrubStaleSourceDocumentWrite(
  deps: SourceDocumentMaterializerDeps,
  input: {
    readonly documentAssetId: string;
    readonly expectedVersion: number;
    readonly knowledgeSpaceId: string;
    readonly objectKey: string;
    readonly sourceId: string;
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
    throw new AggregateError(errors, "Failed to scrub stale source document writes");
  }
}
