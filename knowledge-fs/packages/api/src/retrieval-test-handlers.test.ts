import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import type { QueryGenerator } from "./gateway-sse-responses";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshot } from "./published-knowledge-space-runtime-snapshot";
import { KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER } from "./query-images";
import { RetrievalExecutionAdmissionError } from "./retrieval-execution-lease";
import {
  type RetrievalTestExecutor,
  type RetrievalTestResult,
  createRetrievalTestExecutor,
} from "./retrieval-test";
import {
  RetrievalTestMetricsSchema,
  RetrievalTestRequestSchema,
  RetrievalTestResponseSchema,
} from "./retrieval-test-routes";

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
  it("resolves workflow-granted images and freezes each space's model modalities", async () => {
    const image = {
      body: new Uint8Array([1, 2, 3]),
      byteSize: 3,
      mimeType: "image/png" as const,
      sha256: "e".repeat(64),
      uploadFileId: "00000000-0000-4000-8000-000000000001",
    };
    const execute = vi.fn<RetrievalTestExecutor["execute"]>(async () => retrievalResult("fast"));
    const resolveModalities = vi.fn(async ({ snapshot }: { snapshot: unknown }) =>
      (snapshot as { kind?: string }).kind === "embedding"
        ? (["text", "image"] as const)
        : (["text"] as const),
    );
    const resolveImages = vi.fn(async () => [image]);
    const app = gateway({
      executor: { execute },
      modelInputModalityResolver: { resolve: resolveModalities },
      queryImageResolver: { resolve: resolveImages },
      subjectId: "dify-app:app-1",
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release: async () => undefined,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({
        query: "find this diagram",
        queryImages: [{ uploadFileId: image.uploadFileId }],
      }),
      headers: {
        ...jsonBearer(),
        [KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER]: encodeQueryImageGrants(["short-lived-grant"]),
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(resolveImages).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [{ accessGrant: "short-lived-grant", uploadFileId: image.uploadFileId }],
        subjectId: "dify-app:app-1",
        tenantId: "tenant-1",
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingInputModalities: ["text", "image"],
        queryImageReferenceCount: 1,
        queryImages: [image],
        reasoningInputModalities: ["text"],
      }),
    );
    expect(resolveModalities).toHaveBeenCalledTimes(2);
  });

  it("does not materialize image bytes for a text-only space", async () => {
    const execute = vi.fn<RetrievalTestExecutor["execute"]>(async () => retrievalResult("fast"));
    const resolveImages = vi.fn();
    const app = gateway({
      executor: { execute },
      modelInputModalityResolver: { resolve: async () => ["text"] },
      queryImageResolver: { resolve: resolveImages },
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release: async () => undefined,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({
        query: "find this diagram",
        queryImages: [{ uploadFileId: "00000000-0000-4000-8000-000000000001" }],
      }),
      headers: jsonBearer(),
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(resolveImages).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingInputModalities: ["text"],
        queryImageReferenceCount: 1,
        reasoningInputModalities: ["text"],
      }),
    );
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("queryImages");
  });

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
      body: JSON.stringify({
        filters: {
          customMetadata: {
            conditions: [
              {
                comparisonOperator: "is",
                fieldType: "string",
                name: "department",
                value: "finance",
              },
            ],
            logicalOperator: "and",
          },
          documentTypes: [" handbook ", "handbook"],
          nodeKinds: ["section"],
          tags: ["camera"],
        },
        includeText: true,
        mode: "deep",
        query: "compare graph evidence",
      }),
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
      items: [{ text: "Camera evidence" }],
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
        filters: {
          customMetadata: {
            conditions: [
              {
                comparisonOperator: "is",
                fieldType: "string",
                name: "department",
                value: "finance",
              },
            ],
            logicalOperator: "and",
          },
          documentTypes: ["handbook"],
          nodeKinds: ["section"],
          tags: ["camera"],
        },
        includeText: true,
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

  it("serializes the real Research executor plan and metrics contract", async () => {
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings: {
        embed: async () => ({
          dense: [[0.1, 0.2, 0.3]],
          metadata: {
            dimension: 3,
            model: embeddingSelection.model,
            provider: "dify-model-runtime",
          },
          model: embeddingSelection.model,
        }),
        kind: "dify-model-runtime",
        models: async () => [],
      },
      retriever: {
        retrieve: async (input) => ({
          items: [
            {
              citation: {
                artifactHash: "d".repeat(64),
                documentAssetId: "document-1",
                documentVersion: 1,
                sectionPath: ["Camera"],
              },
              metadata: { text: "Camera evidence" },
              nodeId: "node-1",
              permissionScope: [...(input.permissionScope ?? [])],
              projectionIds: ["projection-1"],
              score: 0.8,
              sources: ["dense", "fts", "pageindex"],
            },
          ],
          metrics: researchMetrics(),
          plan: {
            denseTopK: 30,
            ftsTopK: 30,
            fusionLimit: 15,
            queryLanguage: "latin",
            requestedMode: "research",
            rerankCandidateLimit: 15,
            resolvedMode: "research",
            strategyVersion: "retrieval-planner-v2",
            topK: 3,
          },
        }),
      },
    });
    const app = gateway({
      executor,
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release: async () => undefined,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ mode: "research", query: "compare camera evidence" }),
      headers: jsonBearer(),
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(() => RetrievalTestResponseSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      capabilityStatus: { embedding: "verified", reasoning: "verified", rerank: "verified" },
      metrics: {
        researchStrategyVersion: "research-evidence-v3",
        researchSufficiencyReached: true,
      },
      mode: "research",
      plan: { strategyVersion: "retrieval-planner-v2" },
    });
    expect(
      RetrievalTestMetricsSchema.parse({
        ...researchMetrics(),
        futureInternalMetric: undefined,
      }),
    ).not.toHaveProperty("futureInternalMetric");
  });

  it("keeps request filters bounded and rejects unsupported auto mode", () => {
    expect(
      RetrievalTestRequestSchema.safeParse({
        query: "camera",
        queryImages: [
          {
            accessGrant: "must-not-enter-the-public-body",
            uploadFileId: "00000000-0000-4000-8000-000000000001",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RetrievalTestRequestSchema.safeParse({
        filters: { tags: Array.from({ length: 101 }, (_, index) => `tag-${index}`) },
        query: "camera",
      }).success,
    ).toBe(false);
    expect(RetrievalTestRequestSchema.safeParse({ mode: "auto", query: "camera" }).success).toBe(
      false,
    );
    expect(RetrievalTestRequestSchema.safeParse({ query: "😀".repeat(16_000) }).success).toBe(true);
    expect(
      RetrievalTestRequestSchema.safeParse({
        filters: {
          customMetadata: {
            conditions: [
              {
                comparisonOperator: ">",
                fieldType: "string",
                name: "department",
                value: "finance",
              },
            ],
            logicalOperator: "and",
          },
        },
        query: "camera",
      }).success,
    ).toBe(false);
    expect(
      RetrievalTestRequestSchema.safeParse({
        filters: {
          customMetadata: {
            conditions: [{ comparisonOperator: "is", fieldType: "string", name: "Display Name" }],
            logicalOperator: "and",
          },
        },
        query: "camera",
      }).success,
    ).toBe(false);
    expect(
      RetrievalTestRequestSchema.safeParse({
        filters: {
          customMetadata: {
            conditions: [
              {
                comparisonOperator: "is",
                fieldType: "string",
                name: "department",
                value: "😀".repeat(512),
              },
            ],
            logicalOperator: "and",
          },
        },
        query: "camera",
      }).success,
    ).toBe(true);
    expect(
      RetrievalTestRequestSchema.safeParse({
        filters: {
          customMetadata: {
            conditions: [
              {
                comparisonOperator: "is",
                fieldType: "string",
                name: "department",
                value: "😀".repeat(513),
              },
            ],
            logicalOperator: "and",
          },
        },
        query: "camera",
      }).success,
    ).toBe(false);
  });

  it("validates the text limit in Unicode characters rather than UTF-16 code units", async () => {
    const text = "😀".repeat(8_192);
    const result = retrievalResult("fast");
    const execute = vi.fn(
      async (): Promise<RetrievalTestResult> => ({
        ...result,
        items: result.items.map((item) => ({ ...item, text })),
      }),
    );
    const app = gateway({
      executor: { execute },
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release: async () => undefined,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ includeText: true, query: "camera" }),
      headers: jsonBearer(),
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(() => RetrievalTestResponseSchema.parse(body)).not.toThrow();
    expect(Array.from(body.items[0].text)).toHaveLength(8_192);
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

  it("combines the HTTP disconnect signal with the retrieval lease and releases promptly", async () => {
    const requestAbort = new AbortController();
    const release = vi.fn(async () => undefined);
    let observedSignal: AbortSignal | undefined;
    const execute = vi.fn(
      async (input: Parameters<RetrievalTestExecutor["execute"]>[0]) =>
        new Promise<RetrievalTestResult>((_resolve, reject) => {
          observedSignal = input.signal;
          const onAbort = () => reject(input.signal?.reason);
          input.signal?.addEventListener("abort", onAbort, { once: true });
          if (input.signal?.aborted) onAbort();
        }),
    );
    const app = gateway({
      executor: { execute },
      retrievalExecutionLeases: {
        acquire: async () => ({
          assertActive: async () => undefined,
          release,
          signal: new AbortController().signal,
        }),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(),
      },
    });
    await createSpace(app);

    const response = app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ mode: "research", query: "compare camera evidence" }),
      headers: jsonBearer(),
      method: "POST",
      signal: requestAbort.signal,
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    requestAbort.abort(new DOMException("client disconnected", "AbortError"));

    expect((await response).status).toBe(503);
    expect(observedSignal?.aborted).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
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
  modelInputModalityResolver,
  queryGenerator,
  queryImageResolver,
  retrievalExecutionLeases,
  runtimeSnapshotResolver,
  subjectId = "owner-1",
}: {
  readonly executor?: RetrievalTestExecutor;
  readonly modelInputModalityResolver?: Parameters<
    typeof createKnowledgeGateway
  >[0]["modelInputModalityResolver"];
  readonly queryGenerator?: QueryGenerator;
  readonly queryImageResolver?: Parameters<typeof createKnowledgeGateway>[0]["queryImageResolver"];
  readonly retrievalExecutionLeases?: Parameters<
    typeof createKnowledgeGateway
  >[0]["retrievalExecutionLeases"];
  readonly runtimeSnapshotResolver?: Parameters<
    typeof createKnowledgeGateway
  >[0]["runtimeSnapshotResolver"];
  readonly subjectId?: string;
}) {
  return createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        [TOKEN]: {
          scopes: ["knowledge-spaces:*"],
          subjectId,
          tenantId: "tenant-1",
        },
      },
    }),
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    ...(modelInputModalityResolver ? { modelInputModalityResolver } : {}),
    ...(queryGenerator ? { queryGenerator } : {}),
    ...(queryImageResolver ? { queryImageResolver } : {}),
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

function encodeQueryImageGrants(grants: readonly (string | null)[]): string {
  return Buffer.from(JSON.stringify({ g: grants, v: 1 }), "utf8").toString("base64url");
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
        text: "Camera evidence",
      },
    ],
    metrics:
      mode === "research"
        ? researchMetrics()
        : {
            denseCandidates: 2,
            denseMs: 1,
            ftsCandidates: 2,
            ftsMs: 1,
            fusedCandidates: 3,
            fusionMs: 1,
            ...(mode === "deep" ? { graphExpansionCandidates: 1, graphExpansionMs: 1 } : {}),
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
      strategyVersion: mode === "research" ? "retrieval-planner-v2" : "retrieval-planner-v1",
      topK: 3,
    },
    stages: [
      { candidateCount: 2, name: "dense", status: "executed" },
      { candidateCount: 1, name: "graph", status: mode === "deep" ? "executed" : "skipped" },
      { candidateCount: 3, name: "rerank", status: "executed" },
    ],
  };
}

function researchMetrics() {
  return {
    denseCandidates: 4,
    denseMs: 2,
    ftsCandidates: 3,
    ftsMs: 1,
    fusedCandidates: 5,
    fusionMs: 1,
    pageIndexMatchedNodes: 4,
    pageIndexOpenedRanges: 1,
    pageIndexScannedOutlines: 2,
    rerankCandidates: 5,
    rerankMs: 2,
    researchCandidateLists: 2,
    researchEvidenceJudgeMs: 2,
    researchModelCalls: 1,
    researchOpenedResources: 1,
    researchOutlineLexicalCandidates: 1,
    researchPlanMs: 1,
    researchRounds: 1,
    researchStrategyVersion: "research-evidence-v3" as const,
    researchSufficiencyReached: true,
    researchSupplementalSearches: 0,
    totalMs: 7,
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
