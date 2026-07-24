import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { registerBackgroundTaskHandlers } from "./background-task-handlers";
import { createInMemoryBulkOperationRepository } from "./bulk-operation";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type {
  DocumentProcessingTask,
  DocumentProcessingTaskRepository,
} from "./document-processing-task-repository";
import { createKnowledgeGatewayApp } from "./gateway-app";
import type { SourceWorkflowRun } from "./source-product-workflow";

const TENANT_ID = "tenant-1";
const SUBJECT_ID = "dify-account:user-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const BULK_ID = "11111111-1111-4111-8111-111111111111";
const GROUPED_JOB_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_JOB_ID = "33333333-3333-4333-8333-333333333333";
const UNRELATED_DOCUMENT_JOB_ID = "99999999-9999-4999-8999-999999999999";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_RUN_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const GRANT_ID = "77777777-7777-4777-8777-777777777777";

describe("background task handlers", () => {
  it("merges newest tasks, hides document jobs represented by a bulk operation, and paginates", async () => {
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
      now: () => "2026-07-23T12:02:00.000Z",
    });
    await bulkOperations.create({
      capabilityGrantId: GRANT_ID,
      id: BULK_ID,
      items: [
        {
          compilationJobId: GROUPED_JOB_ID,
          documentId: DOCUMENT_ID,
          requiredPermissionScope: ["scope:visible"],
          status: "queued",
        },
      ],
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      type: "document_reindex",
    });
    const documentTasks = {
      get: vi.fn(),
      list: vi.fn(async () => ({
        items: [
          documentTask(GROUPED_JOB_ID, "2026-07-23T12:03:00.000Z"),
          documentTask(DOCUMENT_JOB_ID, "2026-07-23T12:01:00.000Z"),
        ],
      })),
    } as unknown as DocumentProcessingTaskRepository;
    const compilationJobs = {
      getMany: vi.fn(async () => [compilationJob(GROUPED_JOB_ID, "queued")]),
    } as unknown as DocumentCompilationJobStateMachine;
    const listRecentRuns = vi.fn(async () => ({
      items: [sourceRun({ createdAt: "2026-07-23T12:04:00.000Z" })],
    }));
    const app = backgroundTaskApp({
      bulkOperations,
      compilationJobs,
      documentTasks,
      sourceRepository: { listRecentRuns },
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/background-tasks?limit=2`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([
      expect.objectContaining({ id: SOURCE_RUN_ID, taskKind: "source" }),
      expect.objectContaining({ id: BULK_ID, taskKind: "document_bulk" }),
    ]);
    expect(body.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(GROUPED_JOB_ID);
    expect(documentTasks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateGrants: ["scope:visible"],
        direction: "desc",
        limit: 2,
      }),
    );
    expect(listRecentRuns).toHaveBeenCalledWith(
      expect.objectContaining({ candidateGrants: ["scope:visible"], limit: 2 }),
    );
  });

  it("does not re-emit a grouped document after its bulk task leaves the page", async () => {
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
      now: () => "2026-07-23T12:03:00.000Z",
    });
    await bulkOperations.create({
      capabilityGrantId: GRANT_ID,
      id: BULK_ID,
      items: [
        {
          compilationJobId: GROUPED_JOB_ID,
          documentId: DOCUMENT_ID,
          requiredPermissionScope: ["scope:visible"],
          status: "queued",
        },
      ],
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      type: "document_reindex",
    });
    const unrelated = documentTask(UNRELATED_DOCUMENT_JOB_ID, "2026-07-23T12:02:00.000Z");
    const grouped = documentTask(GROUPED_JOB_ID, "2026-07-23T12:01:00.000Z");
    const documentTasks = {
      get: vi.fn(),
      list: vi.fn(async (input: Parameters<DocumentProcessingTaskRepository["list"]>[0]) =>
        input.cursor
          ? { items: input.cursor.id === UNRELATED_DOCUMENT_JOB_ID ? [grouped] : [] }
          : {
              items: [unrelated],
              nextCursor: { createdAt: unrelated.createdAt, id: unrelated.id },
            },
      ),
    } as unknown as DocumentProcessingTaskRepository;
    const app = backgroundTaskApp({
      bulkOperations,
      compilationJobs: {
        getMany: vi.fn(async () => [compilationJob(GROUPED_JOB_ID, "queued")]),
      } as unknown as DocumentCompilationJobStateMachine,
      documentTasks,
    });

    const first = await app.request(`/knowledge-spaces/${SPACE_ID}/background-tasks?limit=1`);
    const firstBody = await first.json();
    expect(firstBody.items).toEqual([
      expect.objectContaining({ id: BULK_ID, taskKind: "document_bulk" }),
    ]);

    const second = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    );
    const secondBody = await second.json();
    expect(secondBody.items).toEqual([
      expect.objectContaining({ id: UNRELATED_DOCUMENT_JOB_ID, taskKind: "document" }),
    ]);

    const third = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks?limit=1&cursor=${encodeURIComponent(secondBody.nextCursor)}`,
    );
    await expect(third.json()).resolves.toEqual({ items: [] });
  });

  it("cancels and retries a visible document task with fresh control provenance", async () => {
    let state: DocumentProcessingTask["state"] = "running";
    const getVisible = vi.fn(async () =>
      documentTask(DOCUMENT_JOB_ID, "2026-07-23T12:01:00.000Z", state),
    );
    const cancel = vi.fn(async (_id, _reason, input) => {
      state = "canceled";
      return compilationJob(DOCUMENT_JOB_ID, "canceled");
    });
    const retry = vi.fn(async () => {
      state = "queued";
      return compilationJob(DOCUMENT_JOB_ID, "queued");
    });
    const app = backgroundTaskApp({
      compilationJobs: {
        cancel,
        retry,
      } as unknown as DocumentCompilationJobStateMachine,
      documentTasks: {
        get: vi.fn(),
        getVisible,
        list: vi.fn(async () => ({ items: [] })),
      },
    });

    const canceled = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/document/${DOCUMENT_JOB_ID}/cancel`,
      { method: "POST" },
    );
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({
      canRetry: true,
      id: DOCUMENT_JOB_ID,
      state: "canceled",
    });
    expect(cancel).toHaveBeenCalledWith(DOCUMENT_JOB_ID, "Canceled by request", {
      capabilityGrantId: GRANT_ID,
    });

    const retried = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/document/${DOCUMENT_JOB_ID}/retry`,
      { method: "POST" },
    );
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      canCancel: true,
      id: DOCUMENT_JOB_ID,
      state: "queued",
    });
    expect(retry).toHaveBeenCalledWith(DOCUMENT_JOB_ID, { capabilityGrantId: GRANT_ID });
  });

  it("controls every eligible child in a bulk document task", async () => {
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
      now: () => "2026-07-23T12:02:00.000Z",
    });
    await bulkOperations.create({
      capabilityGrantId: GRANT_ID,
      id: BULK_ID,
      items: [
        {
          compilationJobId: GROUPED_JOB_ID,
          documentId: DOCUMENT_ID,
          requiredPermissionScope: ["scope:visible"],
          status: "queued",
        },
      ],
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      type: "document_reindex",
    });
    let job = compilationJob(GROUPED_JOB_ID, "queued");
    const cancel = vi.fn(async () => {
      job = compilationJob(GROUPED_JOB_ID, "canceled");
      return job;
    });
    const retry = vi.fn(async () => {
      job = compilationJob(GROUPED_JOB_ID, "queued");
      return job;
    });
    const app = backgroundTaskApp({
      bulkOperations,
      compilationJobs: {
        cancel,
        get: vi.fn(async () => job),
        getMany: vi.fn(async () => [job]),
        retry,
      } as unknown as DocumentCompilationJobStateMachine,
    });

    const canceled = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/document_bulk/${BULK_ID}/cancel`,
      { method: "POST" },
    );
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({
      canRetry: true,
      state: "canceled",
      taskKind: "document_bulk",
    });

    const retried = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/document_bulk/${BULK_ID}/retry`,
      { method: "POST" },
    );
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      canCancel: true,
      state: "running",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("delegates source cancel and retry and rejects unsupported task kinds", async () => {
    const cancel = vi.fn(async () =>
      sourceRun({
        canceledAt: "2026-07-23T12:05:00.000Z",
        completedAt: "2026-07-23T12:05:00.000Z",
        state: "canceled",
      }),
    );
    const retry = vi.fn(async () => sourceRun({ state: "queued" }));
    const app = backgroundTaskApp({
      sourceWorkflows: { cancel, retry },
    });

    const canceled = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/source/${SOURCE_RUN_ID}/cancel`,
      { method: "POST" },
    );
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({
      canRetry: true,
      state: "canceled",
      taskKind: "source",
    });
    const retried = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/source/${SOURCE_RUN_ID}/retry`,
      { method: "POST" },
    );
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({ state: "queued" });
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeSpaceId: SPACE_ID, runId: SOURCE_RUN_ID }),
    );
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeSpaceId: SPACE_ID, runId: SOURCE_RUN_ID }),
    );

    const invalid = await app.request(
      `/knowledge-spaces/${SPACE_ID}/background-tasks/unknown/${SOURCE_RUN_ID}/retry`,
      { method: "POST" },
    );
    expect(invalid.status).toBe(400);
  });
});

function backgroundTaskApp(overrides: {
  readonly bulkOperations?: ReturnType<typeof createInMemoryBulkOperationRepository>;
  readonly compilationJobs?: DocumentCompilationJobStateMachine;
  readonly documentTasks?: DocumentProcessingTaskRepository | object;
  readonly sourceRepository?: object;
  readonly sourceWorkflows?: object;
}) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", "interactive");
    context.set("capabilityV2Grant", capabilityGrant());
    context.set("rateLimitChecked", true);
    context.set("subject", subject());
    context.set("traceId", "88888888-8888-4888-8888-888888888888");
    await next();
  });
  registerBackgroundTaskHandlers({
    access: { createPermissionSnapshot: vi.fn() } as never,
    app,
    authorization: { authorize: vi.fn() } as never,
    bulkOperations:
      overrides.bulkOperations ??
      createInMemoryBulkOperationRepository({ maxItems: 10, maxOperations: 10 }),
    ...(overrides.compilationJobs ? { documentCompilationJobs: overrides.compilationJobs } : {}),
    ...(overrides.documentTasks
      ? { documentTasks: overrides.documentTasks as DocumentProcessingTaskRepository }
      : {}),
    ...(overrides.sourceRepository
      ? { sourceRepository: overrides.sourceRepository as never }
      : {}),
    ...(overrides.sourceWorkflows ? { sourceWorkflows: overrides.sourceWorkflows as never } : {}),
    spaces: {
      get: vi.fn(async ({ id, tenantId }) =>
        id === SPACE_ID && tenantId === TENANT_ID ? { id: SPACE_ID } : null,
      ),
    } as never,
  });
  return app;
}

function subject(): AuthSubject {
  return {
    scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
    subjectId: SUBJECT_ID,
    tenantId: TENANT_ID,
  };
}

function capabilityGrant(): DifyCapabilityV2SanitizedGrant {
  return {
    action: "background_tasks.list",
    actor: SUBJECT_ID,
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-web",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: ["scope:visible"],
    controlSpaceId: "control-space-1",
    expiresAt: Date.now() + 60_000,
    grantId: GRANT_ID,
    issuedAt: Date.now(),
    jtiHash: `sha256:${"a".repeat(64)}`,
    namespaceId: TENANT_ID,
    notBefore: Date.now() - 1_000,
    resource: { id: SPACE_ID, parent_id: null, type: "knowledge_space" },
    subject: SUBJECT_ID,
    traceId: "88888888-8888-4888-8888-888888888888",
  };
}

function documentTask(
  id: string,
  createdAt: string,
  state: DocumentProcessingTask["state"] = "queued",
): DocumentProcessingTask {
  return {
    createdAt,
    documentId: DOCUMENT_ID,
    documentRevision: 1,
    id,
    knowledgeSpaceId: SPACE_ID,
    progressPercent: state === "canceled" ? 20 : 0,
    stage: state === "canceled" ? "parsed" : "queued",
    state,
    updatedAt: createdAt,
  };
}

function compilationJob(
  id: string,
  stage: DocumentCompilationJob["stage"],
): DocumentCompilationJob {
  return {
    createdAt: Date.parse("2026-07-23T12:00:00.000Z"),
    documentAssetId: DOCUMENT_ID,
    id,
    knowledgeSpaceId: SPACE_ID,
    stage,
    tenantId: TENANT_ID,
    updatedAt: Date.parse("2026-07-23T12:05:00.000Z"),
    version: 1,
  };
}

function sourceRun(patch: Partial<SourceWorkflowRun> = {}): SourceWorkflowRun {
  return {
    capabilityGrantId: GRANT_ID,
    checkpoint: "queued",
    createdAt: "2026-07-23T12:04:00.000Z",
    executionAttempts: 0,
    id: SOURCE_RUN_ID,
    idempotencyKey: "source-sync-1",
    knowledgeSpaceId: SPACE_ID,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    progressCompleted: 0,
    progressFailed: 0,
    progressSkipped: 0,
    requiredPermissionScope: ["scope:visible"],
    rowVersion: 1,
    sourceId: SOURCE_ID,
    state: "queued",
    tenantId: TENANT_ID,
    updatedAt: "2026-07-23T12:04:00.000Z",
    ...patch,
  };
}
