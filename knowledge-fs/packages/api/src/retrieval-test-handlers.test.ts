import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import type { QueryGenerator } from "./gateway-sse-responses";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshot } from "./published-knowledge-space-runtime-snapshot";
import { RetrievalExecutionAdmissionError } from "./retrieval-execution-lease";
import type { RetrievalTestExecutor, RetrievalTestResult } from "./retrieval-test";
import { RetrievalTestResponseSchema } from "./retrieval-test-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const TOKEN = "owner-token";
const reasoningSelection = {
  model: "reasoning-1",
  pluginId: "plugin/reasoning",
  provider: "provider-a",
} as const;
const rerankSelection = {
  model: "rerank-1",
  pluginId: "plugin/rerank",
  provider: "provider-a",
} as const;
const embeddingSelection = {
  model: "embed-3",
  pluginId: "plugin/embed",
  provider: "provider-a",
} as const;
const retrievalProfile: KnowledgeSpaceRetrievalProfile = {
  defaultMode: "fast",
  reasoningModel: reasoningSelection,
  rerank: { enabled: true, model: rerankSelection },
  revision: 3,
  scoreThreshold: { enabled: false, stage: "mode-final" },
  topK: 3,
};

describe("retrieval test route", () => {
  it("uses one atomic runtime snapshot, middleware-issued candidate ACL, and deletion lease without answer generation", async () => {
    const execute = vi.fn(async (): Promise<RetrievalTestResult> => retrievalResult("deep"));
    const resolve = vi.fn(async () => runtimeSnapshot());
    const assertReady = vi.fn(async () => undefined);
    const assertActive = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({
      assertActive,
      release,
      signal: new AbortController().signal,
    }));
    const stream = vi.fn(async function* () {
      yield { delta: "must not run", type: "delta" as const };
    });
    const app = gateway({
      executor: { execute },
      queryGenerator: { stream },
      retrievalExecutionLeases: { acquire },
      runtimeSnapshotResolver: { assertReady, resolve },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ mode: "deep", query: "compare graph evidence" }),
      headers: jsonBearer(),
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(() => RetrievalTestResponseSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      capabilityStatus: { embedding: "verified", reasoning: "verified", rerank: "verified" },
      mode: "deep",
      projectionSnapshot: {
        headRevision: 4,
        publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      },
      retrievalProfile: { revision: 3, topK: 3 },
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" });
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId: SPACE_ID,
      resolvedMode: "deep",
      tenantId: "tenant-1",
    });
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeSpaceId: SPACE_ID,
        subjectId: "owner-1",
        tenantId: "tenant-1",
      }),
    );
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permissionScope: expect.arrayContaining([
          `knowledge-space:${SPACE_ID}`,
          `knowledge-space:${SPACE_ID}:role:owner`,
        ]),
        projectionSnapshot: runtimeSnapshot().projectionSnapshot,
        query: "compare graph evidence",
        retrievalProfile,
      }),
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when runtime/executor/lease capability is absent", async () => {
    const app = gateway({});
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ query: "camera" }),
      headers: jsonBearer(),
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "RETRIEVAL_TEST_UNAVAILABLE",
      error: "Published retrieval test is unavailable",
    });
  });

  it("returns 409 without executing retrieval when deletion admission rejects the lease", async () => {
    const execute = vi.fn();
    const app = gateway({
      executor: { execute } as RetrievalTestExecutor,
      retrievalExecutionLeases: {
        acquire: async () => {
          throw new RetrievalExecutionAdmissionError();
        },
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ query: "camera" }),
      headers: jsonBearer(),
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RETRIEVAL_DELETION_IN_PROGRESS",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects unverified active profiles before executing and still releases the lease", async () => {
    const execute = vi.fn();
    const release = vi.fn(async () => undefined);
    const app = gateway({
      executor: { execute } as RetrievalTestExecutor,
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => ({
          ...runtimeSnapshot(),
          retrievalCapabilitySnapshot: { verification: "unverified" },
        }),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ query: "camera" }),
      headers: jsonBearer(),
      method: "POST",
    });

    expect(response.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

function gateway({
  executor,
  queryGenerator,
  retrievalExecutionLeases,
  runtimeSnapshotResolver,
}: {
  readonly executor?: RetrievalTestExecutor;
  readonly queryGenerator?: QueryGenerator;
  readonly retrievalExecutionLeases?: Parameters<
    typeof createKnowledgeGateway
  >[0]["retrievalExecutionLeases"];
  readonly runtimeSnapshotResolver?: Parameters<
    typeof createKnowledgeGateway
  >[0]["runtimeSnapshotResolver"];
}) {
  return createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        [TOKEN]: {
          scopes: ["knowledge-spaces:*"],
          subjectId: "owner-1",
          tenantId: "tenant-1",
        },
      },
    }),
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    ...(queryGenerator ? { queryGenerator } : {}),
    ...(retrievalExecutionLeases ? { retrievalExecutionLeases } : {}),
    ...(executor ? { retrievalTestExecutor: executor } : {}),
    ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
  });
}

async function createSpace(app: ReturnType<typeof createKnowledgeGateway>): Promise<void> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Retrieval test space" }),
    headers: jsonBearer(),
    method: "POST",
  });
  expect(response.status).toBe(201);
}

function jsonBearer() {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

function runtimeSnapshot(): PublishedKnowledgeSpaceRuntimeSnapshot {
  return {
    embeddingCapabilitySnapshot: capability("embedding", embeddingSelection, 3),
    embeddingProfile: {
      ...embeddingSelection,
      dimension: 3,
      revision: 2,
      vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
    },
    projectionSnapshot: {
      fingerprint: `sha256:${"b".repeat(64)}`,
      headRevision: 4,
      knowledgeSpaceId: SPACE_ID,
      projectionVersion: 6,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: capability("reasoning", reasoningSelection),
      rerank: capability("rerank", rerankSelection),
      verification: "verified",
    },
    retrievalProfile,
  };
}

function retrievalResult(mode: "deep" | "fast" | "research"): RetrievalTestResult {
  return {
    items: [
      {
        citation: {
          artifactHash: "d".repeat(64),
          documentAssetId: "document-1",
          documentVersion: 1,
          sectionPath: ["Camera"],
        },
        nodeId: "node-1",
        projectionIds: ["projection-1"],
        score: 0.8,
        sources: ["dense", "fts"],
      },
    ],
    metrics: {
      denseCandidates: 2,
      denseMs: 1,
      ftsCandidates: 2,
      ftsMs: 1,
      fusedCandidates: 3,
      fusionMs: 1,
      graphExpansionCandidates: mode === "deep" ? 1 : undefined,
      graphExpansionMs: mode === "deep" ? 1 : undefined,
      rerankCandidates: 3,
      rerankMs: 1,
      totalMs: 5,
    },
    plan: {
      denseTopK: 3,
      ftsTopK: 3,
      fusionLimit: 3,
      queryLanguage: "latin",
      requestedMode: mode,
      rerankCandidateLimit: 3,
      resolvedMode: mode,
      strategyVersion: "retrieval-planner-v1",
      topK: 3,
    },
    stages: [
      { candidateCount: 2, name: "dense", status: "executed" },
      { candidateCount: 1, name: "graph", status: mode === "deep" ? "executed" : "skipped" },
      { candidateCount: 3, name: "rerank", status: "executed" },
    ],
  };
}

function capability(
  kind: "embedding" | "reasoning" | "rerank",
  selection: typeof embeddingSelection | typeof reasoningSelection | typeof rerankSelection,
  dimension?: number,
) {
  return {
    capabilityDigest: `sha256:${kind.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`,
    checkedAt: "2026-07-14T12:00:00.000Z",
    ...(dimension === undefined ? {} : { dimension, distanceMetric: "cosine" }),
    kind,
    pluginUniqueIdentifier: `${selection.pluginId}:1@installed`,
    schemaFingerprint: `sha256:${"c".repeat(64)}`,
    selection,
  };
}
