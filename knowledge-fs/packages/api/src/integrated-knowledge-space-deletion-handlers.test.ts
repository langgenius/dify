import type { AuthSubject, KnowledgeSpace } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { DIFY_CAPABILITY_V2_OPERATIONS } from "./dify-capability-v2";
import type { DurableDeletionJob } from "./durable-deletion-repository";
import type { DurableDeletionService } from "./durable-deletion-service";
import { createAcceptingDurableDeletionService } from "./durable-deletion-test-utils";
import { createKnowledgeGatewayApp } from "./gateway-app";
import { knowledgeGatewayOpenApiDocument } from "./gateway-openapi-document";
import { registerIntegratedKnowledgeSpaceDeletionHandlers } from "./integrated-knowledge-space-deletion-handlers";

const TENANT_ID = "tenant-a";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OTHER_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const CONTROL_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const OPERATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const GRANT_ID = OPERATION_ID;
const NOW = "2026-07-21T12:00:00.000Z";
const UPDATED_AT = "2026-07-21T12:01:00.000Z";

describe("integrated knowledge-space deletion handlers", () => {
  it("publishes the exact OpenAPI operation admitted for the internal worker", () => {
    const app = appWith({
      durableDeletions: createAcceptingDurableDeletionService(),
      getForDeletion: vi.fn(),
      getJobByIdempotency: vi.fn(),
    });
    const operation = app.getOpenAPI31Document(knowledgeGatewayOpenApiDocument).paths?.[
      "/internal/knowledge-spaces/{id}/delete"
    ]?.post;
    const capabilityOperation = DIFY_CAPABILITY_V2_OPERATIONS.find(
      (candidate) => candidate.operationId === "deleteIntegratedKnowledgeSpace",
    );

    expect(operation?.operationId).toBe("deleteIntegratedKnowledgeSpace");
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "200",
      "202",
      "400",
      "401",
      "403",
      "404",
      "409",
      "503",
    ]);
    expect(capabilityOperation).toMatchObject({
      action: "knowledge_spaces.delete",
      allowedCallerKinds: ["internal_worker"],
      method: "POST",
      pathTemplate: "/internal/knowledge-spaces/{id}/delete",
    });
  });

  it("admits one durable Space deletion without requiring a separate capability fence", async () => {
    const requestKnowledgeSpaceDeletion = vi.fn(async () => acceptedJob());
    const durableDeletions = createAcceptingDurableDeletionService({
      requestKnowledgeSpaceDeletion,
    });
    const getJobByIdempotency = vi.fn(async () => null);
    const getForDeletion = vi.fn(async () => space());
    const applySpaceFence = vi.fn();
    const app = appWith({ durableDeletions, getForDeletion, getJobByIdempotency });

    const response = await request(app);

    expect(response.status, await response.clone().text()).toBe(202);
    expect(await response.json()).toEqual({ phase: "accepted", revision: 8 });
    expect(requestKnowledgeSpaceDeletion).toHaveBeenCalledWith({
      callerKind: "service_api",
      capability: { contentScopeIds: [], grantId: GRANT_ID },
      challenge: "Product docs",
      expectedRevision: 7,
      idempotencyKey: "delete:control-space-a",
      knowledgeSpaceId: SPACE_ID,
      subject: subject(),
    });
    expect(applySpaceFence).not.toHaveBeenCalled();
  });

  it("replays the durable idempotency ledger and returns its latest irreversible phase", async () => {
    const durableDeletions = createAcceptingDurableDeletionService({
      requestKnowledgeSpaceDeletion: vi.fn(),
    });
    const getForDeletion = vi.fn();
    const getJobByIdempotency = vi.fn(async () =>
      durableJob({ checkpoint: "deleting_primary_data", runState: "running" }),
    );
    const app = appWith({ durableDeletions, getForDeletion, getJobByIdempotency });

    const first = await request(app);
    const replay = await request(app);

    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({
      irreversibleAt: UPDATED_AT,
      phase: "irreversible",
      revision: 8,
    });
    expect(await replay.json()).toEqual({
      irreversibleAt: UPDATED_AT,
      phase: "irreversible",
      revision: 8,
    });
    expect(getJobByIdempotency).toHaveBeenCalledTimes(2);
    expect(getForDeletion).not.toHaveBeenCalled();
    expect(durableDeletions.requestKnowledgeSpaceDeletion).not.toHaveBeenCalled();
  });

  it("returns completed progress from the ledger after the Space row has been deleted", async () => {
    const durableDeletions = createAcceptingDurableDeletionService({
      requestKnowledgeSpaceDeletion: vi.fn(),
    });
    const getForDeletion = vi.fn(async () => null);
    const getJobByIdempotency = vi.fn(async () =>
      durableJob({
        checkpoint: "completed",
        completedAt: UPDATED_AT,
        runState: "succeeded",
      }),
    );
    const app = appWith({ durableDeletions, getForDeletion, getJobByIdempotency });

    const response = await request(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      irreversibleAt: UPDATED_AT,
      phase: "completed",
      revision: 8,
    });
    expect(getForDeletion).not.toHaveBeenCalled();
  });

  it.each([
    ["another Space", { targetId: OTHER_SPACE_ID }],
    ["another revision", { targetRevision: 9 }],
    ["another capability grant", { capabilityGrantId: OTHER_SPACE_ID }],
  ])("rejects an idempotency key already bound to %s", async (_label, overrides) => {
    const durableDeletions = createAcceptingDurableDeletionService({
      requestKnowledgeSpaceDeletion: vi.fn(),
    });
    const getForDeletion = vi.fn();
    const app = appWith({
      durableDeletions,
      getForDeletion,
      getJobByIdempotency: vi.fn(async () => durableJob(overrides)),
    });

    const response = await request(app);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "DURABLE_DELETION_IDEMPOTENCY_CONFLICT",
    });
    expect(getForDeletion).not.toHaveBeenCalled();
    expect(durableDeletions.requestKnowledgeSpaceDeletion).not.toHaveBeenCalled();
  });

  it("idempotently re-enqueues a failed durable deletion generation", async () => {
    const retry = vi.fn(async () => acceptedJob());
    const app = appWith({
      durableDeletions: createAcceptingDurableDeletionService({ retry }),
      getForDeletion: vi.fn(),
      getJobByIdempotency: vi.fn(async () =>
        durableJob({
          lastErrorCode: "DURABLE_DELETION_ATTEMPTS_EXHAUSTED",
          runState: "failed",
        }),
      ),
    });

    const response = await request(app);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ phase: "accepted", revision: 8 });
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: { contentScopeIds: [], grantId: GRANT_ID },
        idempotencyKey: "delete:control-space-a:retry:3",
        jobId: JOB_ID,
      }),
    );
  });

  it("rejects uncontracted namespace input before touching durable state", async () => {
    const getForDeletion = vi.fn();
    const getJobByIdempotency = vi.fn();
    const app = appWith({
      durableDeletions: createAcceptingDurableDeletionService(),
      getForDeletion,
      getJobByIdempotency,
    });

    const response = await app.request(`/internal/knowledge-spaces/${SPACE_ID}/delete`, {
      body: JSON.stringify({ ...requestBody(), namespaceId: TENANT_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(getJobByIdempotency).not.toHaveBeenCalled();
    expect(getForDeletion).not.toHaveBeenCalled();
  });
});

function appWith(input: {
  readonly durableDeletions: DurableDeletionService;
  readonly getForDeletion: (input: {
    readonly id: string;
    readonly tenantId: string;
  }) => Promise<KnowledgeSpace | null>;
  readonly getJobByIdempotency: (input: {
    readonly idempotencyKey: string;
    readonly tenantId: string;
  }) => Promise<DurableDeletionJob | null>;
}) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", "service_api");
    context.set("subject", subject());
    context.set("traceId", "trace-a");
    context.set("capabilityV2Grant", {
      action: "knowledge_spaces.delete",
      callerKind: "internal_worker",
      contentScopeIds: [],
      controlSpaceId: CONTROL_SPACE_ID,
      grantId: GRANT_ID,
      namespaceId: TENANT_ID,
      resource: { id: SPACE_ID, parent_id: null, type: "knowledge_space" },
    } as never);
    await next();
  });
  registerIntegratedKnowledgeSpaceDeletionHandlers({
    app,
    durableDeletions: input.durableDeletions,
    jobs: { getJobByIdempotency: input.getJobByIdempotency },
    spaces: { getForDeletion: input.getForDeletion },
  });
  return app;
}

function request(app: ReturnType<typeof appWith>) {
  return app.request(`/internal/knowledge-spaces/${SPACE_ID}/delete`, {
    body: JSON.stringify(requestBody()),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function requestBody() {
  return {
    controlSpaceId: CONTROL_SPACE_ID,
    expectedRevision: 7,
    idempotencyKey: "delete:control-space-a",
    operationId: OPERATION_ID,
    provisioningKey: "dify:tenant-a:product-docs",
  };
}

function subject(): AuthSubject {
  return {
    scopes: ["knowledge-spaces:write"],
    subjectId: "dify-worker:lifecycle-a",
    tenantId: TENANT_ID,
  };
}

function space(): KnowledgeSpace {
  return {
    createdAt: NOW,
    id: SPACE_ID,
    name: "Product docs",
    revision: 7,
    slug: "product-docs",
    tenantId: TENANT_ID,
    updatedAt: NOW,
  };
}

function acceptedJob() {
  return {
    job: {
      checkpoint: "requested" as const,
      createdAt: NOW,
      id: JOB_ID,
      knowledgeSpaceId: SPACE_ID,
      mode: "cascade" as const,
      runState: "dispatch_pending" as const,
      targetId: SPACE_ID,
      targetType: "knowledge_space" as const,
      updatedAt: NOW,
    },
    statusUrl: `/deletion-jobs/${JOB_ID}`,
  };
}

function durableJob(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    activeSlot: 1,
    capabilityGrantId: GRANT_ID,
    checkpoint: "requested",
    createdAt: NOW,
    deleteMode: "cascade",
    executionAttempts: 1,
    id: JOB_ID,
    idempotencyKey: "delete:control-space-a",
    inventoryComplete: true,
    knowledgeSpaceId: SPACE_ID,
    maxExecutionAttempts: 10,
    nameChallengeDigest: "digest",
    requestFingerprint: "fingerprint",
    rowVersion: 3,
    runState: "queued",
    targetId: SPACE_ID,
    targetRevision: 7,
    targetType: "knowledge_space",
    tenantId: TENANT_ID,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}
