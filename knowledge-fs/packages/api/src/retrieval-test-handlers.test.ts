import { OpenAPIHono } from "@hono/zod-openapi";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { type AnswerTraceRecorder, createAnswerTraceRecorder } from "./answer-trace-recorder";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import { createStaticAuthVerifier } from "./auth";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { QueryGenerator } from "./gateway-sse-responses";
import { createKnowledgeGateway } from "./index";
import {
  type KnowledgeSpaceOverviewRepository,
  deterministicKnowledgeSpaceActivityId,
} from "./knowledge-space-overview";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshot } from "./published-knowledge-space-runtime-snapshot";
import { KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER } from "./query-images";
import { RetrievalExecutionAdmissionError } from "./retrieval-execution-lease";
import {
  type RetrievalTestExecutor,
  type RetrievalTestResult,
  createRetrievalTestExecutor,
} from "./retrieval-test";
import { registerRetrievalTestHandlers } from "./retrieval-test-handlers";
import {
  RetrievalTestMetricsSchema,
  RetrievalTestRequestSchema,
  RetrievalTestResponseSchema,
} from "./retrieval-test-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SECOND_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const TOKEN = "owner-token";
const WORKFLOW_QUERY_ID = "10000000-0000-4000-8000-000000000010";
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
  it.each([
    {
      expectedOutcome: "answered",
      result: retrievalResult("fast"),
    },
    {
      expectedOutcome: "low-confidence",
      result: emptyRetrievalResult({ scoreThresholdFilteredCandidates: 2 }),
    },
    {
      expectedOutcome: "no-evidence",
      result: emptyRetrievalResult(),
    },
  ] as const)(
    "records workflow retrieval as $expectedOutcome for Overview",
    async ({ expectedOutcome, result }) => {
      const { answerTraceRecorder, app, overview } = workflowTelemetryApp(result);
      const expectedTraceId = deterministicKnowledgeSpaceActivityId(
        "workflow.answer-trace",
        "tenant-1",
        SPACE_ID,
        WORKFLOW_QUERY_ID,
      );

      const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
        body: JSON.stringify({ query: "workflow camera query", queryId: WORKFLOW_QUERY_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(overview.appendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "query.requested",
          details: expect.objectContaining({ mode: "fast" }),
          resource: { id: expectedTraceId, type: "query" },
        }),
      );
      expect(answerTraceRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilityGrantId: "10000000-0000-4000-8000-000000000011",
          traceId: expectedTraceId,
          steps: [
            expect.objectContaining({
              metadata: expect.objectContaining({
                queryOutcome: expectedOutcome,
                workflowQueryId: WORKFLOW_QUERY_ID,
              }),
              name: "query.generate",
              status: "ok",
            }),
          ],
        }),
      );
    },
  );

  it("keeps interactive retrieval tests out of Overview query traffic", async () => {
    const { answerTraceRecorder, app, overview } = workflowTelemetryApp(retrievalResult("fast"), {
      callerKind: "interactive",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ query: "manual camera query", queryId: WORKFLOW_QUERY_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(overview.appendActivity).not.toHaveBeenCalled();
    expect(answerTraceRecorder.record).not.toHaveBeenCalled();
  });

  it("keeps legacy workflow requests without a business query id out of Overview", async () => {
    const { answerTraceRecorder, app, overview } = workflowTelemetryApp(retrievalResult("fast"));

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({ query: "legacy workflow camera query" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(overview.appendActivity).not.toHaveBeenCalled();
    expect(answerTraceRecorder.record).not.toHaveBeenCalled();
  });

  it("persists one trace per space for a shared workflow query id", async () => {
    const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 10, maxTraces: 10 });
    const answerTraceRecorder = createAnswerTraceRecorder({
      now: () => "2026-09-04T08:00:00.000Z",
      repository: answerTraces,
    });
    const overview = {
      appendActivity: vi.fn(async (input) => input as never),
    } satisfies Pick<KnowledgeSpaceOverviewRepository, "appendActivity">;
    const first = workflowTelemetryApp(retrievalResult("fast"), {
      answerTraceRecorder,
      overview,
      spaceId: SPACE_ID,
    });
    const second = workflowTelemetryApp(retrievalResult("fast"), {
      answerTraceRecorder,
      grantId: "10000000-0000-4000-8000-000000000012",
      overview,
      spaceId: SECOND_SPACE_ID,
    });

    const responses = await Promise.all(
      [
        { app: first.app, spaceId: SPACE_ID },
        { app: second.app, spaceId: SECOND_SPACE_ID },
      ].map(({ app, spaceId }) =>
        app.request(`/knowledge-spaces/${spaceId}/retrieval-tests`, {
          body: JSON.stringify({ query: "shared workflow query", queryId: WORKFLOW_QUERY_ID }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const traceIds = overview.appendActivity.mock.calls.map(
      ([activity]) => activity.resource.id as string,
    );
    expect(new Set(traceIds).size).toBe(2);
    const traces = await Promise.all([
      answerTraces.get({ id: traceIds[0] as string, knowledgeSpaceId: SPACE_ID }),
      answerTraces.get({ id: traceIds[1] as string, knowledgeSpaceId: SECOND_SPACE_ID }),
    ]);
    expect(traces.map((trace) => trace?.knowledgeSpaceId)).toEqual([SPACE_ID, SECOND_SPACE_ID]);
    for (const trace of traces) {
      expect(trace?.steps[0]?.metadata).toMatchObject({ workflowQueryId: WORKFLOW_QUERY_ID });
    }
  });

  it("keeps pure-image workflow requests on text-only spaces out of Overview", async () => {
    const { answerTraceRecorder, app, overview } = workflowTelemetryApp(retrievalResult("fast"), {
      modelInputModalityResolver: { resolve: async () => ["text"] },
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-tests`, {
      body: JSON.stringify({
        queryId: WORKFLOW_QUERY_ID,
        queryImages: [{ uploadFileId: "00000000-0000-4000-8000-000000000001" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(overview.appendActivity).not.toHaveBeenCalled();
    expect(answerTraceRecorder.record).not.toHaveBeenCalled();
  });

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

function emptyRetrievalResult(
  metrics: { readonly scoreThresholdFilteredCandidates?: number } = {},
): RetrievalTestResult {
  return {
    ...retrievalResult("fast"),
    items: [],
    metrics: {
      ...retrievalResult("fast").metrics,
      ...metrics,
    },
  };
}

function workflowTelemetryApp(
  result: RetrievalTestResult,
  options: {
    readonly answerTraceRecorder?: AnswerTraceRecorder;
    readonly callerKind?: DifyCapabilityV2SanitizedGrant["callerKind"];
    readonly grantId?: string;
    readonly modelInputModalityResolver?: Parameters<
      typeof registerRetrievalTestHandlers
    >[0]["modelInputModalityResolver"];
    readonly overview?: Pick<KnowledgeSpaceOverviewRepository, "appendActivity">;
    readonly spaceId?: string;
  } = {},
) {
  const spaceId = options.spaceId ?? SPACE_ID;
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  const overview =
    options.overview ??
    ({
      appendActivity: vi.fn(async (input) => input as never),
    } satisfies Pick<KnowledgeSpaceOverviewRepository, "appendActivity">);
  const answerTraceRecorder =
    options.answerTraceRecorder ??
    ({
      record: vi.fn(async (input) => input as never),
    } satisfies AnswerTraceRecorder);
  const grant: DifyCapabilityV2SanitizedGrant = {
    action: "queries.retrieval_test",
    actor: "dify-app:app-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "app-1",
    callerKind: options.callerKind ?? "workflow",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: [`knowledge-space:${spaceId}`],
    controlSpaceId: "control-space-1",
    expiresAt: 9_999_999_999,
    grantId: options.grantId ?? "10000000-0000-4000-8000-000000000011",
    issuedAt: 1,
    jtiHash: "hash",
    namespaceId: "tenant-1",
    notBefore: 1,
    resource: { id: spaceId, parent_id: null, type: "knowledge_space" },
    subject: "dify-app:app-1",
    traceId: "workflow-run-1",
  };
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: [],
      subjectId: "dify-app:app-1",
      tenantId: "tenant-1",
    });
    context.set("capabilityV2Grant", grant);
    context.set("traceId", "transport-trace-1");
    await next();
  });
  registerRetrievalTestHandlers({
    answerTraceRecorder,
    app,
    executor: { execute: async () => result },
    ...(options.modelInputModalityResolver
      ? { modelInputModalityResolver: options.modelInputModalityResolver }
      : {}),
    overview,
    retrievalExecutionLeases: {
      acquire: async () => ({
        assertActive: async () => undefined,
        release: async () => undefined,
        signal: new AbortController().signal,
      }),
    },
    runtimeSnapshotResolver: {
      assertReady: async () => undefined,
      resolve: async () => ({
        ...runtimeSnapshot(),
        projectionSnapshot: {
          ...runtimeSnapshot().projectionSnapshot,
          knowledgeSpaceId: spaceId,
        },
        retrievalProfile: {
          ...retrievalProfile,
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.7 },
        },
      }),
    },
    spaces: {
      get: async () => ({ id: spaceId, tenantId: "tenant-1" }) as never,
    },
  });
  return { answerTraceRecorder, app, overview };
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
