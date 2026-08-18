import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryResearchTaskJobRepository,
  createKnowledgeGateway,
  createResearchTaskDryRunPlanner,
  createResearchTaskJobStateMachine,
  createRetrievalPlanner,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const writeOnlyToken = "write-only-token";
const otherTenantToken = "other-tenant-token";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestAuthVerifier() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [otherTenantToken]: {
        scopes: ["knowledge-spaces:*"],
        subjectId: "user-2",
        tenantId: "tenant-2",
      },
      [readToken]: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      [writeOnlyToken]: {
        scopes: ["knowledge-spaces:write"],
        subjectId: "user-3",
        tenantId: "tenant-1",
      },
      [writeToken]: {
        scopes: ["knowledge-spaces:*"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
    },
  });
}

describe("research task gateway integration", () => {
  it("creates, reads, and cancels tenant-scoped research tasks", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T14:00:00.000Z",
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: adapter.jobs,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTasks,
    });

    const unauthorized = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Research semantic retrieval regressions",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research", slug: "research" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const readOnlyCreate = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Research semantic retrieval regressions",
      }),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(readOnlyCreate.status).toBe(403);

    const created = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: { mode: "deep" },
        budgetUsd: 0.5,
        query: "Research semantic retrieval regressions",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const createdResearchTask = (await created.json()) as Record<string, unknown>;
    expect(createdResearchTask).toMatchObject({
      id: "research-task-job-1",
      budgetUsd: 0.5,
      cost: { budgetUsd: 0.5, entries: [], totalUsd: 0 },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { mode: "deep" },
      query: "Research semantic retrieval regressions",
      stage: "queued",
    });
    expect(createdResearchTask).not.toHaveProperty("permissionSnapshot");
    expect(createdResearchTask).not.toHaveProperty("subjectId");
    expect(createdResearchTask).not.toHaveProperty("tenantId");

    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
      status: "queued",
      type: "research.task",
    });

    const status = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(readToken),
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      id: "research-task-job-1",
      stage: "queued",
    });

    const writeOnlyStatus = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyStatus.status).toBe(403);

    const crossTenantStatus = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenantStatus.status).toBe(404);

    const readOnlyCancel = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(readToken),
      method: "DELETE",
    });
    expect(readOnlyCancel.status).toBe(403);

    const cancel = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      id: "research-task-job-1",
      stage: "canceled",
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      status: "canceled",
    });

    const cancelAgain = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancelAgain.status).toBe(409);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/research-tasks"]?.post).toBeDefined();
    expect(spec.paths["/research-tasks/{id}"]?.get).toBeDefined();
    expect(spec.paths["/research-tasks/{id}"]?.delete).toBeDefined();
  });

  it("enforces research task launch limits before queue enqueue", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T15:15:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTaskPlanner: createResearchTaskDryRunPlanner({
        retrievalPlanner: createRetrievalPlanner({ maxTopK: 100 }),
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Research limits",
        slug: "research-limits",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const rejected = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limits: {
          maxRetrievalSteps: 1,
          maxScannedResources: 1,
          maxToolCalls: 1,
          timeoutMs: 1,
        },
        mode: "research",
        query: "Research semantic retrieval regressions",
        topK: 5,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: "Research task limits exceeded",
      violations: [
        { limit: "timeoutMs" },
        { limit: "maxRetrievalSteps" },
        { limit: "maxScannedResources" },
        { limit: "maxToolCalls" },
      ],
    });
    await expect(adapter.jobs.stats()).resolves.toMatchObject({ queued: 0 });

    const accepted = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limits: {
          maxRetrievalSteps: 10,
          maxScannedResources: 400,
          maxToolCalls: 22,
          timeoutMs: 30_000,
        },
        mode: "research",
        query: "Research semantic retrieval regressions",
        topK: 5,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({
      limits: {
        maxRetrievalSteps: 10,
        maxScannedResources: 400,
        maxToolCalls: 22,
        timeoutMs: 30_000,
      },
      stage: "queued",
    });
  });

  it("plans research tasks without enqueueing durable work", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T15:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTaskPlanner: createResearchTaskDryRunPlanner({
        retrievalPlanner: createRetrievalPlanner({ maxTopK: 100 }),
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Research planning",
        slug: "research-planning",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const writeOnly = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: {
        ...bearer(writeOnlyToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(writeOnly.status).toBe(403);

    const planned = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        budgetUsd: 0.25,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mode: "research",
        query: "Plan a research comparison",
        topK: 5,
      }),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(planned.status).toBe(200);
    await expect(planned.json()).resolves.toMatchObject({
      budget: { budgetUsd: 0.25, exceedsBudget: false },
      estimates: {
        cacheHitProbability: expect.any(Number),
        scannedResources: expect.any(Number),
        toolCalls: expect.any(Number),
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      retrievalPlan: {
        requestedMode: "research",
        resolvedMode: "research",
        topK: 5,
      },
      strategyVersion: "research-dry-run-planner-v1",
    });
    await expect(adapter.jobs.stats()).resolves.toMatchObject({ queued: 0 });

    const crossTenant = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: {
        ...bearer(otherTenantToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(crossTenant.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/research-tasks/plan"]?.post).toBeDefined();
  });
});
