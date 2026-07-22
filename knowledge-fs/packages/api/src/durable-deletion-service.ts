import { createHash } from "node:crypto";

import type { AuthSubject } from "@knowledge/core";

import {
  candidatePermissionAllowsAsset,
  candidatePermissionScopeAllows,
} from "./candidate-content-authorization";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import {
  DurableDeletionCheckpointConflictError,
  DurableDeletionIdempotencyConflictError,
  type DurableDeletionJob,
  DurableDeletionNameChallengeMismatchError,
  DurableDeletionPermissionFenceError,
  type DurableDeletionPermissionProvenance,
  type DurableDeletionRepository,
  DurableDeletionTargetConflictError,
  DurableDeletionTargetRevisionConflictError,
  type LegacyDurableDeletionPermissionProvenance,
} from "./durable-deletion-repository";
import type {
  DurableBulkDeletionAcceptedResponse,
  DurableDeletionAcceptedResponse,
  DurableDeletionJobResponse,
} from "./durable-deletion-response-schemas";
import { DurableDeletionJobResponseSchema } from "./durable-deletion-response-schemas";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpaceApiKeyPermissionBinding,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
  knowledgeSpaceAccessChannelForCallerKind,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { LogicalDocumentRepository } from "./logical-document-repository";
import type { SourceRepository } from "./source-repository";

export interface DurableDeletionRequestPrincipal {
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly capability?:
    | {
        readonly contentScopeIds: readonly string[];
        readonly grantId: string;
      }
    | undefined;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly subject: AuthSubject;
}

export interface RequestKnowledgeSpaceDeletionCommand extends DurableDeletionRequestPrincipal {
  readonly challenge: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
}

export interface RequestSourceDeletionCommand extends DurableDeletionRequestPrincipal {
  readonly deleteMode: "cascade" | "keep";
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly sourceId: string;
}

export interface RequestDocumentDeletionCommand extends DurableDeletionRequestPrincipal {
  readonly documentId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
}

export interface RequestLogicalDocumentDeletionCommand extends DurableDeletionRequestPrincipal {
  readonly documentId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
}

export interface RequestBulkDocumentDeletionCommand extends DurableDeletionRequestPrincipal {
  readonly documents: readonly {
    readonly documentId: string;
    readonly expectedRevision: number;
  }[];
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
}

export interface GetDurableDeletionJobCommand extends DurableDeletionRequestPrincipal {
  readonly jobId: string;
}

export interface RetryDurableDeletionJobCommand extends GetDurableDeletionJobCommand {
  readonly idempotencyKey: string;
}

/** Handler-facing contract. Its implementation is backed only by DurableDeletionRepository. */
export interface DurableDeletionService {
  get(input: GetDurableDeletionJobCommand): Promise<DurableDeletionJobResponse | null>;
  requestBulkDocumentDeletion(
    input: RequestBulkDocumentDeletionCommand,
  ): Promise<DurableBulkDeletionAcceptedResponse>;
  requestDocumentDeletion(
    input: RequestDocumentDeletionCommand,
  ): Promise<DurableDeletionAcceptedResponse>;
  requestKnowledgeSpaceDeletion(
    input: RequestKnowledgeSpaceDeletionCommand,
  ): Promise<DurableDeletionAcceptedResponse>;
  requestSourceDeletion(
    input: RequestSourceDeletionCommand,
  ): Promise<DurableDeletionAcceptedResponse>;
  requestLogicalDocumentDeletion(
    input: RequestLogicalDocumentDeletionCommand,
  ): Promise<DurableDeletionAcceptedResponse>;
  retry(input: RetryDurableDeletionJobCommand): Promise<DurableDeletionAcceptedResponse | null>;
}

export type DurableDeletionServiceErrorCode =
  | "DURABLE_DELETION_CHALLENGE_MISMATCH"
  | "DURABLE_DELETION_FORBIDDEN"
  | "DURABLE_DELETION_IDEMPOTENCY_CONFLICT"
  | "DURABLE_DELETION_NOT_FOUND"
  | "DURABLE_DELETION_REVISION_CONFLICT"
  | "DURABLE_DELETION_STATE_CONFLICT"
  | "DURABLE_DELETION_UNAVAILABLE";

export class DurableDeletionServiceError extends Error {
  readonly code: DurableDeletionServiceErrorCode;

  constructor(code: DurableDeletionServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DurableDeletionServiceError";
    this.code = code;
  }
}

export interface CreateDurableDeletionServiceOptions {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "getActiveApiKeyById"
  >;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly logicalDocuments?: Pick<LogicalDocumentRepository, "get" | "listRevisions"> | undefined;
  readonly now?: (() => number) | undefined;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly repository: DurableDeletionRepository;
  readonly sources: Pick<SourceRepository, "get">;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

export function createDurableDeletionService({
  access,
  assets,
  authorization,
  logicalDocuments,
  now = Date.now,
  permissionSnapshotTtlMs = 60 * 60_000,
  repository,
  sources,
  spaces,
}: CreateDurableDeletionServiceOptions): DurableDeletionService {
  if (!Number.isSafeInteger(permissionSnapshotTtlMs) || permissionSnapshotTtlMs < 1) {
    throw new Error("Durable deletion permissionSnapshotTtlMs must be a positive integer");
  }

  const issuePermission = async (
    principal: DurableDeletionRequestPrincipal,
    knowledgeSpaceId: string,
    requiredAccess: "admin" | "write",
  ) => {
    try {
      const decision = await authorization.authorize({
        callerKind: principal.callerKind,
        knowledgeSpaceId,
        requiredAccess,
        subject: principal.subject,
      });
      const expiresAt = Math.min(
        now() + permissionSnapshotTtlMs,
        principal.apiKey?.expiresAt
          ? Date.parse(principal.apiKey.expiresAt)
          : Number.POSITIVE_INFINITY,
      );
      const permission = await issueKnowledgeSpaceDurablePermission({
        access,
        ...(principal.apiKey ? { apiKey: principal.apiKey } : {}),
        authorization,
        callerKind: principal.callerKind,
        expiresAt: new Date(expiresAt).toISOString(),
        knowledgeSpaceId,
        requiredAccess,
        subject: principal.subject,
      });
      return { decision, permission };
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        throw forbidden(error.message);
      }
      throw error;
    }
  };

  const authorizeRequest = async (
    principal: DurableDeletionRequestPrincipal,
    knowledgeSpaceId: string,
    requiredAccess: "admin" | "write",
  ) => {
    if (principal.capability) {
      return {
        candidateGrants: principal.capability.contentScopeIds,
        permission: undefined,
      };
    }
    const issued = await issuePermission(principal, knowledgeSpaceId, requiredAccess);
    return {
      candidateGrants: issued.decision.permissionSnapshot.candidateGrants,
      permission: issued.permission,
    };
  };

  const requestBase = (
    principal: DurableDeletionRequestPrincipal,
    idempotencyKey: string,
    knowledgeSpaceId: string,
    permission?: Awaited<ReturnType<typeof issuePermission>>["permission"],
  ): DurableDeletionPermissionProvenance & {
    readonly createdAt: string;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  } => {
    const authorization: DurableDeletionPermissionProvenance | undefined = principal.capability
      ? { capabilityGrantId: principal.capability.grantId }
      : permission
        ? permissionProvenance(principal, permission)
        : undefined;
    if (!authorization) {
      throw new DurableDeletionServiceError(
        "DURABLE_DELETION_FORBIDDEN",
        "Durable deletion authorization provenance is unavailable",
      );
    }
    return {
      ...authorization,
      createdAt: new Date(now()).toISOString(),
      idempotencyKey,
      knowledgeSpaceId,
      tenantId: principal.subject.tenantId,
    };
  };

  const permissionProvenance = (
    principal: DurableDeletionRequestPrincipal,
    permission: Awaited<ReturnType<typeof issuePermission>>["permission"],
  ): LegacyDurableDeletionPermissionProvenance => ({
    accessChannel: permission.accessChannel,
    ...(permission.apiKeyExpiresAt ? { apiKeyExpiresAt: permission.apiKeyExpiresAt } : {}),
    ...(permission.apiKeyId ? { apiKeyId: permission.apiKeyId } : {}),
    ...(permission.apiKeyRevision ? { apiKeyRevision: permission.apiKeyRevision } : {}),
    permissionSnapshotId: permission.id,
    permissionSnapshotRevision: permission.revision,
    requestedBySubjectId: principal.subject.subjectId,
  });

  const replayBase = (
    job: DurableDeletionJob,
  ): DurableDeletionPermissionProvenance & {
    readonly createdAt: string;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  } => {
    const authorization: DurableDeletionPermissionProvenance | undefined = job.capabilityGrantId
      ? { capabilityGrantId: job.capabilityGrantId }
      : job.accessChannel &&
          job.permissionSnapshotId &&
          job.permissionSnapshotRevision &&
          job.requestedBySubjectId
        ? {
            accessChannel: job.accessChannel,
            ...(job.apiKeyExpiresAt ? { apiKeyExpiresAt: job.apiKeyExpiresAt } : {}),
            ...(job.apiKeyId ? { apiKeyId: job.apiKeyId } : {}),
            ...(job.apiKeyRevision ? { apiKeyRevision: job.apiKeyRevision } : {}),
            permissionSnapshotId: job.permissionSnapshotId,
            permissionSnapshotRevision: job.permissionSnapshotRevision,
            requestedBySubjectId: job.requestedBySubjectId,
          }
        : undefined;
    if (!authorization) {
      throw new DurableDeletionServiceError(
        "DURABLE_DELETION_STATE_CONFLICT",
        "Deletion job authorization provenance is incomplete",
      );
    }
    return {
      ...authorization,
      createdAt: job.createdAt,
      idempotencyKey: job.idempotencyKey,
      knowledgeSpaceId: job.knowledgeSpaceId,
      tenantId: job.tenantId,
    };
  };

  const ensureSpace = async (
    principal: DurableDeletionRequestPrincipal,
    knowledgeSpaceId: string,
  ) => {
    const space = await spaces.get({
      id: knowledgeSpaceId,
      tenantId: principal.subject.tenantId,
    });
    if (!space) {
      throw notFound();
    }
    return space;
  };

  const authorizeJob = async (
    principal: DurableDeletionRequestPrincipal,
    job: DurableDeletionJob,
    requiredAccess: "read" | "write",
  ): Promise<boolean> => {
    if (job.capabilityGrantId) {
      return Boolean(
        principal.capability &&
          principal.capability.grantId === job.capabilityGrantId &&
          job.tenantId === principal.subject.tenantId,
      );
    }
    if (
      job.tenantId !== principal.subject.tenantId ||
      job.requestedBySubjectId !== principal.subject.subjectId ||
      job.accessChannel !== knowledgeSpaceAccessChannelForCallerKind(principal.callerKind)
    ) {
      return false;
    }
    if (
      (job.apiKeyId ?? undefined) !== (principal.apiKey?.id ?? undefined) ||
      (job.apiKeyRevision ?? undefined) !== (principal.apiKey?.revision ?? undefined) ||
      (job.apiKeyExpiresAt ?? undefined) !== (principal.apiKey?.expiresAt ?? undefined) ||
      (job.apiKeyExpiresAt !== undefined && Date.parse(job.apiKeyExpiresAt) <= now())
    ) {
      return false;
    }
    try {
      if (principal.apiKey) {
        const activeKey = await access.getActiveApiKeyById({
          id: principal.apiKey.id,
          knowledgeSpaceId: job.knowledgeSpaceId,
          tenantId: job.tenantId,
        });
        if (
          !activeKey ||
          activeKey.revision !== principal.apiKey.revision ||
          activeKey.principalSubjectId !== principal.subject.subjectId ||
          (activeKey.expiresAt ?? undefined) !== (principal.apiKey.expiresAt ?? undefined)
        ) {
          return false;
        }
      }
      // A parent-space completion atomically removes its ACL rows, including for previously
      // completed child deletions. The exact interactive requester may still read the terminal
      // audit/status record; non-terminal jobs always require current ACL.
      if (job.runState === "succeeded" && principal.callerKind === "interactive") {
        return true;
      }
      await authorization.authorize({
        callerKind: principal.callerKind,
        knowledgeSpaceId: job.knowledgeSpaceId,
        requiredAccess,
        subject: principal.subject,
      });
      return true;
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        return false;
      }
      throw error;
    }
  };

  /**
   * A deletion request must remain replayable after its target has entered `deleting`, and for a
   * space even after the primary row and ACL aggregate have been removed. Look up the durable
   * tenant-scoped idempotency ledger before any ordinary resource read. Exact requester/channel/
   * API-key authorization is still enforced here; the repository then recomputes the keyed
   * payload fingerprint so a reused key with a different target, revision, mode, or challenge is
   * rejected rather than replayed.
   */
  const findAuthorizedReplay = async (
    principal: DurableDeletionRequestPrincipal,
    idempotencyKey: string,
  ): Promise<DurableDeletionJob | null> => {
    const existing = await repository.getJobByIdempotency({
      idempotencyKey,
      tenantId: principal.subject.tenantId,
    });
    if (!existing) return null;
    if (!(await authorizeJob(principal, existing, "read"))) {
      throw conflict(
        "DURABLE_DELETION_IDEMPOTENCY_CONFLICT",
        "Deletion idempotency key is already bound to another request",
      );
    }
    return existing;
  };

  const authorizeRecordedRescueActor = async (
    principal: DurableDeletionRequestPrincipal,
    job: DurableDeletionJob,
  ): Promise<boolean> => {
    if (principal.callerKind !== "interactive" || principal.subject.tenantId !== job.tenantId) {
      return false;
    }
    const recorded = await repository.hasRetryAuditActor({
      jobId: job.id,
      subjectId: principal.subject.subjectId,
      tenantId: job.tenantId,
    });
    if (!recorded) return false;
    // Space completion removes its ACL aggregate. Mirror the terminal exact-requester rule for the
    // exact recorded rescuer; while work is non-terminal the actor must still be a current owner.
    if (job.runState === "succeeded") return true;
    try {
      await authorization.authorize({
        callerKind: principal.callerKind,
        knowledgeSpaceId: job.knowledgeSpaceId,
        requiredAccess: "admin",
        subject: principal.subject,
      });
      return true;
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) return false;
      throw error;
    }
  };

  const requestDocumentDeletion = async (
    input: RequestDocumentDeletionCommand & {
      readonly idempotencyContext?: string | undefined;
    },
  ): Promise<DurableDeletionAcceptedResponse> => {
    const replay = await findAuthorizedReplay(input, input.idempotencyKey);
    if (replay) {
      try {
        const result = await repository.requestDocumentDeletion({
          ...replayBase(replay),
          documentAssetId: input.documentId,
          expectedDocumentVersion: input.expectedRevision,
          ...(input.idempotencyContext === undefined
            ? {}
            : { idempotencyContext: input.idempotencyContext }),
          knowledgeSpaceId: input.knowledgeSpaceId,
        });
        return accepted(result.job);
      } catch (error) {
        throw mapRepositoryRequestError(error);
      }
    }
    await ensureSpace(input, input.knowledgeSpaceId);
    const { candidateGrants, permission } = await authorizeRequest(
      input,
      input.knowledgeSpaceId,
      "write",
    );
    const asset = await assets.get({
      id: input.documentId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });
    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      throw notFound();
    }
    try {
      const result = await repository.requestDocumentDeletion({
        ...requestBase(input, input.idempotencyKey, input.knowledgeSpaceId, permission),
        documentAssetId: input.documentId,
        expectedDocumentVersion: input.expectedRevision,
        ...(input.idempotencyContext === undefined
          ? {}
          : { idempotencyContext: input.idempotencyContext }),
      });
      return accepted(result.job);
    } catch (error) {
      throw mapRepositoryRequestError(error);
    }
  };

  const requestLogicalDocumentDeletion = async (
    input: RequestLogicalDocumentDeletionCommand,
  ): Promise<DurableDeletionAcceptedResponse> => {
    const replay = await findAuthorizedReplay(input, input.idempotencyKey);
    if (replay) {
      try {
        const result = await repository.requestLogicalDocumentDeletion({
          ...replayBase(replay),
          documentId: input.documentId,
          expectedDocumentRowVersion: input.expectedRevision,
          knowledgeSpaceId: input.knowledgeSpaceId,
        });
        return accepted(result.job);
      } catch (error) {
        throw mapRepositoryRequestError(error);
      }
    }
    await ensureSpace(input, input.knowledgeSpaceId);
    const { candidateGrants, permission } = await authorizeRequest(
      input,
      input.knowledgeSpaceId,
      "write",
    );
    if (!logicalDocuments) {
      throw new DurableDeletionServiceError(
        "DURABLE_DELETION_UNAVAILABLE",
        "Logical document deletion is unavailable",
      );
    }
    const logical = await logicalDocuments.get({
      documentId: input.documentId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.subject.tenantId,
    });
    if (!logical) throw notFound();
    const permissionRevision =
      logical.active ??
      (
        await logicalDocuments.listRevisions({
          candidateGrants,
          documentId: input.documentId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          limit: 1,
          tenantId: input.subject.tenantId,
        })
      ).items[0];
    if (!permissionRevision) throw notFound();
    const activeAsset = await assets.get({
      id: permissionRevision.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });
    if (
      !activeAsset ||
      activeAsset.version !== permissionRevision.documentAssetVersion ||
      !candidatePermissionAllowsAsset(activeAsset, candidateGrants)
    ) {
      throw notFound();
    }
    try {
      const result = await repository.requestLogicalDocumentDeletion({
        ...requestBase(input, input.idempotencyKey, input.knowledgeSpaceId, permission),
        documentId: input.documentId,
        expectedDocumentRowVersion: input.expectedRevision,
      });
      return accepted(result.job);
    } catch (error) {
      throw mapRepositoryRequestError(error);
    }
  };

  return {
    async get(input) {
      const job = await repository.getJob({
        id: input.jobId,
        tenantId: input.subject.tenantId,
      });
      if (!job) return null;
      if (
        !(await authorizeJob(input, job, "read")) &&
        !(await authorizeRecordedRescueActor(input, job))
      ) {
        return null;
      }
      return toPublicDurableDeletionJob(job);
    },
    async requestBulkDocumentDeletion(input) {
      const canonicalDocuments = [...input.documents].sort(
        (left, right) =>
          left.documentId.localeCompare(right.documentId) ||
          left.expectedRevision - right.expectedRevision,
      );
      const idempotencyContext = createHash("sha256")
        .update(JSON.stringify(canonicalDocuments))
        .digest("hex");
      const items = [];
      for (const [index, document] of canonicalDocuments.entries()) {
        const child = await requestDocumentDeletion({
          ...input,
          documentId: document.documentId,
          expectedRevision: document.expectedRevision,
          idempotencyContext,
          idempotencyKey: `${input.idempotencyKey}:${index}`,
        });
        items.push({ documentId: document.documentId, ...child });
      }
      return { items, total: items.length };
    },
    requestDocumentDeletion,
    requestLogicalDocumentDeletion,
    async requestKnowledgeSpaceDeletion(input) {
      if (!input.capability && input.callerKind !== "interactive") {
        throw forbidden("Knowledge space deletion requires an interactive owner");
      }
      const replay = await findAuthorizedReplay(input, input.idempotencyKey);
      if (replay) {
        try {
          const result = await repository.requestKnowledgeSpaceDeletion({
            ...replayBase(replay),
            expectedRevision: input.expectedRevision,
            knowledgeSpaceId: input.knowledgeSpaceId,
            nameChallenge: input.challenge,
          });
          return accepted(result.job);
        } catch (error) {
          throw mapRepositoryRequestError(error);
        }
      }
      const space = await ensureSpace(input, input.knowledgeSpaceId);
      const { permission } = await authorizeRequest(input, input.knowledgeSpaceId, "admin");
      if (input.challenge !== space.name) {
        throw conflict(
          "DURABLE_DELETION_CHALLENGE_MISMATCH",
          "Knowledge space deletion challenge does not match",
        );
      }
      try {
        const result = await repository.requestKnowledgeSpaceDeletion({
          ...requestBase(input, input.idempotencyKey, input.knowledgeSpaceId, permission),
          expectedRevision: input.expectedRevision,
          nameChallenge: input.challenge,
        });
        return accepted(result.job);
      } catch (error) {
        throw mapRepositoryRequestError(error);
      }
    },
    async requestSourceDeletion(input) {
      const replay = await findAuthorizedReplay(input, input.idempotencyKey);
      if (replay) {
        try {
          const result = await repository.requestSourceDeletion({
            ...replayBase(replay),
            deleteMode: input.deleteMode,
            expectedVersion: input.expectedRevision,
            knowledgeSpaceId: input.knowledgeSpaceId,
            sourceId: input.sourceId,
          });
          return accepted(result.job);
        } catch (error) {
          throw mapRepositoryRequestError(error);
        }
      }
      await ensureSpace(input, input.knowledgeSpaceId);
      const { candidateGrants, permission } = await authorizeRequest(
        input,
        input.knowledgeSpaceId,
        "write",
      );
      const source = await sources.get({
        id: input.sourceId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (!source || !candidatePermissionScopeAllows(source.permissionScope, candidateGrants)) {
        throw notFound();
      }
      try {
        const result = await repository.requestSourceDeletion({
          ...requestBase(input, input.idempotencyKey, input.knowledgeSpaceId, permission),
          deleteMode: input.deleteMode,
          expectedVersion: input.expectedRevision,
          sourceId: input.sourceId,
        });
        return accepted(result.job);
      } catch (error) {
        throw mapRepositoryRequestError(error);
      }
    },
    async retry(input) {
      const job = await repository.getJob({
        id: input.jobId,
        tenantId: input.subject.tenantId,
      });
      if (!job) {
        return null;
      }
      const isOriginalRequester = await authorizeJob(input, job, "write");
      if (job.capabilityGrantId && !isOriginalRequester) return null;
      let provenance: DurableDeletionPermissionProvenance;
      let retryAuthority: "interactive_owner_rescue" | "original_requester";
      try {
        if (job.capabilityGrantId && isOriginalRequester) {
          provenance = { capabilityGrantId: job.capabilityGrantId };
          retryAuthority = "original_requester";
        } else if (isOriginalRequester) {
          const issued = await issuePermission(input, job.knowledgeSpaceId, "write");
          provenance = permissionProvenance(input, issued.permission);
          retryAuthority = "original_requester";
        } else {
          // A failed job retains an active tombstone. If its requester was removed or its API key
          // was revoked, a current interactive owner must be able to rescue cleanup without
          // rewriting the immutable original requester audit on deletion_jobs.
          if (input.callerKind !== "interactive") return null;
          const issued = await issuePermission(input, job.knowledgeSpaceId, "admin");
          provenance = permissionProvenance(input, issued.permission);
          retryAuthority = "interactive_owner_rescue";
        }
      } catch (error) {
        if (
          error instanceof DurableDeletionServiceError &&
          error.code === "DURABLE_DELETION_FORBIDDEN"
        ) {
          return null;
        }
        throw error;
      }
      try {
        const result = await repository.retryFailedJob({
          ...provenance,
          expectedRowVersion: job.rowVersion,
          idempotencyKey: input.idempotencyKey,
          jobId: job.id,
          now: new Date(now()).toISOString(),
          requestFingerprint: job.requestFingerprint,
          retryAuthority,
          tenantId: job.tenantId,
        });
        return accepted(result.job);
      } catch (error) {
        throw mapRepositoryRequestError(error);
      }
    },
  };
}

/** Explicit public allow-list; durable authorization, lease, outbox and HMAC fields stay private. */
export function toPublicDurableDeletionJob(job: DurableDeletionJob): DurableDeletionJobResponse {
  const lastError = job.lastErrorCode ?? job.lastErrorMessage;
  return DurableDeletionJobResponseSchema.parse({
    checkpoint: job.checkpoint,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    ...(lastError
      ? {
          error: {
            code: job.lastErrorCode ?? "DURABLE_DELETION_FAILED",
            message: publicDurableDeletionErrorMessage(job),
            retryable: job.runState === "failed",
          },
        }
      : {}),
    id: job.id,
    knowledgeSpaceId: job.knowledgeSpaceId,
    mode: job.deleteMode,
    retryAt: job.retryAt,
    runState: job.runState === "succeeded" ? "completed" : job.runState,
    targetId: job.targetId,
    targetType: job.targetType === "document_asset" ? "document" : job.targetType,
    updatedAt: job.updatedAt,
  });
}

function publicDurableDeletionErrorMessage(
  job: Pick<DurableDeletionJob, "lastErrorCode" | "lastErrorMessage">,
): string {
  const code = job.lastErrorCode ?? "DURABLE_DELETION_FAILED";
  let message: string;
  switch (code) {
    case "DURABLE_DELETION_COOPERATIVE_WAIT":
      message = "Durable deletion is waiting for scoped work to drain";
      break;
    case "DURABLE_DELETION_COOPERATIVE_YIELD":
      message = "Durable deletion yielded after bounded progress";
      break;
    case "DURABLE_DELETION_ITEM_RETRY_WAIT":
      message = "Durable deletion is waiting to retry external cleanup";
      break;
    case "DURABLE_DELETION_ATTEMPTS_EXHAUSTED":
      message = "Durable deletion worker attempts were exhausted";
      break;
    default:
      if (code.includes("OUTBOX")) message = "Durable deletion dispatch failed";
      else if (
        code.includes("ITEM") ||
        code.includes("OBJECT") ||
        code.includes("SECRET") ||
        code.includes("CACHE")
      ) {
        message = "Durable deletion external cleanup failed";
      } else message = "Durable deletion processing failed";
  }
  // Only a keyed, fixed-width diagnostic correlation token may cross the API boundary. Historical
  // raw provider messages are deliberately ignored so rollout also closes pre-fix disclosure.
  const diagnostic = job.lastErrorMessage?.match(/\[diagnostic:([a-f0-9]{16})\]$/u)?.[1];
  return diagnostic ? `${message} [diagnostic:${diagnostic}]` : message;
}

export function durableDeletionStatusUrl(jobId: string): string {
  return `/deletion-jobs/${encodeURIComponent(jobId)}`;
}

function accepted(job: DurableDeletionJob): DurableDeletionAcceptedResponse {
  return {
    job: toPublicDurableDeletionJob(job),
    statusUrl: durableDeletionStatusUrl(job.id),
  };
}

function notFound(): DurableDeletionServiceError {
  return new DurableDeletionServiceError("DURABLE_DELETION_NOT_FOUND", "Deletion target not found");
}

function forbidden(message: string): DurableDeletionServiceError {
  return new DurableDeletionServiceError("DURABLE_DELETION_FORBIDDEN", message);
}

function conflict(
  code: Exclude<
    DurableDeletionServiceErrorCode,
    "DURABLE_DELETION_FORBIDDEN" | "DURABLE_DELETION_NOT_FOUND" | "DURABLE_DELETION_UNAVAILABLE"
  >,
  message: string,
  cause?: unknown,
): DurableDeletionServiceError {
  return new DurableDeletionServiceError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function mapRepositoryRequestError(error: unknown): unknown {
  if (
    error instanceof DurableDeletionPermissionFenceError ||
    (error instanceof KnowledgeSpaceAccessError &&
      error.code === "space_access_permission_snapshot_invalid")
  ) {
    return forbidden("Durable deletion permission is no longer valid");
  }
  if (error instanceof DurableDeletionNameChallengeMismatchError) {
    return conflict("DURABLE_DELETION_CHALLENGE_MISMATCH", error.message, error);
  }
  if (error instanceof DurableDeletionIdempotencyConflictError) {
    return conflict("DURABLE_DELETION_IDEMPOTENCY_CONFLICT", error.message, error);
  }
  if (error instanceof DurableDeletionTargetRevisionConflictError) {
    return conflict("DURABLE_DELETION_REVISION_CONFLICT", error.message, error);
  }
  if (error instanceof DurableDeletionTargetConflictError) {
    return conflict("DURABLE_DELETION_STATE_CONFLICT", error.message, error);
  }
  if (error instanceof DurableDeletionCheckpointConflictError) {
    return conflict("DURABLE_DELETION_STATE_CONFLICT", error.message, error);
  }
  return error;
}
