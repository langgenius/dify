import type { DocumentAsset } from "@knowledge/core";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import type { DurableDeletionRepository } from "./durable-deletion-repository";

import {
  type DocumentRevision,
  type LogicalDocument,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
} from "./logical-document-repository";
import { SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY } from "./source-document-workflow-ownership";
import type {
  PublishSourceLogicalRevisionInput,
  SourceLogicalRevisionPublicationExecution,
  SourceLogicalRevisionPublisher,
} from "./source-logical-revision-publisher";

/** The only supported I4 Source/provider -> I5 logical revision write boundary. */
export interface SourceLogicalDocumentVersionAdapter {
  append(input: {
    readonly asset: DocumentAsset;
    readonly now: string;
    readonly providerItemId: string;
    readonly sourceId: string;
    readonly systemMetadata: Readonly<Record<string, unknown>>;
    readonly tenantId: string;
  }): Promise<{ readonly document: LogicalDocument; readonly revision: DocumentRevision }>;
}

export function createSourceLogicalDocumentVersionAdapter(
  logicalDocuments: LogicalDocumentRepository | undefined,
): SourceLogicalDocumentVersionAdapter {
  return {
    append: async (input) => {
      if (!logicalDocuments) {
        throw new LogicalDocumentValidationError(
          "Logical document version repository is required for Source imports",
        );
      }
      return logicalDocuments.createCandidateRevision({
        contentHash: input.asset.sha256,
        documentAssetId: input.asset.id,
        documentAssetVersion: input.asset.version,
        knowledgeSpaceId: input.asset.knowledgeSpaceId,
        mimeType: input.asset.mimeType,
        now: input.now,
        providerItemId: input.providerItemId,
        sizeBytes: input.asset.sizeBytes,
        sourceId: input.sourceId,
        systemMetadata: {
          ...input.systemMetadata,
          provenance: {
            documentAssetId: input.asset.id,
            providerItemId: input.providerItemId,
            sourceId: input.sourceId,
          },
        },
        tenantId: input.tenantId,
        title: input.asset.filename,
        trustedInternalAdmission: true,
      });
    },
  };
}

/**
 * Required bridge into the existing 0006 compilation pipeline. Its implementation must call
 * publishDocumentCompilationCandidate with the supplied logical fence; the database publication
 * repository then advances both heads in one transaction.
 */
export interface SourceCompilationPublicationExecutor {
  publishAndWait(
    input: PublishSourceLogicalRevisionInput & {
      readonly assertActive?: (() => Promise<void>) | undefined;
      readonly bindCompilationAttempt: (attemptId: string) => Promise<void>;
      readonly logicalDocumentFence: {
        readonly documentId: string;
        readonly expectedActiveRevision: number | null;
        readonly expectedDocumentRowVersion: number;
        readonly revision: number;
      };
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<"published" | "unchanged">;
}

export function createSourceCompilationPublicationExecutor({
  compilationJobs,
  maxWaitMs = 10 * 60_000,
  pollIntervalMs = 250,
}: {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly maxWaitMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}): SourceCompilationPublicationExecutor {
  positiveDuration(maxWaitMs, "maxWaitMs");
  positiveDuration(pollIntervalMs, "pollIntervalMs");
  return {
    publishAndWait: async (input) => {
      if (!input.permissionSnapshot || !input.requestedBySubjectId) {
        throw new LogicalDocumentValidationError(
          "Source compilation requires a durable permission fence",
        );
      }
      throwIfAborted(input.signal);
      await input.assertActive?.();
      const compilation = await compilationJobs.start({
        ...(compilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        permissionSnapshot: input.permissionSnapshot,
        requestedBySubjectId: input.requestedBySubjectId,
        tenantId: input.tenantId,
        version: input.documentAssetVersion,
      });
      try {
        await input.bindCompilationAttempt(compilation.id);
        await compilationJobs.releaseDispatch?.(compilation.id);
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
          throwIfAborted(input.signal);
          await input.assertActive?.();
          const current = await compilationJobs.get(compilation.id);
          if (!current) {
            throw new LogicalDocumentValidationError("Source compilation attempt disappeared");
          }
          if (current.runState === "succeeded" && current.stage === "published") {
            return "published";
          }
          if (
            current.runState === "failed" ||
            current.runState === "canceled" ||
            current.runState === "superseded"
          ) {
            throw new LogicalDocumentValidationError(
              `Source compilation terminated as ${current.runState}`,
            );
          }
          await cancellableDelay(pollIntervalMs, input.signal);
        }
        throw new LogicalDocumentValidationError("Source compilation publication timed out");
      } catch (error) {
        await compilationJobs
          .cancel(compilation.id, "Source publication wait aborted")
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

export function createJointCasSourceLogicalRevisionPublisher({
  compilationPublication,
  logicalDocuments,
  now = () => new Date().toISOString(),
  remoteDeletions,
}: {
  readonly compilationPublication: SourceCompilationPublicationExecutor | undefined;
  readonly logicalDocuments: LogicalDocumentRepository | undefined;
  readonly now?: (() => string) | undefined;
  readonly remoteDeletions?:
    | Pick<DurableDeletionRepository, "requestDocumentDeletion" | "requestLogicalDocumentDeletion">
    | undefined;
}): SourceLogicalRevisionPublisher {
  if (!logicalDocuments || !compilationPublication) {
    throw new Error(
      "Source logical revision publishing requires logical documents and compilation publication",
    );
  }
  return {
    publish: async (input, execution: SourceLogicalRevisionPublicationExecution = {}) => {
      throwIfAborted(execution.signal);
      await execution.assertActive?.();
      if (!input.permissionSnapshot || !input.requestedBySubjectId) {
        throw new LogicalDocumentValidationError(
          "Source logical revision requires a durable permission fence",
        );
      }
      const created = await logicalDocuments.createCandidateRevision({
        contentHash: input.contentHash,
        documentAssetId: input.documentAssetId,
        documentAssetVersion: input.documentAssetVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mimeType: input.mimeType,
        now: now(),
        permissionSnapshot: input.permissionSnapshot,
        providerItemId: input.providerItemId,
        requestedBySubjectId: input.requestedBySubjectId,
        sizeBytes: input.sizeBytes,
        sourceId: input.sourceId,
        systemMetadata: {
          ...(input.etag ? { etag: input.etag } : {}),
          ...(input.materializationOwnership
            ? {
                [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: {
                  ...input.materializationOwnership,
                },
              }
            : {}),
          provenance: {
            providerKind: input.providerKind,
            providerItemId: input.providerItemId,
            remoteDeletionPolicy: input.remoteDeletionPolicy,
            sourceId: input.sourceId,
          },
        },
        tenantId: input.tenantId,
        title: input.title,
      });
      try {
        throwIfAborted(execution.signal);
        await execution.assertActive?.();
      } catch (error) {
        await retireFailedSourceCandidate({
          input,
          logicalDocuments,
          now: now(),
          remoteDeletions,
          revision: created.revision,
        });
        throw error;
      }
      const existing = await logicalDocuments.get({
        documentId: created.document.id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      if (created.revision.state === "active") {
        if (
          existing?.activeRevision === created.revision.revision &&
          existing.active?.documentAssetId === input.documentAssetId &&
          existing.active.documentAssetVersion === input.documentAssetVersion
        ) {
          return {
            documentId: existing.id,
            kind: "activated",
            revision: existing.activeRevision,
          };
        }
        throw new LogicalDocumentValidationError(
          "Retried Source asset is no longer the active logical revision",
        );
      }
      if (
        created.revision.state === "candidate" &&
        existing?.active &&
        existing.active.contentHash === input.contentHash
      ) {
        const discarded = await logicalDocuments.discardUnboundCandidate({
          documentAssetId: created.revision.documentAssetId,
          documentAssetVersion: created.revision.documentAssetVersion,
          documentId: created.document.id,
          knowledgeSpaceId: input.knowledgeSpaceId,
          revision: created.revision.revision,
          tenantId: input.tenantId,
        });
        if (!discarded) {
          await failCandidateIfPending(logicalDocuments, created.revision, now());
          await scheduleFailedMaterializationCleanup({
            input,
            logicalDocuments,
            now: now(),
            remoteDeletions,
            revision: created.revision,
          });
          throw new LogicalDocumentValidationError(
            "Unchanged Source candidate lost its compensation fence",
          );
        }
        return {
          documentId: existing.id,
          kind: "unchanged",
          revision: existing.active.revision,
        };
      }
      if (created.revision.state !== "candidate") {
        if (created.revision.state === "failed") {
          await scheduleFailedMaterializationCleanup({
            input,
            logicalDocuments,
            now: now(),
            remoteDeletions,
            revision: created.revision,
          });
        }
        throw new LogicalDocumentValidationError(
          "Retried Source asset is bound to a terminal logical revision",
        );
      }
      const logicalDocumentFence = {
        documentId: created.document.id,
        expectedActiveRevision: created.revision.expectedActiveRevision,
        expectedDocumentRowVersion: created.revision.expectedDocumentRowVersion,
        revision: created.revision.revision,
      };
      let boundAttemptId: string | undefined;
      let outcome: "published" | "unchanged";
      try {
        outcome = await compilationPublication.publishAndWait({
          ...input,
          ...(execution.assertActive ? { assertActive: execution.assertActive } : {}),
          bindCompilationAttempt: async (attemptId) => {
            throwIfAborted(execution.signal);
            await execution.assertActive?.();
            await logicalDocuments.bindCompilationAttempt({
              attemptId,
              documentId: created.document.id,
              knowledgeSpaceId: input.knowledgeSpaceId,
              revision: created.revision.revision,
              tenantId: input.tenantId,
            });
            boundAttemptId = attemptId;
          },
          logicalDocumentFence,
          ...(execution.signal ? { signal: execution.signal } : {}),
        });
      } catch (error) {
        await retireFailedSourceCandidate({
          input,
          logicalDocuments,
          now: now(),
          remoteDeletions,
          revision: created.revision,
        });
        throw error;
      }
      try {
        throwIfAborted(execution.signal);
        await execution.assertActive?.();
      } catch (error) {
        await retireFailedSourceCandidate({
          input,
          logicalDocuments,
          now: now(),
          remoteDeletions,
          revision: created.revision,
        });
        throw error;
      }
      const committed = await logicalDocuments.get({
        documentId: created.document.id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      if (outcome === "published") {
        if (!boundAttemptId) {
          await retireFailedSourceCandidate({
            input,
            logicalDocuments,
            now: now(),
            remoteDeletions,
            revision: created.revision,
          });
          throw new LogicalDocumentValidationError(
            "Compilation publication did not bind its durable attempt",
          );
        }
        if (
          !committed ||
          committed.activeRevision !== created.revision.revision ||
          committed.active?.documentAssetId !== input.documentAssetId ||
          committed.active.documentAssetVersion !== input.documentAssetVersion
        ) {
          await retireFailedSourceCandidate({
            input,
            logicalDocuments,
            now: now(),
            remoteDeletions,
            revision: created.revision,
          });
          throw new LogicalDocumentValidationError(
            "Compilation publication did not jointly activate the logical revision",
          );
        }
        return {
          documentId: committed.id,
          kind: "activated",
          revision: committed.activeRevision,
        };
      }
      if (!committed?.active) {
        await retireFailedSourceCandidate({
          input,
          logicalDocuments,
          now: now(),
          remoteDeletions,
          revision: created.revision,
        });
        throw new LogicalDocumentValidationError(
          "Unchanged Source revision has no active logical document revision",
        );
      }
      if (committed.active.contentHash !== input.contentHash) {
        await retireFailedSourceCandidate({
          input,
          logicalDocuments,
          now: now(),
          remoteDeletions,
          revision: created.revision,
        });
        throw new LogicalDocumentValidationError(
          "Unchanged Source revision does not match the active content hash",
        );
      }
      await retireFailedSourceCandidate({
        input,
        logicalDocuments,
        now: now(),
        remoteDeletions,
        revision: created.revision,
      });
      return {
        documentId: committed.id,
        kind: "unchanged",
        revision: committed.active.revision,
      };
    },
    markRemoteMissing: async (input, execution = {}) => {
      if (input.policy === "retain") return;
      if (!remoteDeletions) {
        throw new LogicalDocumentValidationError(
          "Durable logical document deletion is required for remote tombstones",
        );
      }
      throwIfAborted(execution.signal);
      await execution.assertActive?.();
      const document = await logicalDocuments.get({
        documentId: input.documentId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      if (!document) return;
      if (document.status === "deleting") return;
      if (
        document.sourceId !== input.sourceId ||
        document.providerItemId !== input.providerItemId
      ) {
        throw new LogicalDocumentValidationError(
          "Remote tombstone identity no longer matches the logical document",
        );
      }
      await remoteDeletions.requestLogicalDocumentDeletion({
        accessChannel: input.permissionSnapshot.accessChannel,
        createdAt: input.now,
        documentId: input.documentId,
        expectedDocumentRowVersion: document.rowVersion,
        idempotencyKey: `source-remote-missing:${input.sourceId}:${input.documentId}`,
        knowledgeSpaceId: input.knowledgeSpaceId,
        permissionSnapshotId: input.permissionSnapshot.id,
        permissionSnapshotRevision: input.permissionSnapshot.revision,
        requestedBySubjectId: input.requestedBySubjectId,
        tenantId: input.tenantId,
      });
      throwIfAborted(execution.signal);
      await execution.assertActive?.();
    },
  };
}

async function failCandidateIfPending(
  logicalDocuments: LogicalDocumentRepository,
  revision: DocumentRevision,
  now: string,
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
      now,
      revision: revision.revision,
      tenantId: revision.tenantId,
    });
  }
}

async function discardCandidateIfUnbound(
  logicalDocuments: LogicalDocumentRepository,
  revision: DocumentRevision,
): Promise<boolean> {
  return logicalDocuments.discardUnboundCandidate({
    documentAssetId: revision.documentAssetId,
    documentAssetVersion: revision.documentAssetVersion,
    documentId: revision.documentId,
    knowledgeSpaceId: revision.knowledgeSpaceId,
    revision: revision.revision,
    tenantId: revision.tenantId,
  });
}

async function retireFailedSourceCandidate(input: {
  readonly input: PublishSourceLogicalRevisionInput;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly now: string;
  readonly remoteDeletions: Pick<DurableDeletionRepository, "requestDocumentDeletion"> | undefined;
  readonly revision: DocumentRevision;
}): Promise<void> {
  // An unbound candidate has no compilation side effects and can be rolled back synchronously.
  // Once bound, the durable deletion ledger owns all exact physical/derived cleanup instead.
  if (await discardCandidateIfUnbound(input.logicalDocuments, input.revision)) return;
  await failCandidateIfPending(input.logicalDocuments, input.revision, input.now);
  await scheduleFailedMaterializationCleanup(input);
}

async function scheduleFailedMaterializationCleanup(input: {
  readonly input: PublishSourceLogicalRevisionInput;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly now: string;
  readonly remoteDeletions: Pick<DurableDeletionRepository, "requestDocumentDeletion"> | undefined;
  readonly revision: DocumentRevision;
}): Promise<void> {
  const current = await input.logicalDocuments.getRevision({
    documentId: input.revision.documentId,
    knowledgeSpaceId: input.revision.knowledgeSpaceId,
    revision: input.revision.revision,
    tenantId: input.revision.tenantId,
  });
  // Publication ACK uncertainty is resolved from committed state. An active/superseded revision
  // is published history and must never be converted into physical cleanup.
  if (!current || current.state !== "failed") return;
  const ownership = input.input.materializationOwnership;
  if (!ownership) {
    throw new LogicalDocumentValidationError(
      "Failed Source materialization has no durable run ownership proof",
    );
  }
  if (!input.remoteDeletions) {
    throw new LogicalDocumentValidationError(
      "Durable document cleanup is required for failed Source materialization",
    );
  }
  const eligible = await input.logicalDocuments.isFailedSourceRevisionCleanupEligible({
    documentAssetId: current.documentAssetId,
    documentAssetVersion: current.documentAssetVersion,
    documentId: current.documentId,
    knowledgeSpaceId: current.knowledgeSpaceId,
    ownership,
    revision: current.revision,
    sourceId: input.input.sourceId,
    tenantId: current.tenantId,
  });
  if (!eligible) {
    throw new LogicalDocumentValidationError(
      "Failed Source materialization did not satisfy exact durable cleanup ownership",
    );
  }
  const permission = input.input.permissionSnapshot;
  const requestedBySubjectId = input.input.requestedBySubjectId;
  if (!permission || !requestedBySubjectId) {
    throw new LogicalDocumentValidationError(
      "Failed Source materialization cleanup has no durable permission provenance",
    );
  }
  await input.remoteDeletions.requestDocumentDeletion({
    accessChannel: permission.accessChannel,
    createdAt: input.now,
    documentAssetId: current.documentAssetId,
    expectedDocumentVersion: current.documentAssetVersion,
    failedSourceMaterialization: {
      documentId: current.documentId,
      ownership,
      revision: current.revision,
      sourceId: input.input.sourceId,
    },
    idempotencyKey: `source-failed-materialization:${ownership.runId}:${current.documentAssetId}:${current.documentAssetVersion}`,
    knowledgeSpaceId: current.knowledgeSpaceId,
    permissionSnapshotId: permission.id,
    permissionSnapshotRevision: permission.revision,
    requestedBySubjectId,
    tenantId: current.tenantId,
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Source publication aborted");
  }
}

function positiveDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
}

async function cancellableDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error ? signal.reason : new Error("Source publication aborted"),
      );
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
