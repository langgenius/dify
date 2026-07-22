import { describe, expect, it, vi } from "vitest";

import { AUTO_RETRIEVAL_MODE_PROMPT_VERSION } from "./auto-retrieval-mode-resolver";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { PublishedProjectionReadUnavailableError } from "./published-projection-read-snapshot";
import { registerQueryHandlers } from "./query-handlers";
import { streamQueryRoute } from "./query-routes";
import { RetrievalExecutionAdmissionError } from "./retrieval-execution-lease";
import { TidbFtsPostingBackfillNotReadyError } from "./tidb-fts-posting-backfill";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SUBJECT = { scopes: ["knowledge-spaces:read"], subjectId: "owner-1", tenantId: "tenant-1" };

describe("query handler branch coverage", () => {
  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid permission snapshot TTL %s",
    (permissionSnapshotTtlMs) => {
      expect(() => queryFixture({ permissionSnapshotTtlMs })).toThrow(
        "permissionSnapshotTtlMs must be a positive integer",
      );
    },
  );

  it("rejects blank queries and missing spaces", async () => {
    expect((await queryFixture({ body: { query: "   " } }).invoke()).status).toBe(400);
    expect((await queryFixture({ space: null }).invoke()).status).toBe(404);
  });

  it("validates capability control-space and tenant bindings", async () => {
    for (const capability of [
      { ...capabilityGrant(), controlSpaceId: "other" },
      { ...capabilityGrant(), namespaceId: "other" },
    ]) {
      expect((await queryFixture({ capability }).invoke()).status).toBe(403);
    }
    const exact = queryFixture({ capability: capabilityGrant(), queryGenerator: false });
    expect((await exact.invoke()).status).toBe(503);
    expect(exact.createPermissionSnapshot).not.toHaveBeenCalled();
  });

  it("maps interactive and API-key authorization boundaries", async () => {
    expect(
      (await queryFixture({ callerKind: "api_key", queryGenerator: false }).invoke()).status,
    ).toBe(403);

    const denied = queryFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "denied",
      ),
    });
    expect((await denied.invoke()).status).toBe(403);

    const failure = new Error("authorization failed");
    await expect(queryFixture({ authorizeError: failure }).invoke()).rejects.toBe(failure);

    const api = queryFixture({
      apiKey: { expiresAt: "2026-07-14T13:00:00.000Z", id: "key-1", revision: 2 },
      callerKind: "api_key",
      queryGenerator: false,
    });
    expect((await api.invoke()).status).toBe(503);
    expect(api.createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.objectContaining({ id: "key-1" }) }),
    );
  });

  it("maps runtime snapshot availability and unexpected resolver failures", async () => {
    const unavailable = queryFixture({
      runtimeError: new PublishedProjectionReadUnavailableError({
        knowledgeSpaceId: SPACE_ID,
        tenantId: SUBJECT.tenantId,
      }),
    });
    expect((await unavailable.invoke()).status).toBe(503);

    const failure = new Error("runtime failed");
    await expect(queryFixture({ runtimeError: failure }).invoke()).rejects.toBe(failure);
  });

  it("maps lease admission and propagates unexpected acquisition failures", async () => {
    expect(
      (await queryFixture({ leaseAcquireError: new RetrievalExecutionAdmissionError() }).invoke())
        .status,
    ).toBe(409);
    const failure = new Error("lease failed");
    await expect(queryFixture({ leaseAcquireError: failure }).invoke()).rejects.toBe(failure);
  });

  it("releases an aborted lease when auto-mode resolution is canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    const release = vi.fn(async () => undefined);
    const fixture = queryFixture({
      autoResolver: {
        resolve: vi.fn(async () => {
          throw new Error("canceled");
        }),
      },
      body: { mode: "auto" },
      lease: { release, signal: controller.signal },
      manifest: { retrievalProfile: retrievalProfile() },
    });
    expect((await fixture.invoke()).status).toBe(409);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an invalid mode/profile combination and releases its lease", async () => {
    const release = vi.fn(async () => undefined);
    const fixture = queryFixture({
      lease: { release, signal: new AbortController().signal },
      manifest: {
        retrievalProfile: retrievalProfile({
          rerank: { enabled: false },
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
        }),
      },
    });
    expect((await fixture.invoke()).status).toBe(400);
    expect(release).toHaveBeenCalledOnce();
  });

  it("requires runtime embedding and a configured generator", async () => {
    const runtime = queryFixture({
      runtimeSnapshot: {
        embeddingProfile: undefined,
        projectionSnapshot: { publicationId: "publication-1" },
        retrievalProfile: retrievalProfile(),
      },
    });
    expect((await runtime.invoke()).status).toBe(503);
    expect((await queryFixture({ queryGenerator: false }).invoke()).status).toBe(503);
  });

  it("maps TiDB readiness and projection snapshot failures", async () => {
    const notReady = queryFixture({
      readinessError: new TidbFtsPostingBackfillNotReadyError("running"),
    });
    expect((await notReady.invoke()).status).toBe(503);

    const readinessFailure = new Error("readiness failed");
    await expect(queryFixture({ readinessError: readinessFailure }).invoke()).rejects.toBe(
      readinessFailure,
    );

    const projectionUnavailable = queryFixture({
      projectionError: new PublishedProjectionReadUnavailableError({
        knowledgeSpaceId: SPACE_ID,
        tenantId: SUBJECT.tenantId,
      }),
    });
    expect((await projectionUnavailable.invoke()).status).toBe(503);

    const projectionFailure = new Error("projection failed");
    await expect(queryFixture({ projectionError: projectionFailure }).invoke()).rejects.toBe(
      projectionFailure,
    );
  });

  it("bypasses lexical readiness for research mode", async () => {
    const fixture = queryFixture({
      body: { mode: "research" },
      readinessError: new Error("must not run"),
    });
    expect((await fixture.invoke()).status).toBe(200);
    expect(fixture.assertReady).not.toHaveBeenCalled();
  });

  it("builds legacy-default, request, profile-default, and auto route metadata", async () => {
    const cases = [
      queryFixture({ body: { mode: undefined } }),
      queryFixture({ body: { mode: "deep" } }),
      queryFixture({
        body: { mode: undefined },
        manifest: { retrievalProfile: retrievalProfile() },
      }),
      queryFixture({
        autoResolver: {
          resolve: vi.fn(async () => ({
            finishReason: "stop",
            generationModel: "reason-model",
            mode: "deep",
            promptVersion: AUTO_RETRIEVAL_MODE_PROMPT_VERSION,
            provider: "provider-a",
            reasonCode: "relationship_exploration",
            usage: { completionTokens: 1, promptTokens: 2, totalTokens: 3 },
          })),
        },
        body: { mode: "auto" },
        manifest: { retrievalProfile: retrievalProfile() },
      }),
    ];
    for (const fixture of cases) {
      const response = await fixture.invoke();
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }
  });

  it("passes optional lease, session, projection, recorder, and profile inputs into SSE", async () => {
    const release = vi.fn(async () => undefined);
    const fixture = queryFixture({
      answerTraceRecorder: {},
      body: { mode: "fast", sessionId: "session-existing" },
      failedQueryLowConfidenceScoreFloor: 0.2,
      failedQueryRecorder: {},
      lease: { release, signal: new AbortController().signal },
      manifest: { retrievalProfile: retrievalProfile() },
      projectionSnapshot: { publicationId: "publication-1" },
    });
    const response = await fixture.invoke();
    expect(response.status).toBe(200);
    expect(fixture.recordQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalExecution: expect.any(Object),
        sessionId: "session-existing",
      }),
    );
    await response.body?.cancel();
  });

  it("records requested and failed terminal activity and releases after session failure", async () => {
    const release = vi.fn(async () => undefined);
    const appendActivity = vi.fn(async () => ({}));
    const failure = new Error("session failed");
    const fixture = queryFixture({
      lease: { release, signal: new AbortController().signal },
      overview: { appendActivity },
      sessionError: failure,
    });
    await expect(fixture.invoke()).rejects.toBe(failure);
    expect(appendActivity).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledOnce();
  });

  it("records successful terminal activity when the stream completes", async () => {
    const appendActivity = vi.fn(async () => ({}));
    const fixture = queryFixture({ overview: { appendActivity } });
    const response = await fixture.invoke();
    expect(response.status).toBe(200);
    await response.text();
    expect(appendActivity).toHaveBeenCalledTimes(2);
    expect(appendActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "query.completed", result: "success" }),
    );
  });
});

interface QueryFixtureOptions {
  readonly answerTraceRecorder?: unknown;
  readonly apiKey?: unknown;
  readonly authorizeError?: Error;
  readonly autoResolver?: unknown;
  readonly body?: Record<string, unknown>;
  readonly callerKind?: string;
  readonly capability?: unknown;
  readonly failedQueryLowConfidenceScoreFloor?: number;
  readonly failedQueryRecorder?: unknown;
  readonly lease?: unknown;
  readonly leaseAcquireError?: Error;
  readonly manifest?: unknown;
  readonly overview?: unknown;
  readonly permissionSnapshotTtlMs?: number;
  readonly projectionError?: Error;
  readonly projectionSnapshot?: unknown;
  readonly queryGenerator?: boolean;
  readonly readinessError?: Error;
  readonly runtimeError?: Error;
  readonly runtimeSnapshot?: unknown;
  readonly sessionError?: Error;
  readonly space?: unknown;
}

function queryFixture(options: QueryFixtureOptions = {}) {
  let callback: ((context: never) => Promise<Response>) | undefined;
  const app = {
    openapi: vi.fn((_route: unknown, handler: (context: never) => Promise<Response>) => {
      callback = handler;
    }),
  };
  const createPermissionSnapshot = vi.fn(async () => ({
    accessChannel: options.callerKind === "api_key" ? "service_api" : "interactive",
    id: "permission-1",
    permissionScopes: [],
    revision: 1,
  }));
  const recordQuery = vi.fn(async () => {
    if (options.sessionError) throw options.sessionError;
    return { context: { sessionId: "session-1" } };
  });
  const assertReady = vi.fn(async () => {
    if (options.readinessError) throw options.readinessError;
  });
  const projectionResolve = vi.fn(async () => {
    if (options.projectionError) throw options.projectionError;
    return options.projectionSnapshot;
  });
  registerQueryHandlers({
    access: { createPermissionSnapshot } as never,
    ...(options.answerTraceRecorder
      ? { answerTraceRecorder: options.answerTraceRecorder as never }
      : {}),
    app: app as never,
    ...(options.autoResolver ? { autoRetrievalModeResolver: options.autoResolver as never } : {}),
    authorization: {
      authorize: vi.fn(async () => {
        if (options.authorizeError) throw options.authorizeError;
        return {};
      }),
    } as never,
    ...(options.failedQueryLowConfidenceScoreFloor === undefined
      ? {}
      : { failedQueryLowConfidenceScoreFloor: options.failedQueryLowConfidenceScoreFloor }),
    ...(options.failedQueryRecorder
      ? { failedQueryRecorder: options.failedQueryRecorder as never }
      : {}),
    generateQueryRunId: () => RUN_ID,
    manifests: {
      get: vi.fn(async () => (options.manifest === undefined ? null : options.manifest)),
    } as never,
    ...(options.overview ? { overview: options.overview as never } : {}),
    ...(options.permissionSnapshotTtlMs === undefined
      ? {}
      : { permissionSnapshotTtlMs: options.permissionSnapshotTtlMs }),
    ...(options.projectionError || options.projectionSnapshot
      ? { projectionSnapshotResolver: { resolve: projectionResolve } as never }
      : {}),
    queryGenerator:
      options.queryGenerator === false
        ? undefined
        : ({
            stream: async function* () {
              yield { finishReason: "stop", type: "done" } as const;
            },
          } as never),
    ...(options.lease || options.leaseAcquireError
      ? {
          retrievalExecutionLeases: {
            acquire: vi.fn(async () => {
              if (options.leaseAcquireError) throw options.leaseAcquireError;
              return options.lease;
            }),
          } as never,
        }
      : {}),
    ...(options.runtimeError || options.runtimeSnapshot
      ? {
          runtimeSnapshotResolver: {
            assertReady: vi.fn(async () => {
              if (options.projectionError) throw options.projectionError;
            }),
            resolve: vi.fn(async () => {
              if (options.runtimeError) throw options.runtimeError;
              return options.runtimeSnapshot;
            }),
          } as never,
        }
      : {}),
    sessionRepository: { recordQuery } as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
    ...(options.readinessError ? { tidbFtsPostingReadiness: { assertReady } as never } : {}),
  });
  return {
    assertReady,
    createPermissionSnapshot,
    invoke: async () => {
      if (!callback) throw new Error("query route was not registered");
      return callback(queryContext(options) as never);
    },
    recordQuery,
  };
}

function queryContext(options: QueryFixtureOptions) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", options.apiKey],
    ["callerKind", options.callerKind],
    ["capabilityV2Grant", options.capability],
    ["subject", SUBJECT],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status,
      }),
    req: {
      valid: () => ({
        activeDocumentIds: [],
        activeEntityIds: [],
        knowledgeSpaceId: SPACE_ID,
        query: "question",
        ...options.body,
      }),
    },
    set: (key: string, value: unknown) => values.set(key, value),
  };
}

function capabilityGrant() {
  return {
    contentScopeIds: [],
    controlSpaceId: SPACE_ID,
    grantId: "grant-1",
    namespaceId: SUBJECT.tenantId,
  };
}

function retrievalProfile(overrides: Record<string, unknown> = {}) {
  return {
    defaultMode: "fast",
    reasoningModel: { model: "reason-model", pluginId: "plugin-a", provider: "provider-a" },
    rerank: { enabled: false },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 8,
    ...overrides,
  };
}
