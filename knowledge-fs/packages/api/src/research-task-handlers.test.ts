import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import {
  AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY,
  PublishedProjectionReadUnavailableError,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryResearchTaskJobRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createResearchTaskJobStateMachine,
  createStaticAuthVerifier,
  researchTaskRuntimeSnapshotFromMetadata,
} from "./index";

describe("research task handlers", () => {
  it("preserves the planned mode and topK in the durable research task", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => knowledgeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({
      name: "Research",
      slug: "research",
      tenantId: "tenant-1",
    });
    const generatedAccessIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
    ];
    const generateAccessId = () => generatedAccessIds.shift() ?? crypto.randomUUID();
    const access = createKnowledgeSpaceAccessService({
      generateId: generateAccessId,
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        generateId: generateAccessId,
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    await access.initialize({
      knowledgeSpaceId,
      ownerSubjectId: "user-1",
      tenantId: "tenant-1",
    });
    let nextResearchTaskId = 0;
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => `research-task-job-${++nextResearchTaskId}`,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    let deletionActive = false;
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "editor-token": {
            scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
            subjectId: "editor-1",
            tenantId: "tenant-1",
          },
          "viewer-token": {
            scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
            subjectId: "viewer-1",
            tenantId: "tenant-1",
          },
          "write-token": {
            scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaces: spaces,
      knowledgeSpaceAccess: access,
      researchTaskDeletionVisibility: {
        isSpaceReadable: async () => !deletionActive,
      },
      researchTasks,
    });

    const response = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        mode: "deep",
        query: "Research semantic retrieval regressions",
        topK: 7,
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    const responseBody = (await response.json()) as Record<string, unknown>;
    expect(responseBody).toMatchObject({
      id: "research-task-job-1",
      mode: "deep",
      topK: 7,
    });
    expect(responseBody).not.toHaveProperty("executionAttempts");
    expect(responseBody).not.toHaveProperty("leaseExpiresAt");
    expect(responseBody).not.toHaveProperty("leaseToken");
    expect(responseBody).not.toHaveProperty("permissionSnapshot");
    expect(responseBody).not.toHaveProperty("queueJobId");
    expect(responseBody).not.toHaveProperty("rowVersion");
    expect(responseBody).not.toHaveProperty("subjectId");
    expect(responseBody).not.toHaveProperty("tenantId");
    expect(responseBody).not.toHaveProperty("workerId");
    await expect(researchTasks.get("research-task-job-1")).resolves.toMatchObject({
      mode: "deep",
      topK: 7,
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
      type: "research.task",
    });

    const legacyAuto = await app.request("/research-tasks", {
      body: JSON.stringify({ knowledgeSpaceId, mode: "auto", query: "Choose a pipeline" }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(legacyAuto.status).toBe(503);
    await expect(legacyAuto.json()).resolves.toEqual({
      error: "Published runtime snapshot unavailable",
    });
    await expect(researchTasks.get("research-task-job-2")).resolves.toBeNull();

    await access.setMemberRole({
      actorSubjectId: "user-1",
      expectedRevision: 0,
      knowledgeSpaceId,
      role: "viewer",
      subjectId: "viewer-1",
      tenantId: "tenant-1",
    });
    await access.setMemberRole({
      actorSubjectId: "user-1",
      expectedRevision: 0,
      knowledgeSpaceId,
      role: "editor",
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
    await access.updatePolicy({
      actorSubjectId: "user-1",
      expectedRevision: 1,
      knowledgeSpaceId,
      partialMemberSubjectIds: [],
      tenantId: "tenant-1",
      visibility: "all_members",
    });

    const viewerGet = await app.request("/research-tasks/research-task-job-1", {
      headers: { authorization: "Bearer viewer-token" },
    });
    expect(viewerGet.status).toBe(403);
    await expect(viewerGet.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
    });
    const viewerPartials = await app.request(
      "/research-tasks/research-task-job-1/partials?limit=10",
      { headers: { authorization: "Bearer viewer-token" } },
    );
    expect(viewerPartials.status).toBe(403);
    const viewerEvents = await app.request("/research-tasks/research-task-job-1/events?limit=10", {
      headers: { authorization: "Bearer viewer-token" },
    });
    expect(viewerEvents.status).toBe(403);

    const viewerCancel = await app.request("/research-tasks/research-task-job-1", {
      headers: { authorization: "Bearer viewer-token" },
      method: "DELETE",
    });
    expect(viewerCancel.status).toBe(403);
    await expect(viewerCancel.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
    });

    const editorCancel = await app.request("/research-tasks/research-task-job-1", {
      headers: { authorization: "Bearer editor-token" },
      method: "DELETE",
    });
    expect(editorCancel.status).toBe(403);

    const ownerCancel = await app.request("/research-tasks/research-task-job-1", {
      headers: { authorization: "Bearer write-token" },
      method: "DELETE",
    });
    expect(ownerCancel.status).toBe(403);

    const openapi = (await (await app.request("/openapi.json")).json()) as {
      components?: {
        schemas?: Record<
          string,
          { properties?: Record<string, unknown>; required?: readonly string[] }
        >;
      };
    };
    const jobSchema = openapi.components?.schemas?.ResearchTaskJob;

    expect(jobSchema?.properties).toMatchObject({
      mode: { enum: ["auto", "deep", "fast", "research"], type: "string" },
      topK: { type: "integer" },
    });
    expect(jobSchema?.required ?? []).not.toContain("mode");
    expect(jobSchema?.required ?? []).not.toContain("topK");

    const untrustedScopeResponse = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        permissionScope: { grants: ["admin"] },
        query: "Attempt to inject grants",
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(untrustedScopeResponse.status).toBe(400);
    await expect(researchTasks.get("research-task-job-2")).resolves.toBeNull();

    const currentOwnerCreate = await app.request("/research-tasks", {
      body: JSON.stringify({ knowledgeSpaceId, query: "Current owner task" }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(currentOwnerCreate.status).toBe(201);
    const currentOwnerCancel = await app.request("/research-tasks/research-task-job-2", {
      headers: { authorization: "Bearer write-token" },
      method: "DELETE",
    });
    expect(currentOwnerCancel.status).toBe(200);

    deletionActive = true;
    for (const [path, method] of [
      ["/research-tasks/research-task-job-2", "GET"],
      ["/research-tasks/research-task-job-2/partials?limit=10", "GET"],
      ["/research-tasks/research-task-job-2/events?limit=10", "GET"],
      ["/research-tasks/research-task-job-2", "DELETE"],
    ] as const) {
      const hidden = await app.request(path, {
        headers: { authorization: "Bearer write-token" },
        method,
      });
      expect(hidden.status, `${method} ${path}`).toBe(404);
      await expect(hidden.json()).resolves.toEqual({ error: "Research task job not found" });
    }
    deletionActive = false;

    await access.updateApiAccess({
      actorSubjectId: "user-1",
      enabled: true,
      expectedRevision: 1,
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });
    const issuedKey = await access.issueApiKey({
      actorSubjectId: "user-1",
      knowledgeSpaceId,
      name: "research automation",
      principalSubjectId: "user-1",
      tenantId: "tenant-1",
    });
    const apiKeyCreate = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        mode: "fast",
        query: "API-key research task",
        topK: 3,
      }),
      headers: {
        authorization: `Bearer ${issuedKey.token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(apiKeyCreate.status).toBe(201);
    await expect(apiKeyCreate.json()).resolves.toMatchObject({
      id: "research-task-job-3",
    });
  });

  it("freezes the published runtime tuple at creation and fails closed when it is unavailable", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => knowledgeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({
      name: "Frozen research",
      slug: "frozen-research",
      tenantId: "tenant-1",
    });
    const accessIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d51",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d52",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d53",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d54",
    ];
    const generateAccessId = () => accessIds.shift() ?? crypto.randomUUID();
    const access = createKnowledgeSpaceAccessService({
      generateId: generateAccessId,
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        generateId: generateAccessId,
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    await access.initialize({
      knowledgeSpaceId,
      ownerSubjectId: "user-1",
      tenantId: "tenant-1",
    });
    let nextResearchTaskId = 0;
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => `research-task-frozen-${++nextResearchTaskId}`,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const runtimeSnapshot = publishedRuntimeSnapshot(knowledgeSpaceId);
    const resolve = vi.fn(async () => structuredClone(runtimeSnapshot));
    const assertReady = vi.fn(async () => undefined);
    const resolveAutoMode = vi.fn(async () => ({
      finishReason: "stop",
      generationModel: runtimeSnapshot.retrievalProfile.reasoningModel.model,
      mode: "fast" as const,
      promptVersion: "auto-retrieval-mode-router-v1" as const,
      provider: "plugin-daemon",
      reasonCode: "direct_lookup" as const,
    }));
    const app = createKnowledgeGateway({
      adapter,
      autoRetrievalModeResolver: { resolve: resolveAutoMode },
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "write-token": {
            scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
      researchTasks,
      runtimeSnapshotResolver: { assertReady, resolve },
    });

    const planned = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId,
        query: "Use the frozen space defaults",
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(planned.status).toBe(200);
    await expect(planned.json()).resolves.toMatchObject({
      retrievalPlan: {
        denseTopK: 100,
        ftsTopK: 100,
        fusionLimit: 100,
        requestedMode: "deep",
        resolvedMode: "deep",
        topK: 37,
      },
    });
    expect(resolve).toHaveBeenCalledTimes(1);

    const created = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        metadata: {
          __knowledgeFsFutureServerField: "must-not-leak",
          __knowledgeFsPublishedRuntimeSnapshot: { attackerControlled: true },
          callerLabel: "frozen-contract",
        },
        query: "Use the frozen space defaults",
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      metadata?: Record<string, unknown>;
      mode?: string;
      topK?: number;
    };
    expect(createdBody.metadata).toEqual({ callerLabel: "frozen-contract" });
    expect(createdBody).toMatchObject({ mode: "deep", topK: 37 });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledWith({ knowledgeSpaceId, tenantId: "tenant-1" });
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId,
      resolvedMode: "deep",
      tenantId: "tenant-1",
    });
    const persisted = await researchTasks.get("research-task-frozen-1");
    expect(persisted).toMatchObject({ mode: "deep", topK: 37 });
    expect(persisted?.metadata.callerLabel).toBe("frozen-contract");
    expect(persisted?.metadata).not.toHaveProperty("__knowledgeFsFutureServerField");
    expect(researchTaskRuntimeSnapshotFromMetadata(persisted?.metadata ?? {})).toEqual(
      runtimeSnapshot,
    );

    const fetched = await app.request("/research-tasks/research-task-frozen-1", {
      headers: { authorization: "Bearer write-token" },
    });
    expect(fetched.status).toBe(200);
    const fetchedBody = (await fetched.json()) as { metadata?: Record<string, unknown> };
    expect(fetchedBody.metadata).toEqual({ callerLabel: "frozen-contract" });

    const autoCreated = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        mode: "auto",
        query: "status",
        topK: 11,
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(autoCreated.status).toBe(201);
    await expect(autoCreated.json()).resolves.toMatchObject({ mode: "fast", topK: 11 });
    await expect(researchTasks.get("research-task-frozen-2")).resolves.toMatchObject({
      mode: "fast",
      topK: 11,
    });
    expect(resolveAutoMode).toHaveBeenCalledOnce();
    expect(resolveAutoMode).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultMode: "deep",
        query: "status",
        reasoningModel: runtimeSnapshot.retrievalProfile.reasoningModel,
        tenantId: "tenant-1",
      }),
    );
    const autoPersisted = await researchTasks.get("research-task-frozen-2");
    expect(autoPersisted?.metadata[AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]).toMatchObject({
      degraded: false,
      requestedMode: "auto",
      resolvedMode: "fast",
      resolver: "llm",
    });

    resolve.mockRejectedValueOnce(
      new PublishedProjectionReadUnavailableError({
        knowledgeSpaceId,
        tenantId: "tenant-1",
      }),
    );
    const unavailable = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId,
        mode: "research",
        query: "Do not enqueue without a snapshot",
      }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "Published runtime snapshot unavailable",
    });
    await expect(researchTasks.get("research-task-frozen-3")).resolves.toBeNull();

    const openapi = (await (await app.request("/openapi.json")).json()) as {
      paths?: Record<string, { post?: { responses?: Record<string, { description?: string }> } }>;
    };
    expect(openapi.paths?.["/research-tasks"]?.post?.responses?.["503"]).toMatchObject({
      description: "Published runtime snapshot is unavailable or not query-ready",
    });
    expect(openapi.paths?.["/research-tasks/plan"]?.post?.responses?.["503"]).toMatchObject({
      description: "Published runtime snapshot is unavailable or not query-ready",
    });
  });

  it("rejects an explicit ordinary-mode override before signing or enqueueing", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e42";
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => knowledgeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({
      name: "Research-only threshold",
      slug: "research-only-threshold",
      tenantId: "tenant-1",
    });
    const access = createKnowledgeSpaceAccessService({
      generateId: () => crypto.randomUUID(),
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        generateId: () => crypto.randomUUID(),
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    await access.initialize({
      knowledgeSpaceId,
      ownerSubjectId: "user-1",
      tenantId: "tenant-1",
    });
    const createPermissionSnapshot = vi.spyOn(access, "createPermissionSnapshot");
    let nextResearchTaskId = 0;
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => `research-task-invalid-${++nextResearchTaskId}`,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const baseSnapshot = publishedRuntimeSnapshot(knowledgeSpaceId);
    const runtimeSnapshot = {
      ...baseSnapshot,
      retrievalProfile: {
        ...baseSnapshot.retrievalProfile,
        defaultMode: "research" as const,
        rerank: { enabled: false as const },
        topK: 29,
      },
    };
    const resolve = vi.fn(async () => structuredClone(runtimeSnapshot));
    const assertReady = vi.fn(async () => undefined);
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "write-token": {
            scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
      researchTasks,
      runtimeSnapshotResolver: { assertReady, resolve },
    });

    const plan = await app.request("/research-tasks/plan", {
      body: JSON.stringify({ knowledgeSpaceId, mode: "deep", query: "invalid deep override" }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(plan.status).toBe(400);
    await expect(plan.json()).resolves.toEqual({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      error:
        "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled",
      mode: "deep",
    });

    const create = await app.request("/research-tasks", {
      body: JSON.stringify({ knowledgeSpaceId, mode: "fast", query: "invalid fast override" }),
      headers: {
        authorization: "Bearer write-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(create.status).toBe(400);
    await expect(create.json()).resolves.toEqual({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      error:
        "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled",
      mode: "fast",
    });
    expect(createPermissionSnapshot).not.toHaveBeenCalled();
    expect(assertReady).not.toHaveBeenCalled();
    await expect(researchTasks.get("research-task-invalid-1")).resolves.toBeNull();
    await expect(adapter.jobs.stats()).resolves.toMatchObject({ queued: 0 });
  });
});

function publishedRuntimeSnapshot(knowledgeSpaceId: string) {
  return {
    embeddingCapabilitySnapshot: {
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      pluginUniqueIdentifier: "embedding-install-v3",
    },
    embeddingProfile: {
      dimension: 2_048,
      model: "embed-v3",
      pluginId: "plugin-embedding",
      provider: "provider-a",
      revision: 3,
      vectorSpaceId: `embedding-space-sha256:${"b".repeat(64)}`,
    },
    projectionSnapshot: {
      fingerprint: "sha256:publication-v8",
      headRevision: 8,
      knowledgeSpaceId,
      projectionVersion: 8,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: { pluginUniqueIdentifier: "reasoning-install-v5" },
    },
    retrievalProfile: {
      defaultMode: "deep" as const,
      reasoningModel: {
        model: "reason-v5",
        pluginId: "plugin-reasoning",
        provider: "provider-a",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-v2",
          pluginId: "plugin-rerank",
          provider: "provider-a",
        },
      },
      revision: 5,
      scoreThreshold: { enabled: true, stage: "mode-final" as const, value: 0.42 },
      topK: 37,
    },
  };
}
