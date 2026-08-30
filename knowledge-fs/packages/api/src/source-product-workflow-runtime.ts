import { createHash } from "node:crypto";

import type { ObjectStorageAdapter, Source } from "@knowledge/core";

import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import type { CapabilityGrantProvenanceRepository } from "./capability-grant-provenance";
import type {
  DeletionLifecycleFenceGuard,
  DeletionLifecycleFenceToken,
} from "./deletion-lifecycle-fence";
import type {
  DatabaseKnowledgeSpacePermissionFence,
  KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import type {
  LogicalDocumentRepository,
  SourceActiveDocumentInventoryItem,
} from "./logical-document-repository";
import type { OnlineDocumentConnector, OnlineDocumentPage } from "./online-document-connector";
import type { OnlineDriveConnector, OnlineDriveFile } from "./online-drive-connector";
import type { SourceConnectionService } from "./source-connection";
import type { SourceCredentialService } from "./source-credential-service";
import type {
  MaterializedSourceDocument,
  SourceDocumentInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";
import type {
  SourceLogicalRevisionPublisher,
  SourceProviderCoordinate,
} from "./source-logical-revision-publisher";
import { safeSourceOperationError } from "./source-operation-error";
import {
  type SourceBulkAction,
  type SourceCrawlPreviewPage,
  type SourceProductWorkflowRepository,
  SourceWorkflowError,
  type SourceWorkflowFence,
  type SourceWorkflowRun,
  providerItemIdentity,
  sourceWorkflowMaterializationGeneration,
} from "./source-product-workflow";
import type { SourceProviderCatalog } from "./source-provider-catalog";
import type { SourceRepository } from "./source-repository";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

const encoder = new TextEncoder();
const PROVIDER_SELECTION_METADATA_KEY = "__knowledgeFsProviderSelection";

export interface SourceWorkflowContentStore {
  deleteRun(input: {
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly runId: string;
    readonly tenantId: string;
  }): Promise<{ readonly deleted: number; readonly hasMore: boolean }>;
  get(input: {
    readonly contentObjectKey: string;
    readonly knowledgeSpaceId: string;
    readonly runId: string;
    readonly tenantId: string;
  }): Promise<Uint8Array | null>;
  put(input: {
    readonly body: Uint8Array;
    readonly contentHash: string;
    readonly knowledgeSpaceId: string;
    readonly pageId: string;
    readonly runId: string;
    readonly tenantId: string;
  }): Promise<string>;
}

export interface SourceBulkRemovalRequester {
  find(input: {
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<SourceBulkRemovalStatus | null>;
  get(input: {
    readonly deletionJobId: string;
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<SourceBulkRemovalStatus | null>;
  request(input: {
    readonly capabilityGrantId?: string | undefined;
    readonly expectedSourceVersion: number;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly permissionFence?: DatabaseKnowledgeSpacePermissionFence | undefined;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<SourceBulkRemovalStatus>;
}

export interface SourceBulkRemovalStatus {
  readonly deletionJobId: string;
  readonly errorCode?: string | undefined;
  readonly reason?: string | undefined;
  readonly state: "pending" | "succeeded" | "failed";
}

export interface SourceProductWorkflowRuntime {
  start(): () => Promise<void>;
  stop(): Promise<void>;
  tick(): Promise<{
    readonly claimed: number;
    readonly completed: number;
    readonly deferred: number;
    readonly failed: number;
    readonly stale: number;
  }>;
}

export function createObjectStorageSourceWorkflowContentStore(input: {
  readonly maxObjectBytes?: number | undefined;
  readonly maxCleanupBatchSize?: number | undefined;
  readonly storage: ObjectStorageAdapter;
}): SourceWorkflowContentStore {
  const maxObjectBytes = input.maxObjectBytes ?? 20 * 1024 * 1024;
  const maxCleanupBatchSize = input.maxCleanupBatchSize ?? 100;
  const prefix = (tenantId: string, knowledgeSpaceId: string, runId: string) =>
    `__knowledge-source-workflows/${segment(tenantId)}/${segment(knowledgeSpaceId)}/${segment(runId)}/`;
  return {
    put: async ({ body, contentHash, knowledgeSpaceId, pageId, runId, tenantId }) => {
      if (body.byteLength > maxObjectBytes) {
        throw runtimeError(
          "SOURCE_WORKFLOW_CONTENT_TOO_LARGE",
          "Provider item exceeds staging limit",
        );
      }
      const actual = createHash("sha256").update(body).digest("hex");
      if (actual !== contentHash) {
        throw runtimeError("SOURCE_WORKFLOW_CONTENT_HASH_MISMATCH", "Provider item hash mismatch");
      }
      const key = `${prefix(tenantId, knowledgeSpaceId, runId)}${segment(pageId)}-${contentHash}.bin`;
      await input.storage.putObject({
        body,
        contentType: "application/octet-stream",
        key,
        metadata: { contentHash, lifecycle: "source-workflow-staging", runId },
      });
      return key;
    },
    get: async ({ contentObjectKey, knowledgeSpaceId, runId, tenantId }) => {
      if (!contentObjectKey.startsWith(prefix(tenantId, knowledgeSpaceId, runId))) {
        throw runtimeError(
          "SOURCE_WORKFLOW_CONTENT_SCOPE_MISMATCH",
          "Staged content scope mismatch",
        );
      }
      return input.storage.getObject(contentObjectKey);
    },
    deleteRun: async ({ knowledgeSpaceId, limit, runId, tenantId }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxCleanupBatchSize) {
        throw runtimeError(
          "SOURCE_WORKFLOW_CLEANUP_LIMIT_INVALID",
          `Source workflow cleanup limit must be 1-${maxCleanupBatchSize}`,
        );
      }
      // Always restart at the prefix head. This remains correct if a prior worker deleted a page
      // and crashed before checkpointing an opaque storage cursor.
      const result = await input.storage.listObjects({
        limit,
        prefix: prefix(tenantId, knowledgeSpaceId, runId),
      });
      for (const object of result.objects) await input.storage.deleteObject(object.key);
      return { deleted: result.objects.length, hasMore: Boolean(result.nextCursor) };
    },
  };
}

export function createSourceProductWorkflowRuntime(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">
    | undefined;
  readonly bulkRemoval?: SourceBulkRemovalRequester | undefined;
  readonly bulkChildPollMs?: number | undefined;
  readonly claimBatchSize?: number | undefined;
  readonly contentStore: SourceWorkflowContentStore;
  /** Required hierarchy-aware space/source deletion fence. */
  readonly deletionFence: DeletionLifecycleFenceGuard;
  readonly externalOperationTimeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly leaseMs?: number | undefined;
  readonly maxCrawlPages?: number | undefined;
  readonly maxCleanupBatchesPerRun?: number | undefined;
  readonly maxSyncItems?: number | undefined;
  /** Required: the I5 logical-document aggregate is the sole provider revision truth. */
  readonly logicalInventory: Pick<LogicalDocumentRepository, "listActiveBySource">;
  readonly logicalRevisions: SourceLogicalRevisionPublisher;
  readonly materializer: SourceDocumentMaterializer;
  readonly now?: (() => number) | undefined;
  readonly onlineDocuments?: OnlineDocumentConnector | undefined;
  readonly onlineDrive?: OnlineDriveConnector | undefined;
  readonly repository: SourceProductWorkflowRepository;
  readonly sourceCredentials?: SourceCredentialService | undefined;
  readonly sourceConnections?: Pick<SourceConnectionService, "get" | "resolve"> | undefined;
  readonly sourceProviders?: Pick<SourceProviderCatalog, "get"> | undefined;
  readonly sources: SourceRepository;
  readonly websiteCrawl?: WebsiteCrawlConnector | undefined;
  readonly workerId: string;
}): SourceProductWorkflowRuntime {
  const claimBatchSize = input.claimBatchSize ?? 5;
  const bulkChildPollMs = input.bulkChildPollMs ?? Math.max(input.intervalMs ?? 1_000, 1_000);
  const intervalMs = input.intervalMs ?? 1_000;
  const leaseMs = input.leaseMs ?? 5 * 60_000;
  const externalOperationTimeoutMs = input.externalOperationTimeoutMs ?? 10 * 60_000;
  const maxCleanupBatchesPerRun = input.maxCleanupBatchesPerRun ?? 25;
  const now = input.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lane: Promise<unknown> = Promise.resolve();
  let stopping = false;

  const process = async (
    claimed: SourceWorkflowRun,
  ): Promise<"completed" | "deferred" | "failed" | "stale"> => {
    let run = claimed;
    const update = (next: SourceWorkflowRun) => {
      run = next;
      return next;
    };
    let execution: RuntimeExecution | undefined;
    try {
      const deletionToken = await input.deletionFence.captureDeletionFence({
        knowledgeSpaceId: claimed.knowledgeSpaceId,
        ...(claimed.sourceId ? { sourceId: claimed.sourceId } : {}),
        tenantId: claimed.tenantId,
      });
      execution = createRuntimeExecution({
        deletionToken,
        externalOperationTimeoutMs,
        getRun: () => run,
        input,
        leaseMs,
        setRun: update,
      });
      let completionState: "completed" | "preview_ready" | "zero_results" = "completed";
      await execution.assertActive();
      const source = run.sourceId
        ? await input.sources.get({ id: run.sourceId, knowledgeSpaceId: run.knowledgeSpaceId })
        : null;
      if (run.sourceId && !source) {
        throw runtimeError("SOURCE_NOT_FOUND", "Source no longer exists");
      }

      switch (run.kind) {
        case "crawl-preview":
          if (selectedPageIds(run).length > 0) {
            await processCrawlImport(input, execution, requiredSource(source));
          } else {
            completionState = await processCrawlPreview(input, execution, requiredSource(source));
          }
          break;
        case "online-document-import":
          await processOnlineDocumentImport(input, execution, requiredSource(source));
          break;
        case "online-drive-import":
          await processOnlineDriveImport(input, execution, requiredSource(source));
          break;
        case "sync":
          await processSourceSync(input, execution, requiredSource(source));
          break;
        case "bulk":
          if (await processBulk(input, execution, bulkChildPollMs)) return "deferred";
          break;
        case "crawl-import":
          if (selectedSourceUrls(run).length > 0) {
            await processSelectedCrawlImport(input, execution, requiredSource(source));
          } else {
            await processCrawlImport(input, execution, requiredSource(source));
          }
          break;
      }
      if (
        run.kind === "crawl-import" ||
        (run.kind === "crawl-preview" && selectedPageIds(run).length > 0)
      ) {
        await cleanupStagedContent(input, execution, maxCleanupBatchesPerRun);
      }
      await activateImportedPreviewSource(input, execution, source);
      await execution.assertActive();
      await input.repository.complete({
        fence: fence(execution.run()),
        now: iso(now()),
        ...(completionState === "completed" ? {} : { state: completionState }),
      });
      return "completed";
    } catch (error) {
      const safe = safeSourceOperationError("sourceWorkflow", error);
      const persistedError =
        error instanceof SourceProductWorkflowRuntimeError
          ? { code: error.code, message: error.message }
          : safe;
      try {
        await input.repository.fail({
          errorCode: persistedError.code,
          errorMessage: persistedError.message,
          fence: fence(execution?.run() ?? run),
          now: iso(now()),
        });
        return "failed";
      } catch {
        return "stale";
      }
    }
  };

  const tick = async () => {
    const timestamp = now();
    const claimed = await input.repository.claim({
      leaseExpiresAt: iso(timestamp + leaseMs),
      limit: claimBatchSize,
      now: iso(timestamp),
      workerId: input.workerId,
    });
    const counts = { claimed: claimed.length, completed: 0, deferred: 0, failed: 0, stale: 0 };
    for (const run of claimed) counts[await process(run)] += 1;
    return counts;
  };

  return {
    tick,
    start: () => {
      if (!timer) {
        timer = setInterval(() => {
          if (stopping) return;
          lane = lane.then(tick, tick).catch(() => undefined);
        }, intervalMs);
        timer.unref?.();
      }
      return async () => {
        stopping = true;
        if (timer) clearInterval(timer);
        timer = undefined;
        await lane;
      };
    },
    stop: async () => {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await lane;
    },
  };
}

interface RuntimeExecution {
  assertActive(): Promise<SourceWorkflowRun>;
  external<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options?: { readonly onInvalidatedResult: (result: T) => Promise<void> } | undefined,
  ): Promise<T>;
  mutate(
    operation: (run: SourceWorkflowRun) => Promise<SourceWorkflowRun>,
  ): Promise<SourceWorkflowRun>;
  run(): SourceWorkflowRun;
}

function createRuntimeExecution(input: {
  readonly deletionToken: DeletionLifecycleFenceToken;
  readonly externalOperationTimeoutMs: number;
  readonly getRun: () => SourceWorkflowRun;
  readonly input: Parameters<typeof createSourceProductWorkflowRuntime>[0];
  readonly leaseMs: number;
  readonly setRun: (run: SourceWorkflowRun) => SourceWorkflowRun;
}): RuntimeExecution {
  let lane: Promise<void> = Promise.resolve();
  let lost: unknown;

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = lane.then(operation, operation);
    lane = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const validate = async (heartbeat: boolean): Promise<SourceWorkflowRun> => {
    if (lost) throw lost;
    const run = input.getRun();
    await input.input.deletionFence.assertDeletionFenceUnchanged(input.deletionToken);
    const live = await input.input.repository.get({
      knowledgeSpaceId: run.knowledgeSpaceId,
      runId: run.id,
      tenantId: run.tenantId,
    });
    if (
      !live ||
      live.rowVersion !== run.rowVersion ||
      live.workerId !== run.workerId ||
      live.leaseToken !== run.leaseToken ||
      !["running", "crawling", "importing", "syncing"].includes(live.state)
    ) {
      throw runtimeError("SOURCE_WORKFLOW_FENCE_LOST", "Source workflow execution fence was lost");
    }
    let permissionScopes: readonly string[];
    let authorizedLive = live;
    if (live.capabilityGrantId) {
      if (!input.input.capabilityGrants) {
        throw runtimeError(
          "SOURCE_WORKFLOW_PERMISSION_INVALID",
          "Capability grant repository is unavailable",
        );
      }
      try {
        const scope = {
          grantId: live.capabilityGrantId,
          knowledgeSpaceId: live.knowledgeSpaceId,
          tenantId: live.tenantId,
        };
        await input.input.capabilityGrants.assertPublicationAllowed(scope);
        const grant = await input.input.capabilityGrants.get(scope);
        if (!grant || grant.state !== "active") throw new Error("capability grant unavailable");
        permissionScopes = grant.contentScopeIds;
        authorizedLive = { ...live, executionSubjectId: grant.subjectId };
      } catch {
        throw runtimeError(
          "SOURCE_WORKFLOW_PERMISSION_INVALID",
          "Capability grant is no longer active",
        );
      }
    } else {
      if (
        !live.accessChannel ||
        !live.permissionSnapshotId ||
        !live.permissionSnapshotRevision ||
        !live.requestedBySubjectId ||
        !live.requiredPermissionScope
      ) {
        throw runtimeError(
          "SOURCE_WORKFLOW_PERMISSION_INVALID",
          "Durable source workflow permission provenance is incomplete",
        );
      }
      const permission = await input.input.access.revalidatePermissionSnapshot({
        expectedAccessChannel: live.accessChannel,
        id: live.permissionSnapshotId,
        knowledgeSpaceId: live.knowledgeSpaceId,
        subjectId: live.requestedBySubjectId,
        tenantId: live.tenantId,
      });
      if (
        permission.revision !== live.permissionSnapshotRevision ||
        (permission.role !== "owner" && permission.role !== "editor") ||
        !candidatePermissionScopeAllows(live.requiredPermissionScope, permission.permissionScopes)
      ) {
        throw runtimeError(
          "SOURCE_WORKFLOW_PERMISSION_INVALID",
          "Durable source workflow permission is no longer valid",
        );
      }
      permissionScopes = permission.permissionScopes;
    }
    if (live.sourceId) {
      const source = await input.input.sources.get({
        id: live.sourceId,
        knowledgeSpaceId: live.knowledgeSpaceId,
      });
      if (!source || !candidatePermissionScopeAllows(source.permissionScope, permissionScopes)) {
        throw runtimeError(
          "SOURCE_WORKFLOW_PERMISSION_INVALID",
          "Source permission scope is no longer authorized",
        );
      }
    }
    if (!heartbeat) return authorizedLive;
    const timestamp = (input.input.now ?? Date.now)();
    return input.setRun({
      ...(await input.input.repository.heartbeat({
        fence: fence(live),
        leaseExpiresAt: iso(timestamp + input.leaseMs),
        now: iso(timestamp),
      })),
      ...(authorizedLive.executionSubjectId
        ? { executionSubjectId: authorizedLive.executionSubjectId }
        : {}),
    });
  };

  const assertActive = () => serialized(() => validate(true));
  const mutate: RuntimeExecution["mutate"] = (operation) =>
    serialized(async () => {
      const run = await validate(false);
      const updated = await operation(run);
      return input.setRun({
        ...updated,
        ...(run.executionSubjectId ? { executionSubjectId: run.executionSubjectId } : {}),
      });
    });

  return {
    assertActive,
    external: async <T>(
      operation: (signal: AbortSignal) => Promise<T>,
      options?: { readonly onInvalidatedResult: (result: T) => Promise<void> },
    ): Promise<T> => {
      await assertActive();
      const controller = new AbortController();
      let heartbeatFailure: unknown;
      const heartbeatEveryMs = Math.max(1_000, Math.floor(input.leaseMs / 3));
      const heartbeat = setInterval(() => {
        void assertActive().catch((error) => {
          heartbeatFailure = error;
          lost = error;
          controller.abort(error);
        });
      }, heartbeatEveryMs);
      heartbeat.unref?.();
      const timeout = setTimeout(() => {
        const error = runtimeError(
          "SOURCE_WORKFLOW_EXTERNAL_TIMEOUT",
          "Source provider operation exceeded its bounded execution time",
        );
        lost = error;
        controller.abort(error);
      }, input.externalOperationTimeoutMs);
      timeout.unref?.();
      const operationPromise = Promise.resolve().then(() => operation(controller.signal));
      try {
        const timeoutFailure = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                heartbeatFailure ??
                  controller.signal.reason ??
                  runtimeError("SOURCE_WORKFLOW_EXTERNAL_ABORTED", "Source operation was aborted"),
              ),
            { once: true },
          );
        });
        let result: T;
        try {
          result = await Promise.race([operationPromise, timeoutFailure]);
        } catch (error) {
          if (!controller.signal.aborted) throw error;
          // Abort is cooperative. Never release the workflow lane while a provider/materializer
          // can still commit writes in the background; settle it first, then compensate a late
          // successful result under its exact ownership proof.
          const settled = await operationPromise.then(
            (value) => ({ ok: true as const, value }),
            () => ({ ok: false as const }),
          );
          if (settled.ok) await options?.onInvalidatedResult(settled.value);
          throw (
            heartbeatFailure ??
            controller.signal.reason ??
            runtimeError("SOURCE_WORKFLOW_EXTERNAL_ABORTED", "Source operation was aborted")
          );
        }
        if (heartbeatFailure) {
          await options?.onInvalidatedResult(result);
          throw heartbeatFailure;
        }
        try {
          await assertActive();
        } catch (error) {
          await options?.onInvalidatedResult(result);
          throw error;
        }
        return result;
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timeout);
      }
    },
    mutate,
    run: input.getRun,
  };
}

async function cleanupStagedContent(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  maxBatches: number,
): Promise<void> {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 1_000) {
    throw runtimeError(
      "SOURCE_WORKFLOW_CLEANUP_BATCHES_INVALID",
      "Source workflow cleanup batch limit is invalid",
    );
  }
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const run = execution.run();
    const result = await execution.external(() =>
      input.contentStore.deleteRun({
        knowledgeSpaceId: run.knowledgeSpaceId,
        limit: 100,
        runId: run.id,
        tenantId: run.tenantId,
      }),
    );
    await execution.mutate((latest) =>
      input.repository.checkpoint({
        checkpoint: "cleanup-staging",
        fence: fence(latest),
        now: iso((input.now ?? Date.now)()),
        state: latest.state,
      }),
    );
    if (!result.hasMore) return;
  }
  throw runtimeError(
    "SOURCE_WORKFLOW_CLEANUP_INCOMPLETE",
    "Staged source content cleanup exceeded its bounded batch budget and must be retried",
  );
}

async function activateImportedPreviewSource(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source | null,
): Promise<void> {
  const run = execution.run();
  if (
    !source ||
    !(
      (run.kind === "crawl-preview" && selectedPageIds(run).length > 0) ||
      (run.kind === "crawl-import" &&
        (selectedSourceUrls(run).length > 0 || selectedPageIds(run).length > 0))
    ) ||
    source.status !== "disabled" ||
    source.metadata.preview !== true
  ) {
    return;
  }
  await execution.assertActive();
  const activated = await input.sources.update({
    expectedVersion: source.version,
    id: source.id,
    knowledgeSpaceId: run.knowledgeSpaceId,
    metadata: { ...source.metadata, preview: false },
    status: "active",
  });
  if (!activated) throw runtimeError("SOURCE_NOT_FOUND", "Source no longer exists");
}

async function processCrawlPreview(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<"preview_ready" | "zero_results"> {
  if (!input.websiteCrawl) {
    throw runtimeError(
      "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
      "Website crawl provider is unavailable",
    );
  }
  const initial = execution.run();
  const connectorSource = await execution.external(() =>
    resolveSource(input, source, initial.tenantId),
  );
  const result = await execution.external(
    (signal) =>
      input.websiteCrawl?.crawl({
        signal,
        source: connectorSource,
        tenantId: initial.tenantId,
        userId: workflowSubjectId(initial),
      }) ??
      Promise.reject(
        runtimeError("SOURCE_CRAWL_PROVIDER_UNAVAILABLE", "Website crawl provider is unavailable"),
      ),
  );
  const maxCrawlPages = input.maxCrawlPages ?? 1_000;
  if (result.pages.length > maxCrawlPages) {
    throw runtimeError(
      "SOURCE_CRAWL_RESULT_LIMIT_EXCEEDED",
      `Website crawl returned more than ${maxCrawlPages} pages`,
    );
  }
  let staged: SourceCrawlPreviewPage[] = [];
  for (const page of result.pages) {
    const run = execution.run();
    const body = encoder.encode(page.content);
    const contentHash = createHash("sha256").update(body).digest("hex");
    const pageId = createHash("sha256").update(page.sourceUrl, "utf8").digest("hex");
    const contentObjectKey = await execution.external(() =>
      input.contentStore.put({
        body,
        contentHash,
        knowledgeSpaceId: run.knowledgeSpaceId,
        pageId,
        runId: run.id,
        tenantId: run.tenantId,
      }),
    );
    staged.push({
      contentHash,
      contentObjectKey,
      createdAt: iso((input.now ?? Date.now)()),
      ...(page.description ? { description: page.description.slice(0, 2_000) } : {}),
      id: pageId,
      pageId,
      runId: run.id,
      sourceUrl: page.sourceUrl,
      ...(page.title ? { title: page.title.slice(0, 500) } : {}),
    });
    if (staged.length >= 50) {
      const batch = staged;
      staged = [];
      await execution.mutate((current) =>
        input.repository.appendCrawlPages({
          fence: fence(current),
          now: iso((input.now ?? Date.now)()),
          pages: batch,
        }),
      );
    }
  }
  if (staged.length) {
    await execution.mutate((current) =>
      input.repository.appendCrawlPages({
        fence: fence(current),
        now: iso((input.now ?? Date.now)()),
        pages: staged,
      }),
    );
  }
  return result.pages.length === 0 ? "zero_results" : "preview_ready";
}

async function processCrawlImport(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<void> {
  const run = execution.run();
  const selected = new Set(selectedPageIds(run));
  const previewPages: SourceCrawlPreviewPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await input.repository.listCrawlPages({
      ...(cursor ? { cursor } : {}),
      limit: 200,
      runId: run.id,
    });
    for (const candidate of page.items)
      if (selected.has(candidate.pageId)) previewPages.push(candidate);
    cursor = page.nextCursor;
  } while (cursor && previewPages.length < selected.size);
  if (previewPages.length !== selected.size) {
    throw runtimeError("SOURCE_CRAWL_PAGE_NOT_FOUND", "Selected crawl page is unavailable");
  }
  await importCrawlPages(input, execution, source, previewPages);
}

async function processSelectedCrawlImport(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<void> {
  const requestedUrls = new Set(selectedSourceUrls(execution.run()));
  const previewState = await processCrawlPreview(input, execution, source);
  if (previewState === "zero_results") {
    throw runtimeError("SOURCE_CRAWL_PAGE_NOT_FOUND", "Selected crawl page is unavailable");
  }

  const crawledPages: SourceCrawlPreviewPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await input.repository.listCrawlPages({
      ...(cursor ? { cursor } : {}),
      limit: 200,
      runId: execution.run().id,
    });
    crawledPages.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  const selectedPages = [...requestedUrls].map((sourceUrl) =>
    matchSelectedCrawlPage(sourceUrl, crawledPages),
  );
  if (new Set(selectedPages.map((page) => page.pageId)).size !== selectedPages.length)
    throw runtimeError(
      "SOURCE_CRAWL_PAGE_AMBIGUOUS",
      "Selected crawl URLs resolved to the same page",
    );
  await execution.mutate((current) =>
    input.repository.checkpoint({
      checkpoint: "selection-frozen",
      fence: fence(current),
      now: iso((input.now ?? Date.now)()),
      progressCompleted: 0,
      progressFailed: 0,
      progressSkipped: 0,
      progressTotal: requestedUrls.size,
      state: "importing",
    }),
  );
  await importCrawlPages(input, execution, source, selectedPages);
}

function matchSelectedCrawlPage(
  requestedUrl: string,
  candidates: readonly SourceCrawlPreviewPage[],
): SourceCrawlPreviewPage {
  const exact = candidates.filter((candidate) => candidate.sourceUrl === requestedUrl);
  if (exact.length > 1)
    throw runtimeError(
      "SOURCE_CRAWL_PAGE_AMBIGUOUS",
      "Selected crawl page matched more than one result",
    );
  const [exactMatch] = exact;
  if (exactMatch) return exactMatch;

  const canonicalRequestedUrl = canonicalCrawlUrl(requestedUrl);
  const canonical = candidates.filter(
    (candidate) => canonicalCrawlUrl(candidate.sourceUrl) === canonicalRequestedUrl,
  );
  if (canonical.length > 1)
    throw runtimeError(
      "SOURCE_CRAWL_PAGE_AMBIGUOUS",
      "Selected crawl page canonical URL matched more than one result",
    );
  const [canonicalMatch] = canonical;
  if (canonicalMatch) return canonicalMatch;
  throw runtimeError("SOURCE_CRAWL_PAGE_NOT_FOUND", "Selected crawl page is unavailable");
}

function canonicalCrawlUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

async function importCrawlPages(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  previewPages: readonly SourceCrawlPreviewPage[],
): Promise<void> {
  const run = execution.run();
  const completedBefore = Math.min(run.progressCompleted, previewPages.length);
  for (const [index, page] of previewPages.entries()) {
    if (index < completedBefore) continue;
    const current = execution.run();
    const body = await execution.external(() =>
      input.contentStore.get({
        contentObjectKey: page.contentObjectKey,
        knowledgeSpaceId: current.knowledgeSpaceId,
        runId: current.id,
        tenantId: current.tenantId,
      }),
    );
    if (!body)
      throw runtimeError("SOURCE_WORKFLOW_CONTENT_MISSING", "Selected crawl content is missing");
    const filename = webFilename(page.title ?? page.sourceUrl, page.pageId);
    const document: SourceDocumentInput = {
      body,
      filename,
      metadata: {
        dataSourceInfo: {
          contentHash: page.contentHash,
          providerItemId: page.pageId,
          sourceUrl: page.sourceUrl,
        },
        dataSourceType: "website_crawl",
      },
      mimeType: "text/markdown",
    };
    const candidate: PendingLogicalRevision = {
      contentHash: page.contentHash,
      filename,
      mimeType: "text/markdown",
      providerItemId: page.pageId,
      providerKind: "website",
      sizeBytes: body.byteLength,
      title: page.title ?? page.sourceUrl,
    };
    await materializeCandidates(input, execution, source, [document], [candidate]);
    await execution.mutate((latest) =>
      input.repository.checkpoint({
        checkpoint: "materialized",
        fence: fence(latest),
        now: iso((input.now ?? Date.now)()),
        progressCompleted: index + 1,
        progressTotal: previewPages.length,
        state: "importing",
      }),
    );
  }
}

async function processOnlineDocumentImport(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<void> {
  if (!input.onlineDocuments) {
    throw runtimeError(
      "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
      "Online-document provider is unavailable",
    );
  }
  const initial = execution.run();
  const records = payloadItems(initial);
  const frozenSource = await freezeProviderSelection(
    input,
    execution,
    source,
    "online-document",
    records,
  );
  const connectorSource = await execution.external(() =>
    resolveSource(input, frozenSource, initial.tenantId),
  );
  const completedBefore = Math.min(initial.progressCompleted, records.length);
  for (const [index, record] of records.entries()) {
    if (index < completedBefore) continue;
    const run = execution.run();
    const pageId = requiredPayloadString(record, "pageId");
    const providerItemId = requiredPayloadString(record, "providerItemId");
    const workspaceId = requiredPayloadString(record, "workspaceId");
    const type = requiredPayloadString(record, "type");
    const content = await execution.external(
      (signal) =>
        input.onlineDocuments?.getPageContent({
          page: { pageId, type, workspaceId },
          signal,
          source: connectorSource,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError(
            "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
            "Online-document provider is unavailable",
          ),
        ),
    );
    const body = encoder.encode(content.content);
    const identity = providerItemIdentity({
      contentHash: createHash("sha256").update(body).digest("hex"),
      ...(typeof record.etag === "string" ? { etag: record.etag } : {}),
      providerItemId,
    });
    const filename = webFilename(typeof record.name === "string" ? record.name : pageId, pageId);
    const document: SourceDocumentInput = {
      body,
      filename,
      metadata: {
        dataSourceInfo: { ...identity, pageId, type, workspaceId },
        dataSourceType: "online_document",
      },
      mimeType: "text/markdown",
    };
    const candidate: PendingLogicalRevision = {
      contentHash: identity.contentHash,
      ...(identity.etag ? { etag: identity.etag } : {}),
      filename,
      mimeType: "text/markdown",
      providerCoordinate: { kind: "online-document", pageId, type, workspaceId },
      providerItemId,
      providerKind: "online-document",
      sizeBytes: body.byteLength,
      title: typeof record.name === "string" ? record.name : pageId,
    };
    await materializeCandidates(input, execution, frozenSource, [document], [candidate]);
    await execution.mutate((latest) =>
      input.repository.checkpoint({
        checkpoint: "materialized",
        fence: fence(latest),
        now: iso((input.now ?? Date.now)()),
        progressCompleted: index + 1,
        progressTotal: records.length,
        state: "importing",
      }),
    );
  }
}

async function processOnlineDriveImport(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<void> {
  if (!input.onlineDrive) {
    throw runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable");
  }
  const initial = execution.run();
  const records = payloadItems(initial);
  const frozenSource = await freezeProviderSelection(
    input,
    execution,
    source,
    "online-drive",
    records,
  );
  const connectorSource = await execution.external(() =>
    resolveSource(input, frozenSource, initial.tenantId),
  );
  const completedBefore = Math.min(initial.progressCompleted, records.length);
  for (const [index, record] of records.entries()) {
    if (index < completedBefore) continue;
    const run = execution.run();
    const fileId = requiredPayloadString(record, "id");
    const providerItemId = requiredPayloadString(record, "providerItemId");
    const name = requiredPayloadString(record, "name");
    const download = await execution.external(
      (signal) =>
        input.onlineDrive?.download({
          file: {
            id: fileId,
            ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
          },
          signal,
          source: connectorSource,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable"),
        ),
    );
    const identity = providerItemIdentity({
      contentHash: createHash("sha256").update(download.body).digest("hex"),
      ...(typeof record.etag === "string" ? { etag: record.etag } : {}),
      providerItemId,
    });
    const mimeType =
      typeof record.mimeType === "string" ? record.mimeType : "application/octet-stream";
    const document: SourceDocumentInput = {
      body: download.body,
      filename: name,
      metadata: { dataSourceInfo: { ...identity, fileId }, dataSourceType: "online_drive" },
      mimeType,
    };
    const candidate: PendingLogicalRevision = {
      contentHash: identity.contentHash,
      ...(identity.etag ? { etag: identity.etag } : {}),
      filename: name,
      mimeType,
      providerCoordinate: {
        ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
        id: fileId,
        kind: "online-drive",
        mimeType,
        name,
      },
      providerItemId,
      providerKind: "online-drive",
      sizeBytes: download.body.byteLength,
      title: name,
    };
    await materializeCandidates(input, execution, frozenSource, [document], [candidate]);
    await execution.mutate((latest) =>
      input.repository.checkpoint({
        checkpoint: "materialized",
        fence: fence(latest),
        now: iso((input.now ?? Date.now)()),
        progressCompleted: index + 1,
        progressTotal: records.length,
        state: "importing",
      }),
    );
  }
}

interface FrozenProviderSelection {
  readonly coordinateHashes: readonly string[];
  readonly identityHashes: readonly string[];
  readonly kind: "online-document" | "online-drive";
  readonly version: 1;
}

async function freezeProviderSelection(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  kind: FrozenProviderSelection["kind"],
  records: readonly Record<string, unknown>[],
): Promise<Source> {
  const selections = records.map((record) => {
    const providerItemId = requiredPayloadString(record, "providerItemId");
    const coordinateKey = providerSelectionCoordinateKey(kind, record);
    return {
      coordinateHash: providerSelectionCoordinateHash(kind, providerItemId, coordinateKey),
      coordinateKey,
      identityHash: providerSelectionIdentityHash(kind, providerItemId),
    };
  });
  const identityHashes = [...new Set(selections.map(({ identityHash }) => identityHash))].sort();
  if (identityHashes.length !== records.length) {
    throw runtimeError(
      "SOURCE_PROVIDER_SELECTION_DUPLICATE",
      "Connected-source import contains a duplicate provider identity",
    );
  }
  if (new Set(selections.map(({ coordinateKey }) => coordinateKey)).size !== records.length) {
    throw runtimeError(
      "SOURCE_PROVIDER_SELECTION_DUPLICATE",
      "Connected-source import maps multiple identities to one provider coordinate",
    );
  }
  const coordinateHashes = selections.map(({ coordinateHash }) => coordinateHash).sort();

  const existing = readFrozenProviderSelection(source.metadata);
  if (existing) {
    if (
      existing.kind !== kind ||
      identityHashes.some((identityHash) => !existing.identityHashes.includes(identityHash)) ||
      coordinateHashes.some((coordinateHash) => !existing.coordinateHashes.includes(coordinateHash))
    ) {
      throw runtimeError(
        "SOURCE_PROVIDER_SELECTION_FROZEN",
        "Connected-source selection is frozen and cannot be expanded",
      );
    }
    return source;
  }

  await execution.assertActive();
  const updated = await input.sources.update({
    expectedVersion: source.version,
    id: source.id,
    knowledgeSpaceId: source.knowledgeSpaceId,
    metadata: {
      ...source.metadata,
      [PROVIDER_SELECTION_METADATA_KEY]: {
        coordinateHashes,
        identityHashes,
        kind,
        version: 1,
      } satisfies FrozenProviderSelection,
    },
  });
  if (!updated) throw runtimeError("SOURCE_NOT_FOUND", "Source no longer exists");
  await execution.assertActive();
  return updated;
}

function readFrozenProviderSelection(
  metadata: Readonly<Record<string, unknown>>,
): FrozenProviderSelection | undefined {
  const raw = metadata[PROVIDER_SELECTION_METADATA_KEY];
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw runtimeError(
      "SOURCE_PROVIDER_SELECTION_INVALID",
      "Connected-source selection marker is invalid",
    );
  }
  const record = raw as Record<string, unknown>;
  if (
    record.version !== 1 ||
    (record.kind !== "online-document" && record.kind !== "online-drive") ||
    !Array.isArray(record.identityHashes) ||
    !Array.isArray(record.coordinateHashes) ||
    record.identityHashes.length < 1 ||
    record.identityHashes.length > 200 ||
    record.coordinateHashes.length !== record.identityHashes.length ||
    record.identityHashes.some(
      (identityHash) => typeof identityHash !== "string" || !/^[a-f0-9]{64}$/u.test(identityHash),
    ) ||
    record.coordinateHashes.some(
      (coordinateHash) =>
        typeof coordinateHash !== "string" || !/^[a-f0-9]{64}$/u.test(coordinateHash),
    ) ||
    new Set(record.identityHashes).size !== record.identityHashes.length ||
    new Set(record.coordinateHashes).size !== record.coordinateHashes.length
  ) {
    throw runtimeError(
      "SOURCE_PROVIDER_SELECTION_INVALID",
      "Connected-source selection marker is invalid",
    );
  }
  return {
    coordinateHashes: [...record.coordinateHashes].sort() as string[],
    identityHashes: [...record.identityHashes].sort() as string[],
    kind: record.kind,
    version: 1,
  };
}

function providerSelectionIdentityHash(
  kind: FrozenProviderSelection["kind"],
  providerItemId: string,
): string {
  return createHash("sha256").update(`${kind}\0${providerItemId}`, "utf8").digest("hex");
}

function providerSelectionCoordinateHash(
  kind: FrozenProviderSelection["kind"],
  providerItemId: string,
  coordinateKey: string,
): string {
  return createHash("sha256")
    .update(`${kind}\0${providerItemId}\0${coordinateKey}`, "utf8")
    .digest("hex");
}

function providerSelectionCoordinateKey(
  kind: FrozenProviderSelection["kind"],
  record: Readonly<Record<string, unknown>>,
): string {
  if (kind === "online-document") {
    return JSON.stringify([
      requiredPayloadString(record, "workspaceId"),
      requiredPayloadString(record, "pageId"),
    ]);
  }
  const bucket = typeof record.bucket === "string" ? record.bucket : "";
  return JSON.stringify([bucket, requiredPayloadString(record, "id")]);
}

async function materializeCandidates(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  documents: readonly SourceDocumentInput[],
  candidates: readonly PendingLogicalRevision[],
): Promise<void> {
  const run = execution.run();
  const materializationGeneration = sourceWorkflowMaterializationGeneration(run.payload);
  const compensationScope = {
    knowledgeSpaceId: run.knowledgeSpaceId,
    sourceId: source.id,
    tenantId: run.tenantId,
  };
  const result = await execution.external(
    (signal) =>
      input.materializer.materialize({
        documents,
        knowledgeSpaceId: run.knowledgeSpaceId,
        permissionScope: source.permissionScope,
        sourceId: source.id,
        tenantId: run.tenantId,
        workflowExecution: {
          assertActive: async () => {
            await execution.assertActive();
          },
          items: candidates.map((candidate) => ({
            contentHash: candidate.contentHash,
            // Explicit retries advance the durable generation because failed bound assets are
            // permanently tombstoned. Generation zero preserves the legacy identity so an
            // in-flight run reclaimed during a rolling upgrade can still reuse its existing asset.
            itemKey:
              materializationGeneration === 0
                ? candidate.providerItemId
                : `${materializationGeneration}:${candidate.providerItemId}`,
            runId: run.id,
          })),
          signal,
        },
      }),
    {
      onInvalidatedResult: async (lateResult) => {
        await input.materializer.compensate({
          ...compensationScope,
          documents: lateResult.documents,
        });
      },
    },
  );
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.error("Source workflow document materialization failed", {
        errorCode: failure.code,
        errorMessage: failure.error,
        filename: failure.filename,
        knowledgeSpaceId: run.knowledgeSpaceId,
        sourceId: source.id,
        workflowId: run.id,
        workflowKind: run.kind,
      });
    }
    await input.materializer.compensate({
      ...compensationScope,
      documents: result.documents,
    });
    const firstFailure = result.failed[0];
    if (!firstFailure) {
      throw runtimeError(
        "SOURCE_IMPORT_PARTIAL_FAILURE",
        "One or more selected provider items failed",
      );
    }
    throw runtimeError(firstFailure.code, firstFailure.error);
  }
  await publishLogicalRevisions(input, execution, source, result.documents, candidates);
}

interface PendingLogicalRevision {
  readonly contentHash: string;
  readonly etag?: string | undefined;
  readonly filename: string;
  readonly mimeType: string;
  readonly providerCoordinate?: SourceProviderCoordinate | undefined;
  readonly providerItemId: string;
  readonly providerKind: "website" | "online-document" | "online-drive";
  readonly sizeBytes: number;
  readonly title: string;
}

async function publishLogicalRevisions(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  materialized: readonly MaterializedSourceDocument[],
  candidates: readonly PendingLogicalRevision[],
): Promise<void> {
  if (materialized.length !== candidates.length) {
    const run = execution.run();
    await input.materializer.compensate({
      documents: materialized,
      knowledgeSpaceId: run.knowledgeSpaceId,
      sourceId: source.id,
      tenantId: run.tenantId,
    });
    throw runtimeError(
      "SOURCE_LOGICAL_REVISION_PROOF_MISSING",
      "Materialized source documents do not match the frozen provider identity batch",
    );
  }
  for (const [index, document] of materialized.entries()) {
    const candidate = candidates[index];
    if (!candidate)
      throw runtimeError("SOURCE_LOGICAL_REVISION_PROOF_MISSING", "Provider identity is missing");
    const run = execution.run();
    if (!document.workflowOwnership) {
      await input.materializer.compensate({
        documents: [document],
        knowledgeSpaceId: run.knowledgeSpaceId,
        sourceId: source.id,
        tenantId: run.tenantId,
      });
      throw runtimeError(
        "SOURCE_LOGICAL_REVISION_PROOF_MISSING",
        "Source workflow materialization ownership is missing",
      );
    }
    let publication: Awaited<ReturnType<SourceLogicalRevisionPublisher["publish"]>>;
    try {
      publication = await execution.external((signal) =>
        input.logicalRevisions.publish(
          {
            ...(run.capabilityGrantId
              ? { capabilityGrantId: run.capabilityGrantId }
              : {
                  permissionSnapshot: durablePermissionReference(run),
                  requestedBySubjectId: workflowSubjectId(run),
                }),
            contentHash: candidate.contentHash,
            documentAssetId: document.documentAssetId,
            documentAssetVersion: document.documentAssetVersion,
            ...(candidate.etag ? { etag: candidate.etag } : {}),
            knowledgeSpaceId: run.knowledgeSpaceId,
            materializationOwnership: document.workflowOwnership,
            mimeType: document.mimeType,
            ...(candidate.providerCoordinate
              ? { providerCoordinate: candidate.providerCoordinate }
              : {}),
            providerItemId: candidate.providerItemId,
            providerKind: candidate.providerKind,
            remoteDeletionPolicy: remoteDeletionPolicy(source),
            sizeBytes: document.sizeBytes,
            sourceId: source.id,
            tenantId: run.tenantId,
            title: candidate.title,
          },
          {
            assertActive: async () => {
              await execution.assertActive();
            },
            signal,
          },
        ),
      );
    } catch (error) {
      console.error("Source workflow logical revision publication failed", {
        error: error instanceof Error ? error.message : String(error),
        filename: candidate.filename,
        knowledgeSpaceId: run.knowledgeSpaceId,
        sourceId: source.id,
        workflowId: run.id,
        workflowKind: run.kind,
      });
      await input.materializer.compensate({
        documents: [document],
        knowledgeSpaceId: run.knowledgeSpaceId,
        sourceId: source.id,
        tenantId: run.tenantId,
      });
      throw runtimeError(
        "SOURCE_DOCUMENT_COMPILATION_FAILED",
        "Source document compilation failed",
      );
    }
    if (publication.kind === "unchanged") {
      await input.materializer.compensate({
        documents: [document],
        knowledgeSpaceId: run.knowledgeSpaceId,
        sourceId: source.id,
        tenantId: run.tenantId,
      });
    }
  }
}

async function processSourceSync(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<void> {
  const maxItems = input.maxSyncItems ?? 1_000;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 10_000) {
    throw runtimeError("SOURCE_SYNC_LIMIT_INVALID", "Source sync item limit is invalid");
  }
  const inventory = await loadSourceInventory(input, execution, source, maxItems);
  if (source.type === "web") {
    await processWebsiteSync(input, execution, source, inventory, maxItems);
    return;
  }
  if (source.type !== "connector") return;
  const providerKind = await configuredProviderKind(input, execution, source);
  const storedProviderKind = inventoryProviderKind(inventory);
  if (storedProviderKind && storedProviderKind !== providerKind) {
    throw runtimeError(
      "SOURCE_SYNC_PROVIDER_KIND_CONFLICT",
      "Configured provider capability conflicts with logical source provenance",
    );
  }
  const frozenSelection = readFrozenProviderSelection(source.metadata);
  if (frozenSelection && frozenSelection.kind !== providerKind) {
    throw runtimeError(
      "SOURCE_SYNC_PROVIDER_KIND_CONFLICT",
      "Frozen connected-source selection conflicts with the configured provider capability",
    );
  }
  if (frozenSelection) {
    const allowed = new Set(frozenSelection.identityHashes);
    const allowedCoordinates = new Set(frozenSelection.coordinateHashes);
    for (const providerItemId of inventory.keys()) {
      if (!allowed.has(providerSelectionIdentityHash(providerKind, providerItemId))) {
        throw runtimeError(
          "SOURCE_SYNC_SELECTION_MISMATCH",
          "Logical source inventory is outside the frozen provider selection",
        );
      }
      const item = inventory.get(providerItemId);
      const coordinateKey = item ? frozenInventoryCoordinateKey(item, providerKind) : undefined;
      if (
        !coordinateKey ||
        !allowedCoordinates.has(
          providerSelectionCoordinateHash(providerKind, providerItemId, coordinateKey),
        )
      ) {
        throw runtimeError(
          "SOURCE_SYNC_SELECTION_MISMATCH",
          "Logical source provider coordinate is outside the frozen selection",
        );
      }
    }
  }
  // A connected Source is populated only by an explicit durable import. An empty logical
  // inventory must never be interpreted as permission to discover/import the whole provider,
  // including after every selected document has been remotely deleted.
  if (inventory.size === 0) return;
  const selectionAware =
    frozenSelection !== undefined || inventoryHasProviderCoordinates(inventory, providerKind);
  if (providerKind === "online-document") {
    await processOnlineDocumentSync(input, execution, source, inventory, maxItems, selectionAware);
    return;
  }
  if (providerKind === "online-drive") {
    await processOnlineDriveSync(input, execution, source, inventory, maxItems, selectionAware);
  }
}

async function configuredProviderKind(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
): Promise<"online-document" | "online-drive"> {
  let providerId: string | undefined;
  if (source.connectionId) {
    if (!input.sourceConnections) {
      throw runtimeError(
        "SOURCE_CONNECTION_UNAVAILABLE",
        "Source connection resolver is unavailable",
      );
    }
    const run = execution.run();
    const connection = await input.sourceConnections.get({
      connectionId: source.connectionId,
      knowledgeSpaceId: run.knowledgeSpaceId,
      tenantId: run.tenantId,
    });
    providerId = connection?.providerId;
  } else if (typeof source.metadata.providerId === "string") {
    providerId = source.metadata.providerId;
  }
  if (providerId && input.sourceProviders) {
    const provider = await input.sourceProviders.get(providerId);
    const supported = provider?.capabilities.filter(
      (capability) => capability === "online-document" || capability === "online-drive",
    );
    if (provider?.available && supported?.length === 1) {
      return supported[0] as "online-document" | "online-drive";
    }
  }
  const explicit = source.metadata.providerKind;
  if (explicit === "online-document" || explicit === "online-drive") return explicit;
  throw runtimeError(
    "SOURCE_SYNC_PROVIDER_KIND_MISSING",
    "Connector source has no unambiguous configured provider capability",
  );
}

async function loadSourceInventory(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  maxItems: number,
): Promise<ReadonlyMap<string, SourceActiveDocumentInventoryItem>> {
  const run = execution.run();
  const inventory = new Map<string, SourceActiveDocumentInventoryItem>();
  let cursor: { readonly documentId: string; readonly providerItemId: string } | undefined;
  do {
    await execution.assertActive();
    const page = await input.logicalInventory.listActiveBySource({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: run.knowledgeSpaceId,
      limit: Math.min(100, maxItems + 1 - inventory.size),
      sourceId: source.id,
      tenantId: run.tenantId,
    });
    for (const item of page.items) {
      if (inventory.has(item.providerItemId)) {
        throw runtimeError(
          "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
          "Logical source inventory contains a duplicate provider identity",
        );
      }
      inventory.set(item.providerItemId, item);
      if (inventory.size > maxItems) {
        throw runtimeError(
          "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
          "Logical source inventory exceeds its durable item budget",
        );
      }
    }
    cursor = page.nextCursor;
    if (cursor && inventory.size >= maxItems) {
      throw runtimeError(
        "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        "Logical source inventory exceeds its durable item budget",
      );
    }
  } while (cursor);
  return inventory;
}

function inventoryProviderKind(
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
): "online-document" | "online-drive" | undefined {
  let kind: "online-document" | "online-drive" | undefined;
  for (const item of inventory.values()) {
    const provenance = item.systemMetadata.provenance;
    const candidate =
      provenance && typeof provenance === "object" && !Array.isArray(provenance)
        ? (provenance as Record<string, unknown>).providerKind
        : undefined;
    if (candidate !== "online-document" && candidate !== "online-drive") {
      throw runtimeError(
        "SOURCE_SYNC_PROVIDER_KIND_MISSING",
        "Logical source inventory is missing immutable provider provenance",
      );
    }
    if (kind && kind !== candidate) {
      throw runtimeError(
        "SOURCE_SYNC_PROVIDER_KIND_CONFLICT",
        "Logical source inventory mixes incompatible provider kinds",
      );
    }
    kind = candidate;
  }
  return kind;
}

function inventoryHasProviderCoordinates(
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  providerKind: "online-document" | "online-drive",
): boolean {
  for (const item of inventory.values()) {
    const provenance = item.systemMetadata.provenance;
    const coordinate =
      provenance && typeof provenance === "object" && !Array.isArray(provenance)
        ? (provenance as Record<string, unknown>).providerCoordinate
        : undefined;
    if (
      coordinate &&
      typeof coordinate === "object" &&
      !Array.isArray(coordinate) &&
      (coordinate as Record<string, unknown>).kind === providerKind
    ) {
      return true;
    }
  }
  return false;
}

interface OnlineDocumentInventoryEntry {
  readonly page: OnlineDocumentPage;
  readonly workspaceId: string;
}

async function listOnlineDocumentInventory(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  maxItems: number,
): Promise<readonly OnlineDocumentInventoryEntry[]> {
  const items: OnlineDocumentInventoryEntry[] = [];
  const providerIds = new Set<string>();
  const consumedCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (cursor && consumedCursors.has(cursor)) {
      throw runtimeError(
        "SOURCE_SYNC_CURSOR_LOOP",
        "Online-document provider repeated a continuation cursor",
      );
    }
    if (cursor) consumedCursors.add(cursor);
    const run = execution.run();
    const listing = await execution.external(
      (signal) =>
        input.onlineDocuments?.listPages({
          ...(cursor ? { cursor } : {}),
          limit: Math.max(1, Math.min(200, maxItems + 1 - items.length)),
          signal,
          source,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError(
            "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
            "Online-document provider is unavailable",
          ),
        ),
    );
    for (const workspace of listing.workspaces) {
      if (workspace.pages.length > 0 && !workspace.workspaceId) {
        throw runtimeError(
          "SOURCE_SYNC_PROVIDER_IDENTITY_INVALID",
          "Online-document workspace identity is missing",
        );
      }
      for (const page of workspace.pages) {
        if (providerIds.has(page.pageId)) {
          throw runtimeError(
            "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
            "Online-document provider returned a duplicate page identity",
          );
        }
        providerIds.add(page.pageId);
        items.push({ page, workspaceId: workspace.workspaceId as string });
        if (items.length > maxItems) {
          throw runtimeError(
            "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
            "Online-document listing exceeds its durable item budget",
          );
        }
      }
    }
    cursor = listing.nextCursor;
    if (cursor && items.length >= maxItems) {
      throw runtimeError(
        "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        "Online-document listing exceeds its durable item budget",
      );
    }
  } while (cursor);
  return items.sort(
    (left, right) =>
      left.page.pageId.localeCompare(right.page.pageId) ||
      left.workspaceId.localeCompare(right.workspaceId),
  );
}

interface OnlineDriveInventoryFile extends OnlineDriveFile {
  readonly bucket?: string | undefined;
}

async function listOnlineDriveInventory(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  maxItems: number,
): Promise<readonly OnlineDriveInventoryFile[]> {
  const files: OnlineDriveInventoryFile[] = [];
  const providerIds = new Set<string>();
  const pending: Array<{ readonly bucket?: string; readonly continuationToken?: string }> = [{}];
  const consumed = new Set<string>();
  while (pending.length > 0) {
    const request = pending.shift();
    if (!request) break;
    const cursorKey = JSON.stringify([request.bucket ?? null, request.continuationToken ?? null]);
    if (consumed.has(cursorKey)) {
      throw runtimeError(
        "SOURCE_SYNC_CURSOR_LOOP",
        "Online-drive provider repeated a continuation cursor",
      );
    }
    consumed.add(cursorKey);
    const run = execution.run();
    const listing = await execution.external(
      (signal) =>
        input.onlineDrive?.browse({
          ...(request.bucket ? { bucket: request.bucket } : {}),
          ...(request.continuationToken ? { continuationToken: request.continuationToken } : {}),
          maxKeys: Math.max(1, Math.min(200, maxItems + 1 - files.length)),
          signal,
          source,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable"),
        ),
    );
    for (const bucket of listing.buckets) {
      for (const file of bucket.files) {
        if (file.type === "folder") continue;
        if (providerIds.has(file.id)) {
          throw runtimeError(
            "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
            "Online-drive provider returned a duplicate file identity",
          );
        }
        providerIds.add(file.id);
        files.push({ ...file, ...(bucket.bucket ? { bucket: bucket.bucket } : {}) });
        if (files.length > maxItems) {
          throw runtimeError(
            "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
            "Online-drive listing exceeds its durable item budget",
          );
        }
      }
      if (bucket.isTruncated) {
        if (!bucket.continuationToken) {
          throw runtimeError(
            "SOURCE_SYNC_CURSOR_INVALID",
            "Online-drive provider omitted a required continuation cursor",
          );
        }
        pending.push({
          ...(bucket.bucket ? { bucket: bucket.bucket } : {}),
          continuationToken: bucket.continuationToken,
        });
      }
    }
    if (pending.length > 0 && files.length >= maxItems) {
      throw runtimeError(
        "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        "Online-drive listing exceeds its durable item budget",
      );
    }
  }
  return files.sort(
    (left, right) =>
      left.id.localeCompare(right.id) || (left.bucket ?? "").localeCompare(right.bucket ?? ""),
  );
}

interface SelectedOnlineDocumentInventoryEntry extends OnlineDocumentInventoryEntry {
  readonly providerItemId: string;
}

async function listSelectedOnlineDocumentInventory(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  maxItems: number,
): Promise<readonly SelectedOnlineDocumentInventoryEntry[]> {
  const selections = [...inventory.values()].map((item) => ({
    coordinate: onlineDocumentCoordinate(item),
    item,
  }));
  const found = new Map<string, SelectedOnlineDocumentInventoryEntry>();
  const consumedCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (cursor && consumedCursors.has(cursor)) {
      throw runtimeError(
        "SOURCE_SYNC_CURSOR_LOOP",
        "Online-document provider repeated a continuation cursor",
      );
    }
    if (cursor) consumedCursors.add(cursor);
    const run = execution.run();
    const listing = await execution.external(
      (signal) =>
        input.onlineDocuments?.listPages({
          ...(cursor ? { cursor } : {}),
          limit: Math.max(1, Math.min(200, maxItems)),
          signal,
          source,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError(
            "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
            "Online-document provider is unavailable",
          ),
        ),
    );
    for (const workspace of listing.workspaces) {
      const listedWorkspaceId = workspace.workspaceId?.trim() || undefined;
      for (const page of workspace.pages) {
        const matching = selections.filter(({ coordinate, item }) =>
          onlineDocumentSelectionMatches(item.providerItemId, coordinate, listedWorkspaceId, page),
        );
        if (matching.length === 0) continue;
        if (matching.length !== 1) {
          throw runtimeError(
            "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
            "Frozen online-document selection maps multiple identities to one provider page",
          );
        }
        const selection = matching[0];
        if (!selection) continue;
        if (found.has(selection.item.providerItemId)) {
          throw runtimeError(
            "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
            "Online-document provider returned a duplicate selected page identity",
          );
        }
        const workspaceId = listedWorkspaceId ?? selection.coordinate?.workspaceId;
        if (!workspaceId) {
          throw runtimeError(
            "SOURCE_SYNC_PROVIDER_IDENTITY_INVALID",
            "Selected online-document workspace identity is missing",
          );
        }
        found.set(selection.item.providerItemId, {
          page,
          providerItemId: selection.item.providerItemId,
          workspaceId,
        });
      }
    }
    cursor = listing.nextCursor;
    if (cursor && consumedCursors.size >= maxItems) {
      throw runtimeError(
        "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        "Online-document listing exceeds its durable scan budget",
      );
    }
  } while (cursor && found.size < selections.length);
  return [...found.values()].sort((left, right) =>
    left.providerItemId.localeCompare(right.providerItemId),
  );
}

function onlineDocumentSelectionMatches(
  providerItemId: string,
  coordinate: Extract<SourceProviderCoordinate, { readonly kind: "online-document" }> | undefined,
  listedWorkspaceId: string | undefined,
  page: OnlineDocumentPage,
): boolean {
  if (coordinate) {
    return (
      coordinate.pageId === page.pageId &&
      (listedWorkspaceId === undefined || coordinate.workspaceId === listedWorkspaceId)
    );
  }
  const tuple = compositeProviderItemId(providerItemId);
  if (tuple) {
    return (
      tuple[1] === page.pageId &&
      (listedWorkspaceId === undefined || tuple[0] === listedWorkspaceId)
    );
  }
  return providerItemId === page.pageId;
}

interface SelectedOnlineDriveInventoryFile extends OnlineDriveInventoryFile {
  readonly mimeType: string;
  readonly providerItemId: string;
}

async function listSelectedOnlineDriveInventory(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  maxItems: number,
): Promise<readonly SelectedOnlineDriveInventoryFile[]> {
  const files: SelectedOnlineDriveInventoryFile[] = [];
  const scanBudget = { remaining: maxItems };
  for (const item of inventory.values()) {
    const coordinate = onlineDriveCoordinate(item);
    const listed = await findSelectedOnlineDriveFile(
      input,
      execution,
      source,
      coordinate,
      scanBudget,
    );
    if (listed === null) continue;
    files.push({
      ...(coordinate.bucket ? { bucket: coordinate.bucket } : {}),
      id: coordinate.id,
      mimeType: coordinate.mimeType ?? "application/octet-stream",
      name: listed?.name ?? coordinate.name,
      providerItemId: item.providerItemId,
      ...(listed?.size === undefined ? {} : { size: listed.size }),
      type: "file",
    });
  }
  return files.sort((left, right) => left.providerItemId.localeCompare(right.providerItemId));
}

async function findSelectedOnlineDriveFile(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  coordinate: Extract<SourceProviderCoordinate, { readonly kind: "online-drive" }>,
  scanBudget: { remaining: number },
): Promise<OnlineDriveFile | null | undefined> {
  if (!coordinate.bucket) return undefined;
  const pending: Array<string | undefined> = [undefined];
  const consumed = new Set<string>();
  let authoritative = false;
  while (pending.length > 0) {
    const continuationToken = pending.shift();
    const cursorKey = continuationToken ?? "__first__";
    if (consumed.has(cursorKey)) {
      throw runtimeError(
        "SOURCE_SYNC_CURSOR_LOOP",
        "Online-drive provider repeated a continuation cursor",
      );
    }
    consumed.add(cursorKey);
    if (scanBudget.remaining < 1) {
      throw runtimeError(
        "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        "Online-drive selected-file lookups exceed their shared durable scan budget",
      );
    }
    scanBudget.remaining -= 1;
    const run = execution.run();
    const listing = await execution.external(
      (signal) =>
        input.onlineDrive?.browse({
          bucket: coordinate.bucket,
          ...(continuationToken ? { continuationToken } : {}),
          maxKeys: 200,
          prefix: coordinate.id,
          signal,
          source,
          tenantId: run.tenantId,
          userId: workflowSubjectId(run),
        }) ??
        Promise.reject(
          runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable"),
        ),
    );
    for (const bucket of listing.buckets) {
      if (bucket.bucket !== undefined && bucket.bucket !== coordinate.bucket) continue;
      if (
        bucket.files.length > 0 ||
        bucket.isTruncated !== undefined ||
        bucket.continuationToken !== undefined
      ) {
        authoritative = true;
      }
      const file = bucket.files.find(
        (candidate) => candidate.type !== "folder" && candidate.id === coordinate.id,
      );
      if (file) return file;
      if (bucket.isTruncated) {
        if (!bucket.continuationToken) {
          throw runtimeError(
            "SOURCE_SYNC_CURSOR_INVALID",
            "Online-drive provider omitted a required continuation cursor",
          );
        }
        pending.push(bucket.continuationToken);
      }
    }
  }
  // An empty/root-shaped response does not prove that a selected bucket object disappeared.
  // The subsequent direct download is fail-safe: transient/not-found errors fail the run instead
  // of tombstoning a valid selected document.
  return authoritative ? null : undefined;
}

function onlineDocumentCoordinate(
  item: SourceActiveDocumentInventoryItem,
): Extract<SourceProviderCoordinate, { readonly kind: "online-document" }> | undefined {
  const raw = providerCoordinate(item);
  if (raw === undefined) return undefined;
  if (
    raw.kind !== "online-document" ||
    !coordinateString(raw.pageId) ||
    !coordinateString(raw.type) ||
    !coordinateString(raw.workspaceId)
  ) {
    throw runtimeError(
      "SOURCE_SYNC_PROVIDER_COORDINATE_INVALID",
      "Selected online-document coordinate is invalid",
    );
  }
  const coordinate = {
    kind: "online-document",
    pageId: raw.pageId,
    type: raw.type,
    workspaceId: raw.workspaceId,
  } as const;
  const tuple = compositeProviderItemId(item.providerItemId);
  if (tuple && (tuple[0] !== coordinate.workspaceId || tuple[1] !== coordinate.pageId)) {
    throw runtimeError(
      "SOURCE_SYNC_SELECTION_MISMATCH",
      "Selected online-document identity does not match its provider coordinate",
    );
  }
  return coordinate;
}

function onlineDriveCoordinate(
  item: SourceActiveDocumentInventoryItem,
): Extract<SourceProviderCoordinate, { readonly kind: "online-drive" }> {
  const raw = providerCoordinate(item);
  if (raw !== undefined) {
    if (
      raw.kind !== "online-drive" ||
      !coordinateString(raw.id) ||
      !coordinateString(raw.name) ||
      (raw.bucket !== undefined && !coordinateString(raw.bucket)) ||
      (raw.mimeType !== undefined && !coordinateString(raw.mimeType))
    ) {
      throw runtimeError(
        "SOURCE_SYNC_PROVIDER_COORDINATE_INVALID",
        "Selected online-drive coordinate is invalid",
      );
    }
    const coordinate = {
      ...(raw.bucket ? { bucket: raw.bucket } : {}),
      id: raw.id,
      kind: "online-drive",
      ...(raw.mimeType ? { mimeType: raw.mimeType } : {}),
      name: raw.name,
    } as const;
    const tuple = compositeProviderItemId(item.providerItemId);
    if (tuple && ((tuple[0] || undefined) !== coordinate.bucket || tuple[1] !== coordinate.id)) {
      throw runtimeError(
        "SOURCE_SYNC_SELECTION_MISMATCH",
        "Selected online-drive identity does not match its provider coordinate",
      );
    }
    return coordinate;
  }
  const tuple = compositeProviderItemId(item.providerItemId);
  const id = tuple?.[1] ?? item.providerItemId;
  return {
    ...(tuple?.[0] ? { bucket: tuple[0] } : {}),
    id,
    kind: "online-drive",
    name: providerFilename(id),
  };
}

function providerCoordinate(
  item: SourceActiveDocumentInventoryItem,
): Record<string, unknown> | undefined {
  const provenance = item.systemMetadata.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return undefined;
  const raw = (provenance as Record<string, unknown>).providerCoordinate;
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw runtimeError(
      "SOURCE_SYNC_PROVIDER_COORDINATE_INVALID",
      "Selected provider coordinate is invalid",
    );
  }
  return raw as Record<string, unknown>;
}

function frozenInventoryCoordinateKey(
  item: SourceActiveDocumentInventoryItem,
  kind: FrozenProviderSelection["kind"],
): string | undefined {
  const raw = providerCoordinate(item);
  if (raw) {
    if (raw.kind !== kind) return undefined;
    if (kind === "online-document") {
      return coordinateString(raw.workspaceId) && coordinateString(raw.pageId)
        ? JSON.stringify([raw.workspaceId, raw.pageId])
        : undefined;
    }
    return coordinateString(raw.id) && (raw.bucket === undefined || coordinateString(raw.bucket))
      ? JSON.stringify([raw.bucket ?? "", raw.id])
      : undefined;
  }
  const tuple = compositeProviderItemId(item.providerItemId);
  if (!tuple || (kind === "online-document" && !tuple[0].trim())) return undefined;
  return JSON.stringify(tuple);
}

function compositeProviderItemId(providerItemId: string): readonly [string, string] | undefined {
  if (!providerItemId.startsWith("[")) return undefined;
  try {
    const tuple = JSON.parse(providerItemId) as unknown;
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 2 ||
      typeof tuple[0] !== "string" ||
      typeof tuple[1] !== "string" ||
      !tuple[1].trim()
    ) {
      return undefined;
    }
    return [tuple[0], tuple[1]];
  } catch {
    return undefined;
  }
}

function coordinateString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 8_192;
}

function providerFilename(id: string): string {
  const name = id.split("/").filter(Boolean).at(-1);
  return name?.slice(0, 8_192) || "provider-file";
}

async function processWebsiteSync(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  maxItems: number,
): Promise<void> {
  if (!input.websiteCrawl) {
    throw runtimeError(
      "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
      "Website crawl provider is unavailable",
    );
  }
  const initial = execution.run();
  const connectorSource = await execution.external(() =>
    resolveSource(input, source, initial.tenantId),
  );
  const result = await execution.external(
    (signal) =>
      input.websiteCrawl?.crawl({
        signal,
        source: connectorSource,
        tenantId: initial.tenantId,
        userId: workflowSubjectId(initial),
      }) ??
      Promise.reject(
        runtimeError("SOURCE_CRAWL_PROVIDER_UNAVAILABLE", "Website crawl provider is unavailable"),
      ),
  );
  if (result.pages.length > maxItems) {
    throw runtimeError(
      "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
      "Website sync result exceeds its durable item budget",
    );
  }
  const pages = result.pages
    .map((page) => ({
      ...page,
      providerItemId: createHash("sha256").update(page.sourceUrl, "utf8").digest("hex"),
    }))
    .sort(
      (left, right) =>
        left.providerItemId.localeCompare(right.providerItemId) ||
        left.sourceUrl.localeCompare(right.sourceUrl),
    );
  const fingerprint = providerListingFingerprint(
    "website",
    pages.map((page) => [page.providerItemId, page.sourceUrl, page.content]),
  );
  const cursor = requireMatchingSyncCursor(initial.cursor, "website", fingerprint);
  if (cursor.phase === "eof") return;
  const missing = missingInventory(inventory, new Set(pages.map((page) => page.providerItemId)));
  if (cursor.phase === "missing") {
    await processRemoteMissing(input, execution, source, fingerprint, missing, cursor.offset);
    return;
  }
  for (const [index, page] of pages.entries()) {
    if (index < cursor.offset) continue;
    const body = encoder.encode(page.content);
    const contentHash = createHash("sha256").update(body).digest("hex");
    const providerItemId = page.providerItemId;
    const filename = webFilename(page.title ?? page.sourceUrl, providerItemId);
    const prior = inventory.get(providerItemId);
    if (prior?.enabled !== false && prior?.contentHash !== contentHash) {
      await materializeCandidates(
        input,
        execution,
        source,
        [
          {
            body,
            filename,
            metadata: {
              dataSourceInfo: { contentHash, providerItemId, sourceUrl: page.sourceUrl },
              dataSourceType: "website_crawl",
            },
            mimeType: "text/markdown",
          },
        ],
        [
          {
            contentHash,
            filename,
            mimeType: "text/markdown",
            providerItemId,
            providerKind: "website",
            sizeBytes: body.byteLength,
            title: page.title ?? page.sourceUrl,
          },
        ],
      );
    }
    await checkpointProviderSync(input, execution, {
      fingerprint,
      kind: "website",
      offset: index + 1,
      phase: "items",
      progressCompleted: index + 1,
      progressTotal: pages.length + missing.length,
    });
  }
  await checkpointProviderSync(input, execution, {
    fingerprint,
    kind: "website",
    offset: 0,
    phase: "missing",
    progressCompleted: pages.length,
    progressTotal: pages.length + missing.length,
  });
  await processRemoteMissing(input, execution, source, fingerprint, missing, 0);
}

async function processOnlineDocumentSync(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  maxItems: number,
  selectionAware: boolean,
): Promise<void> {
  if (!input.onlineDocuments) {
    throw runtimeError(
      "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
      "Online-document provider is unavailable",
    );
  }
  const initial = execution.run();
  const connectorSource = await execution.external(() =>
    resolveSource(input, source, initial.tenantId),
  );
  if (selectionAware && inventory.size === 0) return;
  const entries: readonly SelectedOnlineDocumentInventoryEntry[] = selectionAware
    ? await listSelectedOnlineDocumentInventory(
        input,
        execution,
        connectorSource,
        inventory,
        maxItems,
      )
    : (await listOnlineDocumentInventory(input, execution, connectorSource, maxItems)).map(
        (entry) => ({ ...entry, providerItemId: entry.page.pageId }),
      );
  const fingerprint = providerListingFingerprint(
    "online-document",
    entries.map(({ page, providerItemId, workspaceId }) =>
      selectionAware
        ? [providerItemId, page.pageId, workspaceId, page.lastEditedTime ?? "", page.type]
        : [page.pageId, workspaceId, page.lastEditedTime ?? "", page.type],
    ),
  );
  const cursor = requireMatchingSyncCursor(initial.cursor, "online-document", fingerprint);
  if (cursor.phase === "eof") return;
  const missing = missingInventory(
    inventory,
    new Set(entries.map(({ providerItemId }) => providerItemId)),
  );
  if (cursor.phase === "missing") {
    await processRemoteMissing(input, execution, source, fingerprint, missing, cursor.offset);
    return;
  }
  for (const [index, { page, providerItemId, workspaceId }] of entries.entries()) {
    if (index < cursor.offset) continue;
    const prior = inventory.get(providerItemId);
    if (
      prior?.enabled !== false &&
      (!prior || !page.lastEditedTime || prior.etag !== page.lastEditedTime)
    ) {
      const run = execution.run();
      const content = await execution.external(
        (signal) =>
          input.onlineDocuments?.getPageContent({
            page: { pageId: page.pageId, type: page.type, workspaceId },
            signal,
            source: connectorSource,
            tenantId: run.tenantId,
            userId: workflowSubjectId(run),
          }) ??
          Promise.reject(
            runtimeError(
              "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
              "Online-document provider is unavailable",
            ),
          ),
      );
      const body = encoder.encode(content.content);
      const contentHash = createHash("sha256").update(body).digest("hex");
      if (!prior || prior.contentHash !== contentHash) {
        const filename = webFilename(page.pageName, page.pageId);
        await materializeCandidates(
          input,
          execution,
          source,
          [
            {
              body,
              filename,
              metadata: {
                dataSourceInfo: {
                  contentHash,
                  pageId: page.pageId,
                  providerItemId,
                  workspaceId,
                },
                dataSourceType: "online_document",
              },
              mimeType: "text/markdown",
            },
          ],
          [
            {
              contentHash,
              ...(page.lastEditedTime ? { etag: page.lastEditedTime } : {}),
              filename,
              mimeType: "text/markdown",
              providerCoordinate: {
                kind: "online-document",
                pageId: page.pageId,
                type: page.type,
                workspaceId,
              },
              providerItemId,
              providerKind: "online-document",
              sizeBytes: body.byteLength,
              title: page.pageName,
            },
          ],
        );
      }
    }
    await checkpointProviderSync(input, execution, {
      fingerprint,
      kind: "online-document",
      offset: index + 1,
      phase: "items",
      progressCompleted: index + 1,
      progressTotal: entries.length + missing.length,
    });
  }
  await checkpointProviderSync(input, execution, {
    fingerprint,
    kind: "online-document",
    offset: 0,
    phase: "missing",
    progressCompleted: entries.length,
    progressTotal: entries.length + missing.length,
  });
  await processRemoteMissing(input, execution, source, fingerprint, missing, 0);
}

async function processOnlineDriveSync(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  maxItems: number,
  selectionAware: boolean,
): Promise<void> {
  if (!input.onlineDrive) {
    throw runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable");
  }
  const initial = execution.run();
  const connectorSource = await execution.external(() =>
    resolveSource(input, source, initial.tenantId),
  );
  if (selectionAware && inventory.size === 0) return;
  const files: readonly SelectedOnlineDriveInventoryFile[] = selectionAware
    ? await listSelectedOnlineDriveInventory(input, execution, connectorSource, inventory, maxItems)
    : (await listOnlineDriveInventory(input, execution, connectorSource, maxItems)).map((file) => ({
        ...file,
        mimeType: "application/octet-stream",
        providerItemId: file.id,
      }));
  const fingerprint = providerListingFingerprint(
    "online-drive",
    files.map((file) =>
      selectionAware
        ? [file.providerItemId, file.id, file.bucket ?? "", file.name, file.size ?? ""]
        : [file.id, file.bucket ?? "", file.name, file.size ?? ""],
    ),
  );
  const cursor = requireMatchingSyncCursor(initial.cursor, "online-drive", fingerprint);
  if (cursor.phase === "eof") return;
  const missing = missingInventory(inventory, new Set(files.map((file) => file.providerItemId)));
  if (cursor.phase === "missing") {
    await processRemoteMissing(input, execution, source, fingerprint, missing, cursor.offset);
    return;
  }
  for (const [index, file] of files.entries()) {
    if (index < cursor.offset) continue;
    const providerItemId = file.providerItemId;
    const prior = inventory.get(providerItemId);
    if (prior?.enabled !== false) {
      const run = execution.run();
      const download = await execution.external(
        (signal) =>
          input.onlineDrive?.download({
            file: { id: file.id, ...(file.bucket ? { bucket: file.bucket } : {}) },
            signal,
            source: connectorSource,
            tenantId: run.tenantId,
            userId: workflowSubjectId(run),
          }) ??
          Promise.reject(
            runtimeError("SOURCE_ONLINE_DRIVE_UNAVAILABLE", "Online-drive provider is unavailable"),
          ),
      );
      const contentHash = createHash("sha256").update(download.body).digest("hex");
      if (!prior || prior.contentHash !== contentHash) {
        const mimeType = file.mimeType;
        await materializeCandidates(
          input,
          execution,
          source,
          [
            {
              body: download.body,
              filename: file.name,
              metadata: {
                dataSourceInfo: {
                  ...(file.bucket ? { bucket: file.bucket } : {}),
                  contentHash,
                  fileId: file.id,
                  providerItemId,
                },
                dataSourceType: "online_drive",
              },
              mimeType,
            },
          ],
          [
            {
              contentHash,
              filename: file.name,
              mimeType,
              providerCoordinate: {
                ...(file.bucket ? { bucket: file.bucket } : {}),
                id: file.id,
                kind: "online-drive",
                mimeType,
                name: file.name,
              },
              providerItemId,
              providerKind: "online-drive",
              sizeBytes: download.body.byteLength,
              title: file.name,
            },
          ],
        );
      }
    }
    await checkpointProviderSync(input, execution, {
      fingerprint,
      kind: "online-drive",
      offset: index + 1,
      phase: "items",
      progressCompleted: index + 1,
      progressTotal: files.length + missing.length,
    });
  }
  await checkpointProviderSync(input, execution, {
    fingerprint,
    kind: "online-drive",
    offset: 0,
    phase: "missing",
    progressCompleted: files.length,
    progressTotal: files.length + missing.length,
  });
  await processRemoteMissing(input, execution, source, fingerprint, missing, 0);
}

async function checkpointSyncItem(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  completed: number,
  total?: number,
): Promise<void> {
  await execution.mutate((latest) =>
    input.repository.checkpoint({
      checkpoint: "materialized",
      fence: fence(latest),
      now: iso((input.now ?? Date.now)()),
      progressCompleted: completed,
      ...(total === undefined ? {} : { progressTotal: total }),
      state: "syncing",
    }),
  );
}

interface SourceSyncCursor {
  readonly fingerprint: string;
  readonly kind: "website" | "online-document" | "online-drive";
  readonly offset: number;
  readonly phase: "items" | "missing" | "eof";
}

async function checkpointProviderSync(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  state: SourceSyncCursor & {
    readonly progressCompleted: number;
    readonly progressTotal: number;
  },
): Promise<void> {
  await execution.mutate((latest) =>
    input.repository.checkpoint({
      checkpoint: "provider-read",
      cursor: encodeSourceSyncCursor(state),
      fence: fence(latest),
      now: iso((input.now ?? Date.now)()),
      progressCompleted: state.progressCompleted,
      progressTotal: state.progressTotal,
      state: "syncing",
    }),
  );
}

function encodeSourceSyncCursor(cursor: SourceSyncCursor): string {
  return `ss1:${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeSourceSyncCursor(value: string): SourceSyncCursor {
  if (!value.startsWith("ss1:") || value.length > 4_096) {
    throw runtimeError("SOURCE_SYNC_CURSOR_INVALID", "Source sync cursor is invalid");
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice("ss1:".length), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      !Number.isSafeInteger(decoded.offset) ||
      (decoded.offset as number) < 0 ||
      !["website", "online-document", "online-drive"].includes(String(decoded.kind)) ||
      !["items", "missing", "eof"].includes(String(decoded.phase)) ||
      typeof decoded.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(decoded.fingerprint)
    ) {
      throw new Error("invalid cursor payload");
    }
    return {
      fingerprint: decoded.fingerprint,
      kind: decoded.kind as SourceSyncCursor["kind"],
      offset: decoded.offset as number,
      phase: decoded.phase as SourceSyncCursor["phase"],
    };
  } catch {
    throw runtimeError("SOURCE_SYNC_CURSOR_INVALID", "Source sync cursor is invalid");
  }
}

function providerListingFingerprint(
  kind: SourceSyncCursor["kind"],
  rows: readonly (readonly (string | number)[])[],
): string {
  const hash = createHash("sha256");
  hash.update(`${kind}\0${rows.length}\0`, "utf8");
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    hash.update(`${Buffer.byteLength(serialized, "utf8")}:`, "utf8");
    hash.update(serialized, "utf8");
  }
  return hash.digest("hex");
}

function requireMatchingSyncCursor(
  value: string | undefined,
  kind: SourceSyncCursor["kind"],
  fingerprint: string,
): SourceSyncCursor {
  if (!value) return { fingerprint, kind, offset: 0, phase: "items" };
  const cursor = decodeSourceSyncCursor(value);
  if (cursor.kind !== kind || cursor.fingerprint !== fingerprint) {
    throw runtimeError(
      "SOURCE_SYNC_LISTING_CHANGED",
      "Provider listing changed while resuming a durable source sync checkpoint",
    );
  }
  return cursor;
}

function missingInventory(
  inventory: ReadonlyMap<string, SourceActiveDocumentInventoryItem>,
  seenProviderItemIds: ReadonlySet<string>,
): readonly SourceActiveDocumentInventoryItem[] {
  return [...inventory.values()]
    .filter((item) => item.enabled !== false && !seenProviderItemIds.has(item.providerItemId))
    .sort(
      (left, right) =>
        left.providerItemId.localeCompare(right.providerItemId) ||
        left.documentId.localeCompare(right.documentId),
    );
}

async function processRemoteMissing(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  fingerprint: string,
  missing: readonly SourceActiveDocumentInventoryItem[],
  offset: number,
): Promise<void> {
  const policy = remoteDeletionPolicy(source);
  if (policy === "tombstone" && !input.logicalRevisions.markRemoteMissing) {
    throw runtimeError(
      "SOURCE_REMOTE_DELETION_UNAVAILABLE",
      "Logical document tombstoning is unavailable",
    );
  }
  const initial = execution.run();
  const total = initial.progressTotal ?? missing.length;
  const completedBeforeMissing = Math.max(0, total - missing.length);
  for (const [index, item] of missing.entries()) {
    if (index < offset) continue;
    if (policy === "tombstone") {
      const run = execution.run();
      await execution.external(
        (signal) =>
          input.logicalRevisions.markRemoteMissing?.(
            {
              ...(run.capabilityGrantId
                ? { capabilityGrantId: run.capabilityGrantId }
                : {
                    permissionSnapshot: durablePermissionReference(run),
                    requestedBySubjectId: workflowSubjectId(run),
                  }),
              documentId: item.documentId,
              knowledgeSpaceId: run.knowledgeSpaceId,
              now: iso((input.now ?? Date.now)()),
              policy,
              providerItemId: item.providerItemId,
              sourceId: source.id,
              tenantId: run.tenantId,
            },
            {
              assertActive: async () => {
                await execution.assertActive();
              },
              signal,
            },
          ) ??
          Promise.reject(
            runtimeError(
              "SOURCE_REMOTE_DELETION_UNAVAILABLE",
              "Logical document tombstoning is unavailable",
            ),
          ),
      );
    }
    await checkpointProviderSync(input, execution, {
      fingerprint,
      kind: source.type === "web" ? "website" : inventoryItemProviderKind(item),
      offset: index + 1,
      phase: "missing",
      progressCompleted: completedBeforeMissing + index + 1,
      progressTotal: total,
    });
  }
  const run = execution.run();
  const kind =
    source.type === "web"
      ? "website"
      : missing[0]
        ? inventoryItemProviderKind(missing[0])
        : decodeSourceSyncCursor(run.cursor ?? "").kind;
  await checkpointProviderSync(input, execution, {
    fingerprint,
    kind,
    offset: 0,
    phase: "eof",
    progressCompleted: total,
    progressTotal: total,
  });
}

function inventoryItemProviderKind(
  item: SourceActiveDocumentInventoryItem,
): "online-document" | "online-drive" {
  const provenance = item.systemMetadata.provenance;
  const kind =
    provenance && typeof provenance === "object" && !Array.isArray(provenance)
      ? (provenance as Record<string, unknown>).providerKind
      : undefined;
  if (kind !== "online-document" && kind !== "online-drive") {
    throw runtimeError(
      "SOURCE_SYNC_PROVIDER_KIND_MISSING",
      "Logical source inventory is missing immutable provider provenance",
    );
  }
  return kind;
}

async function processBulk(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  bulkChildPollMs: number,
): Promise<boolean> {
  const eofCursor = "bulk-eof:v1";
  // A bulk aggregation pass always restarts from the frozen item-set head. This makes a crash
  // after an EOF checkpoint harmless and ensures a pending child on an earlier page cannot be
  // forgotten when the parent is reclaimed.
  let cursor: string | undefined;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let pending = false;
  do {
    await execution.assertActive();
    const run = execution.run();
    const page = await input.repository.listBulkItems({
      ...(cursor ? { cursor } : {}),
      limit: 100,
      runId: run.id,
    });
    for (const item of page.items) {
      if (item.status === "skipped") {
        skipped += 1;
        continue;
      }
      if (item.status === "completed") {
        completed += 1;
        continue;
      }
      if (item.status === "failed") {
        failed += 1;
        continue;
      }
      try {
        await execution.assertActive();
        if (item.status === "running") {
          if (item.action === "remove") {
            if (!input.bulkRemoval || !item.deletionJobId) {
              throw runtimeError(
                "SOURCE_BULK_REMOVAL_JOB_NOT_FOUND",
                "Bulk remove item is missing its durable deletion job identity",
              );
            }
            const current = execution.run();
            const removal = await execution.external(
              () =>
                input.bulkRemoval?.get({
                  deletionJobId: item.deletionJobId as string,
                  knowledgeSpaceId: current.knowledgeSpaceId,
                  sourceId: item.sourceId,
                  tenantId: current.tenantId,
                }) ??
                Promise.reject(
                  runtimeError(
                    "SOURCE_BULK_REMOVE_UNAVAILABLE",
                    "Durable source deletion is unavailable",
                  ),
                ),
            );
            if (!removal) {
              throw runtimeError(
                "SOURCE_BULK_REMOVAL_JOB_NOT_FOUND",
                "Durable source deletion job is missing or has mismatched provenance",
              );
            }
            if (removal.state === "pending") {
              pending = true;
              continue;
            }
            await execution.mutate((latest) =>
              input.repository
                .markBulkItem({
                  ...(removal.state === "failed"
                    ? {
                        errorCode: removal.errorCode ?? "SOURCE_DURABLE_DELETION_FAILED",
                        reason: removal.reason ?? "Durable source deletion failed",
                      }
                    : {}),
                  fence: fence(latest),
                  itemId: item.id,
                  now: iso((input.now ?? Date.now)()),
                  runId: latest.id,
                  status: removal.state === "succeeded" ? "completed" : "failed",
                })
                .then(() => latest),
            );
            if (removal.state === "succeeded") completed += 1;
            else failed += 1;
            continue;
          }
          if (item.action !== "sync" || !item.childRunId) {
            throw runtimeError(
              "SOURCE_BULK_CHILD_NOT_FOUND",
              "Bulk sync item is missing its durable child workflow identity",
            );
          }
          const current = execution.run();
          const child = await input.repository.get({
            knowledgeSpaceId: current.knowledgeSpaceId,
            runId: item.childRunId,
            tenantId: current.tenantId,
          });
          if (!child || child.kind !== "sync" || child.sourceId !== item.sourceId) {
            throw runtimeError(
              "SOURCE_BULK_CHILD_NOT_FOUND",
              "Bulk sync child workflow is missing or has mismatched provenance",
            );
          }
          if (child.state === "completed" || child.state === "zero_results") {
            await execution.mutate((latest) =>
              input.repository
                .markBulkItem({
                  fence: fence(latest),
                  itemId: item.id,
                  now: iso((input.now ?? Date.now)()),
                  runId: latest.id,
                  status: "completed",
                })
                .then(() => latest),
            );
            completed += 1;
            continue;
          }
          if (child.state === "failed" || child.state === "canceled") {
            await execution.mutate((latest) =>
              input.repository
                .markBulkItem({
                  errorCode:
                    child.lastErrorCode ??
                    (child.state === "canceled"
                      ? "SOURCE_BULK_CHILD_CANCELED"
                      : "SOURCE_BULK_CHILD_FAILED"),
                  fence: fence(latest),
                  itemId: item.id,
                  now: iso((input.now ?? Date.now)()),
                  reason:
                    child.lastErrorMessage ??
                    `Bulk sync child workflow reached terminal state ${child.state}`,
                  runId: latest.id,
                  status: "failed",
                })
                .then(() => latest),
            );
            failed += 1;
            continue;
          }
          pending = true;
          continue;
        }
        if (item.action === "sync") {
          await execution.mutate((latest) =>
            input.repository
              .enqueueBulkSyncChild({
                fence: fence(latest),
                itemId: item.id,
                now: iso((input.now ?? Date.now)()),
                runId: latest.id,
              })
              .then((result) => result.parent),
          );
          pending = true;
          continue;
        }
        if (item.action === "remove") {
          if (!input.bulkRemoval) {
            throw runtimeError(
              "SOURCE_BULK_REMOVE_UNAVAILABLE",
              "Durable source deletion is unavailable",
            );
          }
          const bulkRemoval = input.bulkRemoval;
          const current = execution.run();
          const idempotencyKey = `source-bulk:${current.id}:${item.sourceId}`;
          let removal = await execution.external(() =>
            bulkRemoval.find({
              idempotencyKey,
              knowledgeSpaceId: current.knowledgeSpaceId,
              sourceId: item.sourceId,
              tenantId: current.tenantId,
            }),
          );
          if (!removal) {
            const source = await input.sources.get({
              id: item.sourceId,
              knowledgeSpaceId: current.knowledgeSpaceId,
            });
            if (!source) throw runtimeError("SOURCE_NOT_FOUND", "Source not found");
            removal = await execution.external(() =>
              bulkRemoval.request({
                ...(execution.run().capabilityGrantId
                  ? { capabilityGrantId: execution.run().capabilityGrantId }
                  : { permissionFence: durablePermissionFence(execution.run()) }),
                expectedSourceVersion: source.version,
                idempotencyKey,
                knowledgeSpaceId: source.knowledgeSpaceId,
                sourceId: source.id,
                tenantId: current.tenantId,
              }),
            );
          }
          if (!removal) {
            throw runtimeError(
              "SOURCE_BULK_REMOVAL_JOB_NOT_FOUND",
              "Durable source deletion request did not return a child job",
            );
          }
          await execution.mutate((latest) =>
            input.repository
              .attachBulkRemovalJob({
                deletionJobId: removal.deletionJobId,
                fence: fence(latest),
                itemId: item.id,
                now: iso((input.now ?? Date.now)()),
                runId: latest.id,
              })
              .then((result) => result.parent),
          );
          if (removal.state === "failed") {
            await execution.mutate((latest) =>
              input.repository
                .markBulkItem({
                  errorCode: removal.errorCode ?? "SOURCE_DURABLE_DELETION_FAILED",
                  fence: fence(latest),
                  itemId: item.id,
                  now: iso((input.now ?? Date.now)()),
                  reason: removal.reason ?? "Durable source deletion failed",
                  runId: latest.id,
                  status: "failed",
                })
                .then(() => latest),
            );
            failed += 1;
            continue;
          }
          if (removal.state === "succeeded") {
            await execution.mutate((latest) =>
              input.repository
                .markBulkItem({
                  fence: fence(latest),
                  itemId: item.id,
                  now: iso((input.now ?? Date.now)()),
                  runId: latest.id,
                  status: "completed",
                })
                .then(() => latest),
            );
            completed += 1;
            continue;
          }
          pending = true;
          continue;
        }
        const source = await input.sources.get({
          id: item.sourceId,
          knowledgeSpaceId: run.knowledgeSpaceId,
        });
        if (!source) throw runtimeError("SOURCE_NOT_FOUND", "Source not found");
        const sourceDeletionToken = await input.deletionFence.captureDeletionFence({
          knowledgeSpaceId: run.knowledgeSpaceId,
          sourceId: source.id,
          tenantId: run.tenantId,
        });
        await executeBulkAction(input, execution, source, item.action);
        await input.deletionFence.assertDeletionFenceUnchanged(sourceDeletionToken);
        await execution.mutate((latest) =>
          input.repository
            .markBulkItem({
              fence: fence(latest),
              itemId: item.id,
              now: iso((input.now ?? Date.now)()),
              runId: latest.id,
              status: "completed",
            })
            .then(() => latest),
        );
        completed += 1;
      } catch (error) {
        const sourceUnavailable = isBulkSourceUnavailable(error);
        const safe = safeSourceOperationError("sourceBulk", error);
        await execution.mutate((latest) =>
          input.repository
            .markBulkItem({
              ...(sourceUnavailable
                ? { reason: "source-not-found" }
                : {
                    errorCode:
                      error instanceof SourceProductWorkflowRuntimeError ? error.code : safe.code,
                    reason:
                      error instanceof SourceProductWorkflowRuntimeError
                        ? error.message
                        : safe.message,
                  }),
              fence: fence(latest),
              itemId: item.id,
              now: iso((input.now ?? Date.now)()),
              runId: latest.id,
              status: sourceUnavailable ? "skipped" : "failed",
            })
            .then(() => latest),
        );
        if (sourceUnavailable) skipped += 1;
        else failed += 1;
      }
    }
    cursor = page.nextCursor ?? eofCursor;
    await execution.mutate((latest) =>
      input.repository.checkpoint({
        checkpoint: "provider-read",
        cursor,
        fence: fence(latest),
        now: iso((input.now ?? Date.now)()),
        progressCompleted: completed,
        progressFailed: failed,
        progressSkipped: skipped,
        state: "running",
      }),
    );
  } while (cursor !== eofCursor);
  if (!pending) return false;
  const deferredAt = (input.now ?? Date.now)();
  await execution.mutate((latest) =>
    input.repository.defer({
      availableAt: iso(deferredAt + bulkChildPollMs),
      fence: fence(latest),
      now: iso(deferredAt),
    }),
  );
  return true;
}

async function executeBulkAction(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  execution: RuntimeExecution,
  source: Source,
  action: SourceBulkAction,
): Promise<void> {
  if (action === "sync") {
    throw runtimeError(
      "SOURCE_BULK_SYNC_CHILD_REQUIRED",
      "Bulk sync must execute as an independent durable child workflow",
    );
  }
  if (action === "disable") {
    const run = execution.run();
    const updated = await execution.external(() =>
      input.sources.disableWithPermissionFence({
        ...(run.capabilityGrantId
          ? { capabilityGrantId: run.capabilityGrantId, tenantId: run.tenantId }
          : { permissionFence: durablePermissionFence(run) }),
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        now: iso((input.now ?? Date.now)()),
      }),
    );
    if (!updated) throw runtimeError("SOURCE_NOT_FOUND", "Source not found");
    await input.repository.rebindSyncPolicySourceVersion({
      expectedSourceVersion: source.version,
      knowledgeSpaceId: updated.knowledgeSpaceId,
      sourceId: updated.id,
      sourceVersion: updated.version,
      tenantId: run.tenantId,
    });
    return;
  }
  throw runtimeError(
    "SOURCE_BULK_REMOVE_CHILD_REQUIRED",
    "Bulk remove must execute through its durable deletion child job",
  );
}

async function resolveSource(
  input: Parameters<typeof createSourceProductWorkflowRuntime>[0],
  source: Source,
  tenantId: string,
): Promise<Source> {
  if (source.connectionId) {
    if (!input.sourceConnections) {
      throw runtimeError(
        "SOURCE_CONNECTION_UNAVAILABLE",
        "Source connection resolver is unavailable",
      );
    }
    return input.sourceConnections.resolve({ source, tenantId });
  }
  return input.sourceCredentials ? input.sourceCredentials.resolve({ source, tenantId }) : source;
}

function payloadItems(run: SourceWorkflowRun): readonly Record<string, unknown>[] {
  const items = run.payload.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw runtimeError("SOURCE_WORKFLOW_PAYLOAD_INVALID", "Source import payload is invalid");
  }
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw runtimeError("SOURCE_WORKFLOW_PAYLOAD_INVALID", "Source import item is invalid");
    }
    return item as Record<string, unknown>;
  });
}

function selectedPageIds(run: SourceWorkflowRun): readonly string[] {
  const value = run.payload.selectedPageIds;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw runtimeError("SOURCE_WORKFLOW_PAYLOAD_INVALID", "Crawl selection payload is invalid");
  }
  return value as string[];
}

function selectedSourceUrls(run: SourceWorkflowRun): readonly string[] {
  const value = run.payload.selectedSourceUrls;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 200 ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.length > 4_096)
  ) {
    throw runtimeError("SOURCE_WORKFLOW_PAYLOAD_INVALID", "Crawl source URL selection is invalid");
  }
  return value as string[];
}

function requiredPayloadString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.length > 8_192) {
    throw runtimeError("SOURCE_WORKFLOW_PAYLOAD_INVALID", `Source import ${key} is invalid`);
  }
  return value;
}

function remoteDeletionPolicy(source: Source): "retain" | "tombstone" {
  return source.metadata.remoteDeletionPolicy === "retain" ? "retain" : "tombstone";
}

function syncImportedPages(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, { readonly lastEditedTime?: string | undefined }> {
  const raw = metadata.imported;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, { readonly lastEditedTime?: string | undefined }> = {};
  for (const [providerItemId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const lastEditedTime = (value as Record<string, unknown>).lastEditedTime;
    result[providerItemId] = typeof lastEditedTime === "string" ? { lastEditedTime } : {};
  }
  return result;
}

function syncImportedFiles(metadata: Readonly<Record<string, unknown>>): Record<
  string,
  {
    readonly bucket?: string | undefined;
    readonly mimeType?: string | undefined;
    readonly name: string;
  }
> {
  const raw = metadata.importedFiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<
    string,
    {
      readonly bucket?: string | undefined;
      readonly mimeType?: string | undefined;
      readonly name: string;
    }
  > = {};
  for (const [providerItemId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) continue;
    result[providerItemId] = {
      ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
      ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
      name: record.name,
    };
  }
  return result;
}

function webFilename(name: string, id: string): string {
  const safe = name
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
  return `${safe || "provider-item"}-${id.slice(0, 12)}.md`;
}

function fence(run: SourceWorkflowRun): SourceWorkflowFence {
  if (!run.workerId || !run.leaseToken) {
    throw runtimeError(
      "SOURCE_WORKFLOW_FENCE_MISSING",
      "Source workflow execution fence is missing",
    );
  }
  return {
    leaseToken: run.leaseToken,
    rowVersion: run.rowVersion,
    runId: run.id,
    workerId: run.workerId,
  };
}

function durablePermissionFence(run: SourceWorkflowRun): DatabaseKnowledgeSpacePermissionFence {
  if (
    !run.accessChannel ||
    !run.permissionSnapshotId ||
    !run.permissionSnapshotRevision ||
    !run.requestedBySubjectId
  ) {
    throw runtimeError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Durable source workflow permission provenance is incomplete",
    );
  }
  return {
    accessChannel: run.accessChannel,
    knowledgeSpaceId: run.knowledgeSpaceId,
    permissionSnapshotId: run.permissionSnapshotId,
    permissionSnapshotRevision: run.permissionSnapshotRevision,
    requestedBySubjectId: workflowSubjectId(run),
    tenantId: run.tenantId,
  };
}

function durablePermissionReference(run: SourceWorkflowRun) {
  const fence = durablePermissionFence(run);
  return {
    accessChannel: fence.accessChannel,
    id: fence.permissionSnapshotId,
    revision: fence.permissionSnapshotRevision,
  };
}

function workflowSubjectId(run: SourceWorkflowRun): string {
  const subjectId = run.executionSubjectId ?? run.requestedBySubjectId;
  if (!subjectId) {
    throw runtimeError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Source workflow actor provenance is unavailable",
    );
  }
  return subjectId;
}

function requiredSource(source: Source | null): Source {
  if (!source) throw runtimeError("SOURCE_NOT_FOUND", "Source not found");
  return source;
}

function segment(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

export class SourceProductWorkflowRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceProductWorkflowRuntimeError";
  }
}

function runtimeError(code: string, message: string): SourceProductWorkflowRuntimeError {
  return new SourceProductWorkflowRuntimeError(code, message);
}

function isBulkSourceUnavailable(error: unknown): boolean {
  if (error instanceof SourceProductWorkflowRuntimeError) {
    return error.code === "SOURCE_NOT_FOUND";
  }
  return (
    error instanceof SourceWorkflowError &&
    (error.code === "SOURCE_NOT_FOUND" || error.code === "SOURCE_WORKFLOW_SOURCE_NOT_WRITABLE")
  );
}
