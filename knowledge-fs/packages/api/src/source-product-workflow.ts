import { createHash, randomUUID } from "node:crypto";

import type { AuthSubject, JobPayload, Source } from "@knowledge/core";

import {
  candidatePermissionScopeAllows,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
} from "./knowledge-space-access-control";
import type {
  KnowledgeSpaceAuthorizationGuard,
  KnowledgeSpaceCallerKind,
  KnowledgeSpaceRequiredAccess,
} from "./knowledge-space-authorization";
import {
  KnowledgeSpaceAuthorizationError,
  knowledgeSpaceAccessChannelForCallerKind,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type { SourceRepository } from "./source-repository";

export type SourceWorkflowKind =
  | "crawl-preview"
  | "crawl-import"
  | "online-document-import"
  | "online-drive-import"
  | "sync"
  | "bulk";

export type SourceWorkflowState =
  | "queued"
  | "running"
  | "crawling"
  | "preview_ready"
  | "importing"
  | "syncing"
  | "completed"
  | "zero_results"
  | "failed"
  | "canceled";

export type SourceWorkflowCheckpoint =
  | "queued"
  | "provider-read"
  | "preview-staged"
  | "selection-frozen"
  | "materialized"
  | "cleanup-staging"
  | "source-committed";

export interface SourceWorkflowRun {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly activeSlot?: number | undefined;
  readonly canceledAt?: string | undefined;
  readonly checkpoint: SourceWorkflowCheckpoint;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly cursor?: string | undefined;
  readonly executionAttempts: number;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly kind: SourceWorkflowKind;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly payload: Readonly<Record<string, JobPayload>>;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly progressCompleted: number;
  readonly progressFailed: number;
  readonly progressSkipped: number;
  readonly progressTotal?: number | undefined;
  readonly requestedBySubjectId: string;
  /** Frozen AND-scope of every source admitted into this operation. */
  readonly requiredPermissionScope: readonly string[];
  readonly rowVersion: number;
  readonly sourceId?: string | undefined;
  readonly state: SourceWorkflowState;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface SourceWorkflowFence {
  readonly leaseToken: string;
  readonly rowVersion: number;
  readonly runId: string;
  readonly workerId: string;
}

export type NewSourceWorkflowRun = Omit<
  SourceWorkflowRun,
  | "activeSlot"
  | "checkpoint"
  | "executionAttempts"
  | "progressCompleted"
  | "progressFailed"
  | "progressSkipped"
  | "rowVersion"
  | "state"
  | "updatedAt"
>;

export interface SourceCrawlPreviewPage {
  readonly contentHash: string;
  readonly contentObjectKey: string;
  readonly createdAt: string;
  readonly description?: string | undefined;
  readonly etag?: string | undefined;
  readonly id: string;
  readonly pageId: string;
  readonly runId: string;
  readonly sourceUrl: string;
  readonly title?: string | undefined;
}

export interface SourceWorkflowPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string | undefined;
}

export type SourceBulkAction = "sync" | "disable" | "remove";
export type SourceBulkItemStatus = "eligible" | "running" | "skipped" | "failed" | "completed";

export interface SourceBulkWorkflowItem {
  readonly action: SourceBulkAction;
  readonly childRunId?: string | undefined;
  /** Durable deletion job identity for remove items; never reported as a completed child early. */
  readonly deletionJobId?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly id: string;
  readonly reason?: string | undefined;
  readonly runId: string;
  readonly sourceId: string;
  readonly status: SourceBulkItemStatus;
  readonly updatedAt: string;
}

export type SourceRemoteDeletionPolicy = "retain" | "tombstone";

export interface SourceOnlineDocumentImportItem {
  readonly etag?: string | undefined;
  readonly lastEditedTime?: string | undefined;
  readonly name?: string | undefined;
  readonly pageId: string;
  readonly providerItemId: string;
  readonly type: string;
  readonly workspaceId: string;
}

export interface SourceOnlineDriveImportItem {
  readonly bucket?: string | undefined;
  readonly etag?: string | undefined;
  readonly id: string;
  readonly mimeType?: string | undefined;
  readonly name: string;
  readonly providerItemId: string;
}

export type SourceImportSelection = SourceOnlineDocumentImportItem | SourceOnlineDriveImportItem;

export interface SourceSyncPolicyRecord {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly createdAt: string;
  readonly customIntervalSeconds?: number | undefined;
  readonly enabled: boolean;
  readonly expectedSourceVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly mode: "provider" | "manual" | "interval" | "custom";
  readonly nextRunAt?: string | undefined;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly revision: number;
  readonly requestedBySubjectId: string;
  readonly requiredPermissionScope: readonly string[];
  readonly sourceId: string;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface SourceProductWorkflowRepository {
  /** Atomically binds an accepted durable deletion job and leaves the remove item running. */
  attachBulkRemovalJob(input: {
    readonly deletionJobId: string;
    readonly fence: SourceWorkflowFence;
    readonly itemId: string;
    readonly now: string;
    readonly runId: string;
  }): Promise<{
    readonly item: SourceBulkWorkflowItem;
    readonly parent: SourceWorkflowRun;
  }>;
  appendCrawlPages(input: {
    readonly fence: SourceWorkflowFence;
    readonly pages: readonly SourceCrawlPreviewPage[];
    readonly now: string;
  }): Promise<SourceWorkflowRun>;
  cancel(input: {
    readonly accessChannel: SourceWorkflowRun["accessChannel"];
    readonly now: string;
    readonly permissionSnapshotId: string;
    readonly permissionSnapshotRevision: number;
    readonly reason: string;
    readonly requestedBySubjectId: string;
    readonly runId: string;
  }): Promise<SourceWorkflowRun | null>;
  checkpoint(input: {
    readonly checkpoint: SourceWorkflowCheckpoint;
    readonly cursor?: string | null | undefined;
    readonly fence: SourceWorkflowFence;
    readonly now: string;
    readonly progressCompleted?: number | undefined;
    readonly progressFailed?: number | undefined;
    readonly progressSkipped?: number | undefined;
    readonly progressTotal?: number | null | undefined;
    readonly state: SourceWorkflowState;
  }): Promise<SourceWorkflowRun>;
  claim(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly SourceWorkflowRun[]>;
  complete(input: {
    readonly fence: SourceWorkflowFence;
    readonly now: string;
    readonly state?: "completed" | "preview_ready" | "zero_results" | undefined;
  }): Promise<SourceWorkflowRun>;
  /** Releases a bulk parent while its independently leased child runs are still active. */
  defer(input: {
    readonly availableAt: string;
    readonly fence: SourceWorkflowFence;
    readonly now: string;
  }): Promise<SourceWorkflowRun>;
  fail(input: {
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly fence: SourceWorkflowFence;
    readonly now: string;
  }): Promise<SourceWorkflowRun>;
  get(input: {
    readonly knowledgeSpaceId: string;
    readonly runId: string;
    readonly tenantId: string;
  }): Promise<SourceWorkflowRun | null>;
  heartbeat(input: {
    readonly fence: SourceWorkflowFence;
    readonly leaseExpiresAt: string;
    readonly now: string;
  }): Promise<SourceWorkflowRun>;
  listBulkItems(input: {
    readonly cursor?: string | undefined;
    readonly limit: number;
    readonly runId: string;
  }): Promise<SourceWorkflowPage<SourceBulkWorkflowItem>>;
  /** Public-result read with every requester, permission and candidate predicate before LIMIT. */
  listAuthorizedBulkItems(input: {
    readonly accessChannel: SourceWorkflowRun["accessChannel"];
    readonly candidateGrants: readonly string[];
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly permissionSnapshotId: string;
    readonly permissionSnapshotRevision: number;
    readonly requestedBySubjectId: string;
    readonly runId: string;
    readonly tenantId: string;
  }): Promise<SourceWorkflowPage<SourceBulkWorkflowItem>>;
  listCrawlPages(input: {
    readonly cursor?: string | undefined;
    readonly limit: number;
    readonly runId: string;
  }): Promise<SourceWorkflowPage<SourceCrawlPreviewPage>>;
  listRuns(input: {
    readonly candidateGrants: readonly string[];
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly sourceId?: string | undefined;
    readonly tenantId: string;
  }): Promise<SourceWorkflowPage<SourceWorkflowRun>>;
  markBulkItem(input: {
    readonly errorCode?: string | undefined;
    readonly fence: SourceWorkflowFence;
    readonly itemId: string;
    readonly now: string;
    readonly reason?: string | undefined;
    readonly runId: string;
    readonly status: Exclude<SourceBulkItemStatus, "eligible" | "running">;
  }): Promise<SourceBulkWorkflowItem>;
  retry(input: {
    readonly accessChannel: SourceWorkflowRun["accessChannel"];
    readonly now: string;
    readonly permissionSnapshotId: string;
    readonly permissionSnapshotRevision: number;
    readonly requestedBySubjectId: string;
    readonly runId: string;
  }): Promise<SourceWorkflowRun | null>;
  selectCrawlPages(input: {
    readonly accessChannel: SourceWorkflowRun["accessChannel"];
    readonly idempotencyKey: string;
    readonly now: string;
    readonly pageIds: readonly string[];
    readonly permissionSnapshotId: string;
    readonly permissionSnapshotRevision: number;
    readonly requestedBySubjectId: string;
    readonly runId: string;
  }): Promise<SourceWorkflowRun>;
  start(input: NewSourceWorkflowRun): Promise<SourceWorkflowRun>;
  /** Atomically makes the run, complete item set, and outbox claimable. */
  startBulk(input: {
    readonly items: readonly SourceBulkWorkflowItem[];
    readonly run: NewSourceWorkflowRun;
  }): Promise<SourceWorkflowRun>;
  upsertSyncPolicy(input: SourceSyncPolicyRecord): Promise<SourceSyncPolicyRecord>;
  listDueSyncPolicies(input: {
    readonly cursor?: string | undefined;
    readonly limit: number;
    readonly now: string;
  }): Promise<SourceWorkflowPage<SourceSyncPolicyRecord>>;
  getSyncPolicy(input: {
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<SourceSyncPolicyRecord | null>;
  /** Atomically locks due policies, advances their schedule, and inserts run + outbox. */
  enqueueDueSyncRuns(input: {
    readonly limit: number;
    readonly maxExecutionAttempts: number;
    readonly now: string;
  }): Promise<readonly SourceWorkflowRun[]>;
  /** Atomically freezes one bulk-sync item as running and enqueues its independent child run. */
  enqueueBulkSyncChild(input: {
    readonly fence: SourceWorkflowFence;
    readonly itemId: string;
    readonly now: string;
    readonly runId: string;
  }): Promise<{
    readonly child: SourceWorkflowRun;
    readonly item: SourceBulkWorkflowItem;
    readonly parent: SourceWorkflowRun;
  }>;
}

export interface SourceWorkflowPrincipal {
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly subject: AuthSubject;
}

export class SourceWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceWorkflowError";
  }
}

export interface SourceProductWorkflowService {
  cancel(
    input: SourceWorkflowPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly reason?: string | undefined;
      readonly runId: string;
    },
  ): Promise<SourceWorkflowRun | null>;
  createBulk(
    input: SourceWorkflowPrincipal & {
      readonly action: SourceBulkAction;
      readonly idempotencyKey: string;
      readonly knowledgeSpaceId: string;
      readonly sourceIds: readonly string[];
    },
  ): Promise<SourceWorkflowRun>;
  createImport(
    input: SourceWorkflowPrincipal & {
      readonly idempotencyKey: string;
      readonly items: readonly SourceImportSelection[];
      readonly knowledgeSpaceId: string;
      readonly kind: "online-document-import" | "online-drive-import";
      readonly sourceId: string;
    },
  ): Promise<SourceWorkflowRun>;
  createPreview(
    input: SourceWorkflowPrincipal & {
      readonly idempotencyKey: string;
      readonly knowledgeSpaceId: string;
      readonly sourceId: string;
    },
  ): Promise<SourceWorkflowRun>;
  createSync(
    input: SourceWorkflowPrincipal & {
      readonly idempotencyKey: string;
      readonly knowledgeSpaceId: string;
      readonly sourceId: string;
    },
  ): Promise<SourceWorkflowRun>;
  get(
    input: SourceWorkflowPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly runId: string;
    },
  ): Promise<SourceWorkflowRun | null>;
  list(
    input: SourceWorkflowPrincipal & {
      readonly cursor?: string | undefined;
      readonly knowledgeSpaceId: string;
      readonly limit: number;
      readonly sourceId?: string | undefined;
    },
  ): Promise<SourceWorkflowPage<SourceWorkflowRun>>;
  listBulkItems(
    input: SourceWorkflowPrincipal & {
      readonly cursor?: string | undefined;
      readonly knowledgeSpaceId: string;
      readonly limit: number;
      readonly runId: string;
    },
  ): Promise<SourceWorkflowPage<SourceBulkWorkflowItem> | null>;
  retry(
    input: SourceWorkflowPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly runId: string;
    },
  ): Promise<SourceWorkflowRun | null>;
  getSyncPolicy(
    input: SourceWorkflowPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly sourceId: string;
    },
  ): Promise<SourceSyncPolicyRecord | null>;
  putSyncPolicy(
    input: SourceWorkflowPrincipal & {
      readonly customIntervalSeconds?: number | undefined;
      readonly enabled: boolean;
      readonly expectedRevision: number;
      readonly expectedSourceVersion: number;
      readonly knowledgeSpaceId: string;
      readonly mode: SourceSyncPolicyRecord["mode"];
      readonly sourceId: string;
    },
  ): Promise<SourceSyncPolicyRecord>;
  selectCrawlPages(
    input: SourceWorkflowPrincipal & {
      readonly idempotencyKey: string;
      readonly knowledgeSpaceId: string;
      readonly pageIds: readonly string[];
      readonly runId: string;
    },
  ): Promise<SourceWorkflowRun>;
}

export function createSourceProductWorkflowService(input: {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "revalidatePermissionSnapshot"
  >;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly generateBulkItemId?: (() => string) | undefined;
  readonly generateRunId?: (() => string) | undefined;
  readonly maxBulkItems?: number | undefined;
  readonly maxExecutionAttempts?: number | undefined;
  readonly maxImportItems?: number | undefined;
  readonly now?: (() => string) | undefined;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly repository: SourceProductWorkflowRepository;
  readonly sources: Pick<SourceRepository, "get">;
}): SourceProductWorkflowService {
  const generateBulkItemId = input.generateBulkItemId ?? randomUUID;
  const generateRunId = input.generateRunId ?? randomUUID;
  const maxBulkItems = input.maxBulkItems ?? 200;
  const maxExecutionAttempts = input.maxExecutionAttempts ?? 5;
  const maxImportItems = input.maxImportItems ?? 200;
  const now = input.now ?? (() => new Date().toISOString());
  const permissionSnapshotTtlMs = input.permissionSnapshotTtlMs ?? 24 * 60 * 60_000;

  const authorize = (
    principal: SourceWorkflowPrincipal,
    knowledgeSpaceId: string,
    requiredAccess: KnowledgeSpaceRequiredAccess,
  ) =>
    input.authorization.authorize({
      callerKind: principal.callerKind,
      knowledgeSpaceId,
      requiredAccess,
      subject: principal.subject,
    });

  const requireSource = async (
    principal: SourceWorkflowPrincipal,
    knowledgeSpaceId: string,
    sourceId: string,
    requiredAccess: KnowledgeSpaceRequiredAccess,
  ) => {
    const decision = await authorize(principal, knowledgeSpaceId, requiredAccess);
    const source = await input.sources.get({ id: sourceId, knowledgeSpaceId });
    if (
      !source ||
      !candidatePermissionScopeAllows(
        source.permissionScope,
        decision.permissionSnapshot.candidateGrants,
      )
    ) {
      throw new SourceWorkflowError("SOURCE_NOT_FOUND", "Source not found");
    }
    return { decision, source };
  };

  const issuePermission = async (
    principal: SourceWorkflowPrincipal,
    knowledgeSpaceId: string,
    createdAt: string,
  ) =>
    issueKnowledgeSpaceDurablePermission({
      access: input.access,
      ...(principal.apiKey ? { apiKey: principal.apiKey } : {}),
      authorization: input.authorization,
      callerKind: principal.callerKind,
      expiresAt: new Date(Date.parse(createdAt) + permissionSnapshotTtlMs).toISOString(),
      knowledgeSpaceId,
      requiredAccess: "write",
      subject: principal.subject,
    });

  const prepare = async (
    principal: SourceWorkflowPrincipal,
    request: {
      idempotencyKey: string;
      knowledgeSpaceId: string;
      kind: SourceWorkflowKind;
      payload: Readonly<Record<string, JobPayload>>;
      progressTotal?: number;
      requiredPermissionScope: readonly string[];
      sourceId?: string;
    },
  ) => {
    const createdAt = now();
    const permission = await issuePermission(principal, request.knowledgeSpaceId, createdAt);
    return {
      accessChannel: permission.accessChannel,
      createdAt,
      id: generateRunId(),
      idempotencyKey: bounded(request.idempotencyKey, "idempotency key", 255),
      knowledgeSpaceId: request.knowledgeSpaceId,
      kind: request.kind,
      maxExecutionAttempts,
      payload: clonePayload(request.payload),
      ...(request.progressTotal === undefined ? {} : { progressTotal: request.progressTotal }),
      permissionSnapshotId: permission.id,
      permissionSnapshotRevision: permission.revision,
      requestedBySubjectId: principal.subject.subjectId,
      requiredPermissionScope: [...request.requiredPermissionScope],
      ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      tenantId: principal.subject.tenantId,
    } satisfies NewSourceWorkflowRun;
  };
  const start = async (
    principal: SourceWorkflowPrincipal,
    request: Parameters<typeof prepare>[1],
  ) => input.repository.start(await prepare(principal, request));

  const getAuthorized = async (
    principal: SourceWorkflowPrincipal,
    knowledgeSpaceId: string,
    runId: string,
    requiredAccess: KnowledgeSpaceRequiredAccess,
  ) => {
    const run = await input.repository.get({
      knowledgeSpaceId,
      runId,
      tenantId: principal.subject.tenantId,
    });
    if (!run) return null;
    const decision = await authorize(principal, knowledgeSpaceId, requiredAccess);
    if (
      !candidatePermissionScopeAllows(
        run.requiredPermissionScope,
        decision.permissionSnapshot.candidateGrants,
      )
    )
      return null;
    return { decision, run };
  };

  return {
    createPreview: async (request) => {
      const { source } = await requireSource(
        request,
        request.knowledgeSpaceId,
        request.sourceId,
        "write",
      );
      if (source.type !== "web") {
        throw new SourceWorkflowError(
          "SOURCE_CRAWL_TYPE_INVALID",
          "Source is not a website source",
        );
      }
      return start(request, {
        idempotencyKey: request.idempotencyKey,
        knowledgeSpaceId: request.knowledgeSpaceId,
        kind: "crawl-preview",
        payload: {},
        requiredPermissionScope: requiredSourceScope(source),
        sourceId: request.sourceId,
      });
    },
    createImport: async (request) => {
      const { source } = await requireSource(
        request,
        request.knowledgeSpaceId,
        request.sourceId,
        "write",
      );
      if (request.items.length < 1 || request.items.length > maxImportItems) {
        throw new SourceWorkflowError(
          "SOURCE_IMPORT_ITEMS_INVALID",
          `Import must contain 1-${maxImportItems} items`,
        );
      }
      const items = request.items.map((item) => sanitizeImportSelection(request.kind, item));
      return start(request, {
        idempotencyKey: request.idempotencyKey,
        knowledgeSpaceId: request.knowledgeSpaceId,
        kind: request.kind,
        payload: { items },
        progressTotal: items.length,
        requiredPermissionScope: requiredSourceScope(source),
        sourceId: request.sourceId,
      });
    },
    createSync: async (request) => {
      const { source } = await requireSource(
        request,
        request.knowledgeSpaceId,
        request.sourceId,
        "write",
      );
      return start(request, {
        idempotencyKey: request.idempotencyKey,
        knowledgeSpaceId: request.knowledgeSpaceId,
        kind: "sync",
        payload: {},
        requiredPermissionScope: requiredSourceScope(source),
        sourceId: request.sourceId,
      });
    },
    getSyncPolicy: async (request) => {
      await requireSource(request, request.knowledgeSpaceId, request.sourceId, "read");
      return input.repository.getSyncPolicy({
        knowledgeSpaceId: request.knowledgeSpaceId,
        sourceId: request.sourceId,
        tenantId: request.subject.tenantId,
      });
    },
    putSyncPolicy: async (request) => {
      const { source } = await requireSource(
        request,
        request.knowledgeSpaceId,
        request.sourceId,
        "write",
      );
      if (source.version !== request.expectedSourceVersion) {
        throw new SourceWorkflowError(
          "SOURCE_SYNC_POLICY_SOURCE_CONFLICT",
          "Source changed concurrently",
        );
      }
      validateSyncPolicyInput(request.mode, request.enabled, request.customIntervalSeconds);
      const prior = await input.repository.getSyncPolicy({
        knowledgeSpaceId: request.knowledgeSpaceId,
        sourceId: request.sourceId,
        tenantId: request.subject.tenantId,
      });
      if ((prior?.revision ?? 0) !== request.expectedRevision) {
        throw new SourceWorkflowError(
          "SOURCE_SYNC_POLICY_CONFLICT",
          "Sync policy changed concurrently",
        );
      }
      const updatedAt = now();
      const permission = await issueKnowledgeSpaceDurablePermission({
        access: input.access,
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        authorization: input.authorization,
        callerKind: request.callerKind,
        expiresAt: new Date(Date.parse(updatedAt) + 365 * 24 * 60 * 60_000).toISOString(),
        knowledgeSpaceId: request.knowledgeSpaceId,
        requiredAccess: "write",
        subject: request.subject,
      });
      return input.repository.upsertSyncPolicy({
        accessChannel: permission.accessChannel,
        ...(request.customIntervalSeconds === undefined
          ? {}
          : { customIntervalSeconds: request.customIntervalSeconds }),
        createdAt: prior?.createdAt ?? updatedAt,
        enabled: request.enabled && request.mode !== "manual",
        expectedSourceVersion: request.expectedSourceVersion,
        id: prior?.id ?? randomUUID(),
        knowledgeSpaceId: request.knowledgeSpaceId,
        mode: request.mode,
        ...(request.enabled && request.mode !== "manual"
          ? {
              nextRunAt: nextSyncPolicyRunAt(
                request.mode,
                request.customIntervalSeconds,
                updatedAt,
              ),
            }
          : {}),
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        requestedBySubjectId: request.subject.subjectId,
        requiredPermissionScope: requiredSourceScope(source),
        revision: (prior?.revision ?? 0) + 1,
        sourceId: request.sourceId,
        tenantId: request.subject.tenantId,
        updatedAt,
      });
    },
    createBulk: async (request) => {
      const sourceIds = [...new Set(request.sourceIds)];
      if (sourceIds.length < 1 || sourceIds.length > maxBulkItems) {
        throw new SourceWorkflowError(
          "SOURCE_BULK_ITEMS_INVALID",
          `Bulk operation must contain 1-${maxBulkItems} unique source ids`,
        );
      }
      const timestamp = now();
      const items: SourceBulkWorkflowItem[] = [];
      const requiredScopes = new Set<string>();
      for (const sourceId of sourceIds) {
        let source: Source | null = null;
        try {
          source = (await requireSource(request, request.knowledgeSpaceId, sourceId, "write"))
            .source;
        } catch (error) {
          if (!(error instanceof SourceWorkflowError) || error.code !== "SOURCE_NOT_FOUND") {
            throw error;
          }
        }
        if (source) {
          for (const scope of requiredSourceScope(source)) requiredScopes.add(scope);
        }
        const skipReason = sourceBulkSkipReason(source, request.action);
        items.push({
          action: request.action,
          id: generateBulkItemId(),
          ...(skipReason ? { reason: skipReason } : {}),
          runId: "pending",
          sourceId,
          status: skipReason ? "skipped" : "eligible",
          updatedAt: timestamp,
        });
      }
      const newRun = await prepare(request, {
        idempotencyKey: request.idempotencyKey,
        knowledgeSpaceId: request.knowledgeSpaceId,
        kind: "bulk",
        payload: { action: request.action, sourceIds: [...sourceIds].sort() },
        progressTotal: sourceIds.length,
        requiredPermissionScope: [...requiredScopes].sort(),
      });
      const frozenItems = items.map((item) => ({ ...item, runId: newRun.id }));
      return input.repository.startBulk({ items: frozenItems, run: newRun });
    },
    get: async (request) =>
      (await getAuthorized(request, request.knowledgeSpaceId, request.runId, "read"))?.run ?? null,
    list: async (request) => {
      const decision = await authorize(request, request.knowledgeSpaceId, "read");
      if (request.sourceId) {
        await requireSource(request, request.knowledgeSpaceId, request.sourceId, "read");
      }
      return input.repository.listRuns({
        candidateGrants: decision.permissionSnapshot.candidateGrants,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        knowledgeSpaceId: request.knowledgeSpaceId,
        limit: request.limit,
        ...(request.sourceId ? { sourceId: request.sourceId } : {}),
        tenantId: request.subject.tenantId,
      });
    },
    listBulkItems: async (request) => {
      const run = await input.repository.get({
        knowledgeSpaceId: request.knowledgeSpaceId,
        runId: request.runId,
        tenantId: request.subject.tenantId,
      });
      const expectedAccessChannel = knowledgeSpaceAccessChannelForCallerKind(request.callerKind);
      if (
        !run ||
        run.kind !== "bulk" ||
        run.requestedBySubjectId !== request.subject.subjectId ||
        run.accessChannel !== expectedAccessChannel
      ) {
        return null;
      }
      const decision = await authorize(request, request.knowledgeSpaceId, "read");
      if (
        !candidatePermissionScopeAllows(
          run.requiredPermissionScope,
          decision.permissionSnapshot.candidateGrants,
        )
      ) {
        return null;
      }
      try {
        await revalidateKnowledgeSpaceDurablePermission({
          access: input.access,
          callerKind: request.callerKind,
          currentApiKeyId: request.apiKey?.id,
          knowledgeSpaceId: request.knowledgeSpaceId,
          permissionSnapshot: {
            accessChannel: run.accessChannel,
            id: run.permissionSnapshotId,
            revision: run.permissionSnapshotRevision,
          },
          subject: request.subject,
        });
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) return null;
        throw error;
      }
      return input.repository.listAuthorizedBulkItems({
        accessChannel: run.accessChannel,
        candidateGrants: decision.permissionSnapshot.candidateGrants,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        knowledgeSpaceId: run.knowledgeSpaceId,
        limit: request.limit,
        permissionSnapshotId: run.permissionSnapshotId,
        permissionSnapshotRevision: run.permissionSnapshotRevision,
        requestedBySubjectId: run.requestedBySubjectId,
        runId: run.id,
        tenantId: run.tenantId,
      });
    },
    cancel: async (request) => {
      const authorized = await getAuthorized(
        request,
        request.knowledgeSpaceId,
        request.runId,
        "write",
      );
      if (!authorized) return null;
      const timestamp = now();
      const permission = await issuePermission(request, request.knowledgeSpaceId, timestamp);
      return input.repository.cancel({
        accessChannel: permission.accessChannel,
        now: timestamp,
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        reason: request.reason ?? "Canceled by user",
        requestedBySubjectId: request.subject.subjectId,
        runId: authorized.run.id,
      });
    },
    retry: async (request) => {
      const authorized = await getAuthorized(
        request,
        request.knowledgeSpaceId,
        request.runId,
        "write",
      );
      if (!authorized) return null;
      const timestamp = now();
      const permission = await issuePermission(request, request.knowledgeSpaceId, timestamp);
      return input.repository.retry({
        accessChannel: permission.accessChannel,
        now: timestamp,
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        requestedBySubjectId: request.subject.subjectId,
        runId: authorized.run.id,
      });
    },
    selectCrawlPages: async (request) => {
      const authorized = await getAuthorized(
        request,
        request.knowledgeSpaceId,
        request.runId,
        "write",
      );
      if (!authorized)
        throw new SourceWorkflowError("SOURCE_WORKFLOW_NOT_FOUND", "Source workflow not found");
      if (request.pageIds.length < 1 || request.pageIds.length > maxImportItems) {
        throw new SourceWorkflowError(
          "SOURCE_IMPORT_ITEMS_INVALID",
          `Crawl selection must contain 1-${maxImportItems} page ids`,
        );
      }
      const timestamp = now();
      const permission = await issuePermission(request, request.knowledgeSpaceId, timestamp);
      return input.repository.selectCrawlPages({
        accessChannel: permission.accessChannel,
        idempotencyKey: bounded(request.idempotencyKey, "idempotency key", 255),
        now: timestamp,
        pageIds: [...new Set(request.pageIds)],
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        requestedBySubjectId: request.subject.subjectId,
        runId: authorized.run.id,
      });
    },
  };
}

export function providerItemIdentity(input: {
  readonly contentHash?: string | undefined;
  readonly etag?: string | undefined;
  readonly providerItemId: string;
}): {
  readonly contentHash: string;
  readonly etag?: string | undefined;
  readonly providerItemId: string;
} {
  const providerItemId = bounded(input.providerItemId, "provider item id", 1024);
  const etag = input.etag?.trim();
  const contentHash = input.contentHash?.trim().toLowerCase();
  if (contentHash && !/^[a-f0-9]{64}$/u.test(contentHash)) {
    throw new SourceWorkflowError(
      "SOURCE_PROVIDER_HASH_INVALID",
      "Provider content hash is invalid",
    );
  }
  if (!contentHash && !etag) {
    throw new SourceWorkflowError(
      "SOURCE_PROVIDER_VERSION_MISSING",
      "Provider item requires contentHash or etag",
    );
  }
  return {
    contentHash: contentHash ?? createHash("sha256").update(`etag\0${etag}`, "utf8").digest("hex"),
    ...(etag ? { etag: bounded(etag, "provider etag", 1024) } : {}),
    providerItemId,
  };
}

export type PublicSourceWorkflowRun = Pick<
  SourceWorkflowRun,
  | "canceledAt"
  | "checkpoint"
  | "completedAt"
  | "createdAt"
  | "cursor"
  | "executionAttempts"
  | "id"
  | "knowledgeSpaceId"
  | "kind"
  | "lastErrorCode"
  | "maxExecutionAttempts"
  | "progressCompleted"
  | "progressFailed"
  | "progressSkipped"
  | "progressTotal"
  | "sourceId"
  | "state"
  | "updatedAt"
>;

/** Strict allow-list: durable authorization, raw selections, worker and lease provenance stay internal. */
export function toPublicSourceWorkflowRun(run: SourceWorkflowRun): PublicSourceWorkflowRun {
  return {
    ...(run.canceledAt ? { canceledAt: run.canceledAt } : {}),
    checkpoint: run.checkpoint,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    createdAt: run.createdAt,
    ...(run.cursor ? { cursor: run.cursor } : {}),
    executionAttempts: run.executionAttempts,
    id: run.id,
    knowledgeSpaceId: run.knowledgeSpaceId,
    kind: run.kind,
    ...(run.lastErrorCode ? { lastErrorCode: run.lastErrorCode } : {}),
    maxExecutionAttempts: run.maxExecutionAttempts,
    progressCompleted: run.progressCompleted,
    progressFailed: run.progressFailed,
    progressSkipped: run.progressSkipped,
    ...(run.progressTotal === undefined ? {} : { progressTotal: run.progressTotal }),
    ...(run.sourceId ? { sourceId: run.sourceId } : {}),
    state: run.state,
    updatedAt: run.updatedAt,
  };
}

function sourceBulkSkipReason(source: Source | null, action: SourceBulkAction): string | undefined {
  if (!source) return "source-not-found";
  if (action === "disable" && source.status === "disabled") return "already-disabled";
  if (action === "sync" && (source.status === "disabled" || source.status === "syncing")) {
    return source.status === "disabled" ? "source-disabled" : "sync-in-flight";
  }
  return undefined;
}

function requiredSourceScope(source: Source): readonly string[] {
  const scope = candidatePermissionScopeSnapshot(source.permissionScope);
  if (!scope) {
    throw new SourceWorkflowError(
      "SOURCE_PERMISSION_SCOPE_INVALID",
      "Source permission scope is malformed",
    );
  }
  return scope;
}

function sanitizeImportSelection(
  kind: "online-document-import" | "online-drive-import",
  item: SourceImportSelection,
): Record<string, JobPayload> {
  const raw = item as unknown as Record<string, unknown>;
  const allowed =
    kind === "online-document-import"
      ? new Set([
          "etag",
          "lastEditedTime",
          "name",
          "pageId",
          "providerItemId",
          "type",
          "workspaceId",
        ])
      : new Set(["bucket", "etag", "id", "mimeType", "name", "providerItemId"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new SourceWorkflowError(
      "SOURCE_IMPORT_ITEMS_INVALID",
      "Import item contains an unknown or secret-bearing field",
    );
  }
  if (kind === "online-document-import") {
    const document = raw as unknown as SourceOnlineDocumentImportItem;
    return {
      ...(document.etag ? { etag: bounded(document.etag, "etag", 1024) } : {}),
      ...(document.lastEditedTime
        ? { lastEditedTime: bounded(document.lastEditedTime, "last edited time", 128) }
        : {}),
      ...(document.name ? { name: bounded(document.name, "page name", 500) } : {}),
      pageId: bounded(document.pageId, "page id", 1024),
      providerItemId: bounded(document.providerItemId, "provider item id", 1024),
      type: bounded(document.type, "page type", 128),
      workspaceId: bounded(document.workspaceId, "workspace id", 1024),
    };
  }
  const drive = raw as unknown as SourceOnlineDriveImportItem;
  return {
    ...(drive.bucket ? { bucket: bounded(drive.bucket, "bucket", 1024) } : {}),
    ...(drive.etag ? { etag: bounded(drive.etag, "etag", 1024) } : {}),
    id: bounded(drive.id, "file id", 1024),
    ...(drive.mimeType ? { mimeType: bounded(drive.mimeType, "MIME type", 255) } : {}),
    name: bounded(drive.name, "file name", 500),
    providerItemId: bounded(drive.providerItemId, "provider item id", 1024),
  };
}

function clonePayload<T extends Readonly<Record<string, JobPayload>>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bounded(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new SourceWorkflowError("SOURCE_WORKFLOW_INPUT_INVALID", `${name} is invalid`);
  }
  return normalized;
}

function validateSyncPolicyInput(
  mode: SourceSyncPolicyRecord["mode"],
  enabled: boolean,
  customIntervalSeconds: number | undefined,
): void {
  if (mode === "custom") {
    if (
      !Number.isSafeInteger(customIntervalSeconds) ||
      (customIntervalSeconds as number) < 3_600 ||
      (customIntervalSeconds as number) > 2_592_000
    ) {
      throw new SourceWorkflowError(
        "SOURCE_SYNC_POLICY_INVALID",
        "Custom sync interval must be 3600-2592000 seconds",
      );
    }
  } else if (customIntervalSeconds !== undefined) {
    throw new SourceWorkflowError(
      "SOURCE_SYNC_POLICY_INVALID",
      "Custom interval is only valid for custom sync mode",
    );
  }
  if (mode === "manual" && enabled) {
    throw new SourceWorkflowError(
      "SOURCE_SYNC_POLICY_INVALID",
      "Manual sync policy cannot enable scheduling",
    );
  }
}

export function nextSyncPolicyRunAt(
  mode: SourceSyncPolicyRecord["mode"],
  customIntervalSeconds: number | undefined,
  anchor: string,
): string {
  const timestamp = Date.parse(anchor);
  if (!Number.isFinite(timestamp) || mode === "manual") {
    throw new SourceWorkflowError("SOURCE_SYNC_POLICY_INVALID", "Sync policy anchor is invalid");
  }
  const seconds = mode === "custom" ? customIntervalSeconds : mode === "provider" ? 3_600 : 86_400;
  if (!Number.isSafeInteger(seconds) || (seconds as number) < 1) {
    throw new SourceWorkflowError("SOURCE_SYNC_POLICY_INVALID", "Sync policy interval is invalid");
  }
  return new Date(timestamp + (seconds as number) * 1_000).toISOString();
}
