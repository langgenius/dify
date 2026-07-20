import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import type { QueryGenerationEvent, QueryGenerationInput } from "./gateway-sse-responses";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";
import {
  PublishedProjectionReadUnavailableError,
  createPublishedProjectionReadSnapshotResolver,
} from "./published-projection-read-snapshot";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

function publishedProjection() {
  return {
    createdAt: "2026-07-14T10:00:00.000Z",
    fingerprint: "published-fingerprint-v7",
    headRevision: 11,
    id: publicationId,
    knowledgeSpaceId,
    metadata: {},
    projectionVersion: 7,
    status: "published" as const,
    tenantId: "tenant-1",
    updatedAt: "2026-07-14T10:01:00.000Z",
  };
}

function publicationRepository(
  getPublished: ProjectionSetPublicationRepository["getPublished"],
): ProjectionSetPublicationRepository {
  return { getPublished } as ProjectionSetPublicationRepository;
}

async function createSpace() {
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => knowledgeSpaceId,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({ name: "Published docs", slug: "published-docs", tenantId: "tenant-1" });
  return spaces;
}

describe("published projection read snapshot", () => {
  it("captures the published head as an immutable query snapshot", async () => {
    const getPublished = vi.fn(async () => publishedProjection());
    const resolver = createPublishedProjectionReadSnapshotResolver({
      publications: publicationRepository(getPublished),
    });

    const snapshot = await resolver.resolve({ knowledgeSpaceId, tenantId: "tenant-1" });

    expect(snapshot).toEqual({
      fingerprint: "published-fingerprint-v7",
      headRevision: 11,
      knowledgeSpaceId,
      projectionVersion: 7,
      publicationId,
      tenantId: "tenant-1",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(getPublished).toHaveBeenCalledOnce();
  });

  it("fails closed with a dedicated error when the space has no published head", async () => {
    const resolver = createPublishedProjectionReadSnapshotResolver({
      publications: publicationRepository(async () => null),
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId, tenantId: "tenant-1" }),
    ).rejects.toBeInstanceOf(PublishedProjectionReadUnavailableError);
  });

  it("does not expose an intermediate bootstrap head before the readiness latch completes", async () => {
    const getPublished = vi.fn(async () => publishedProjection());
    const resolver = createPublishedProjectionReadSnapshotResolver({
      publications: publicationRepository(getPublished),
      readiness: { isQueryReady: async () => false },
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId, tenantId: "tenant-1" }),
    ).rejects.toBeInstanceOf(PublishedProjectionReadUnavailableError);
    expect(getPublished).not.toHaveBeenCalled();
  });

  it("resolves once at the query boundary and passes the same snapshot to generation", async () => {
    const spaces = await createSpace();
    const getPublished = vi.fn(async () => publishedProjection());
    const inputs: QueryGenerationInput[] = [];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          token: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]),
      knowledgeSpaces: spaces,
      projectionSetPublications: publicationRepository(getPublished),
      queryGenerator: {
        stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
          inputs.push(input);
          yield { finishReason: "stop", type: "done" };
        },
      },
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId, mode: "fast", query: "published evidence" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(getPublished).toHaveBeenCalledOnce();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.projectionSnapshot).toEqual({
      fingerprint: "published-fingerprint-v7",
      headRevision: 11,
      knowledgeSpaceId,
      projectionVersion: 7,
      publicationId,
      tenantId: "tenant-1",
    });
  });

  it("uses one frozen publication/profile tuple and skips mutable manifest reads", async () => {
    const spaces = await createSpace();
    const inputs: QueryGenerationInput[] = [];
    const embeddingProfile = {
      dimension: 4,
      model: "embed-frozen",
      pluginId: "plugin-embed",
      provider: "provider-a",
      revision: 3,
      vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
    };
    const retrievalProfile = {
      defaultMode: "fast" as const,
      reasoningModel: { model: "reason", pluginId: "plugin-llm", provider: "provider-a" },
      rerank: { enabled: false },
      revision: 5,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 6,
    };
    const projectionSnapshot = {
      fingerprint: "published-fingerprint-v7",
      headRevision: 11,
      knowledgeSpaceId,
      projectionVersion: 7,
      publicationId,
      tenantId: "tenant-1",
    };
    const resolve = vi.fn(async () => ({
      embeddingCapabilitySnapshot: {},
      embeddingProfile,
      projectionSnapshot,
      retrievalCapabilitySnapshot: {},
      retrievalProfile,
    }));
    const assertReady = vi.fn(async () => undefined);
    const manifestGet = vi.fn(async () => {
      throw new Error("mutable manifest must not be read");
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          token: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]),
      knowledgeSpaceManifests: { get: manifestGet } as never,
      knowledgeSpaces: spaces,
      queryGenerator: {
        stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
          inputs.push(input);
          yield { finishReason: "stop", type: "done" };
        },
      },
      runtimeSnapshotResolver: { assertReady, resolve },
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId, query: "frozen tuple" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId,
      resolvedMode: "fast",
      tenantId: "tenant-1",
    });
    expect(manifestGet).not.toHaveBeenCalled();
    expect(inputs[0]).toMatchObject({
      embeddingProfile,
      mode: "fast",
      projectionSnapshot,
      retrievalProfile,
    });
  });

  it("returns 503 without starting generation when a configured repository has no head", async () => {
    const spaces = await createSpace();
    const stream = vi.fn();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          token: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]),
      knowledgeSpaces: spaces,
      projectionSetPublications: publicationRepository(async () => null),
      queryGenerator: { stream },
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId, query: "unpublished evidence" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Published projection snapshot unavailable",
    });
    expect(stream).not.toHaveBeenCalled();
  });

  it("blocks only planner-resolved Research while Fast and Deep keep using the published head", async () => {
    const spaces = await createSpace();
    const observedModes: Array<string | undefined> = [];
    const retrievalProfile = {
      defaultMode: "fast" as const,
      reasoningModel: { model: "reason", pluginId: "plugin-llm", provider: "provider-a" },
      rerank: { enabled: false },
      revision: 5,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 6,
    };
    const embeddingProfile = {
      dimension: 4,
      model: "embed-frozen",
      pluginId: "plugin-embed",
      provider: "provider-a",
      revision: 3,
      vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
    };
    const resolveAutoMode = vi.fn(async (input) => ({
      generationModel: input.reasoningModel.model,
      mode: "research" as const,
      promptVersion: "auto-retrieval-mode-router-v1" as const,
      reasonCode: "structured_research" as const,
    }));
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      autoRetrievalModeResolver: { resolve: resolveAutoMode },
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          token: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]),
      knowledgeSpaces: spaces,
      runtimeSnapshotResolver: {
        assertReady: async (input) => {
          observedModes.push(input.resolvedMode);
          if (input.resolvedMode === "research") {
            throw new PublishedProjectionReadUnavailableError(input);
          }
        },
        resolve: async () => ({
          embeddingCapabilitySnapshot: {},
          embeddingProfile,
          projectionSnapshot: {
            fingerprint: "published-fingerprint-v7",
            headRevision: 11,
            knowledgeSpaceId,
            projectionVersion: 7,
            publicationId,
            tenantId: "tenant-1",
          },
          retrievalCapabilitySnapshot: {},
          retrievalProfile,
        }),
      },
      queryGenerator: {
        stream: async function* (): AsyncGenerator<QueryGenerationEvent> {
          yield { finishReason: "stop", type: "done" };
        },
      },
    });
    const request = (mode: "auto" | "deep" | "fast" | "research", query: string) =>
      app.request("/queries", {
        body: JSON.stringify({ knowledgeSpaceId, mode, query }),
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        method: "POST",
      });

    const unauthorizedAuto = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId, mode: "auto", query: "classify me" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorizedAuto.status).toBe(401);
    expect(resolveAutoMode).not.toHaveBeenCalled();

    const fast = await request("fast", "camera sensor");
    await fast.text();
    const deep = await request("deep", "camera sensor comparison details");
    await deep.text();
    const research = await request("research", "compare camera sensors");
    const autoResearch = await request(
      "auto",
      "Please research and compare the available camera sensors using all supporting evidence",
    );
    resolveAutoMode.mockRejectedValueOnce(new Error("provider secret must not escape"));
    const autoFallback = await request(
      "auto",
      "Research and analyze all evidence, but safely use the frozen default when routing fails",
    );
    await autoFallback.text();

    expect(fast.status).toBe(200);
    expect(deep.status).toBe(200);
    expect(research.status).toBe(503);
    expect(autoResearch.status).toBe(503);
    expect(autoFallback.status).toBe(200);
    expect(observedModes).toEqual(["fast", "deep", "research", "research", "fast"]);
    expect(resolveAutoMode).toHaveBeenCalledTimes(2);
    expect(resolveAutoMode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        defaultMode: "fast",
        query:
          "Please research and compare the available camera sensors using all supporting evidence",
        tenantId: "tenant-1",
      }),
    );
  });
});
