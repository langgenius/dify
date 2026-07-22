import type { FailedQuery } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { registerFailedQueryHandlers } from "./failed-query-handlers";
import { FailedQueryPromotionConflictError } from "./failed-query-repository";
import {
  annotateFailedQueryRoute,
  clusterFailedQueriesRoute,
  listFailedQueriesRoute,
  metricsFailedQueriesRoute,
  triageFailedQueriesRoute,
} from "./failed-query-routes";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const FAILED_QUERY_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };

describe("failed-query handler branch coverage", () => {
  it("fails every route closed for a missing space, wrong API-key space, or stale decision", async () => {
    for (const options of [
      { space: null },
      { callerKind: "api_key", keySpaceId: "another-space" },
      { decision: undefined },
    ] as const) {
      const fixture = failedQueryFixture(options);
      for (const route of [
        listFailedQueriesRoute,
        metricsFailedQueriesRoute,
        triageFailedQueriesRoute,
        clusterFailedQueriesRoute,
        annotateFailedQueryRoute,
      ]) {
        expect((await fixture.invoke(route)).status).toBe(404);
      }
    }
  });

  it("lists filtered pages with and without a next cursor", async () => {
    const withCursor = failedQueryFixture({
      listResult: { items: [failedQuery()], nextCursor: { id: "next-id" } },
      query: { cursor: "cursor-id", limit: 5, status: "triaged" },
    });
    expect(await withCursor.invoke(listFailedQueriesRoute)).toMatchObject({
      body: { items: [{ id: FAILED_QUERY_ID }], nextCursor: "next-id" },
      status: 200,
    });
    expect(withCursor.repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "cursor-id" }, status: "triaged" }),
    );

    const empty = failedQueryFixture({ listResult: { items: [] }, query: { limit: 5 } });
    expect(await empty.invoke(listFailedQueriesRoute)).toEqual({
      body: { items: [] },
      status: 200,
    });
  });

  it("reports zero-safe and nonzero failed-query metrics", async () => {
    const zero = failedQueryFixture({ counts: {} });
    expect(await zero.invoke(metricsFailedQueriesRoute)).toMatchObject({
      body: { promotionRate: 0, total: 0 },
      status: 200,
    });

    const populated = failedQueryFixture({ counts: { dismissed: 1, promoted: 3 } });
    expect(await populated.invoke(metricsFailedQueriesRoute)).toMatchObject({
      body: { promotionRate: 0.75, total: 4 },
      status: 200,
    });
  });

  it("handles triage availability, optional limits, permission denial, and unexpected failures", async () => {
    const unavailable = failedQueryFixture({ triageRunner: null });
    expect((await unavailable.invoke(triageFailedQueriesRoute)).status).toBe(501);

    for (const query of [{ limit: undefined }, { limit: 7 }]) {
      const fixture = failedQueryFixture({ query, triageResult: { processed: 1 } });
      expect(await fixture.invoke(triageFailedQueriesRoute)).toEqual({
        body: { processed: 1 },
        status: 200,
      });
      expect(fixture.triageRun).toHaveBeenCalledWith(
        query.limit === undefined
          ? expect.not.objectContaining({ limit: expect.anything() })
          : expect.objectContaining({ limit: 7 }),
      );
    }

    const denied = failedQueryFixture({
      snapshotError: new KnowledgeSpaceAccessError("space_access_forbidden", "denied"),
    });
    expect((await denied.invoke(triageFailedQueriesRoute)).status).toBe(403);

    const failure = new Error("triage failed");
    const unexpected = failedQueryFixture({ triageError: failure });
    await expect(unexpected.invoke(triageFailedQueriesRoute)).rejects.toBe(failure);
  });

  it("clusters optional status-filtered queries", async () => {
    const fixture = failedQueryFixture({
      listResult: {
        items: [failedQuery(), failedQuery({ id: "query-2", query: "refund policy" })],
      },
      query: { limit: 10, status: "pending-triage" },
    });
    expect(await fixture.invoke(clusterFailedQueriesRoute)).toMatchObject({
      body: { clusters: [{ count: 2, failedQueryIds: [FAILED_QUERY_ID, "query-2"] }] },
      status: 200,
    });
    expect(fixture.repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending-triage" }),
    );

    const unfiltered = failedQueryFixture({ query: { limit: 10 } });
    expect((await unfiltered.invoke(clusterFailedQueriesRoute)).status).toBe(200);
    expect(unfiltered.repository.list).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it("returns not found when annotation cannot resolve its row", async () => {
    const fixture = failedQueryFixture({ existing: null });
    expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(404);
  });

  it("rejects missing evidence before promotion", async () => {
    const fixture = failedQueryFixture({
      asset: null,
      body: { expectedEvidenceIds: ["document:missing"], verdict: "retrieval-miss" },
    });
    expect(await fixture.invoke(annotateFailedQueryRoute)).toEqual({
      body: { error: "Expected evidence not found" },
      status: 404,
    });
  });

  it("promotes both new and idempotently promoted rows and maps an absent result", async () => {
    const promotedRow = failedQuery({ status: "promoted" });
    for (const existing of [failedQuery(), promotedRow]) {
      const fixture = failedQueryFixture({
        body: {
          expectedEvidenceIds: existing.status === "promoted" ? ["already-bound"] : [],
          note: "regression",
          verdict: "retrieval-miss",
        },
        existing,
        promoted: { failedQuery: promotedRow },
      });
      expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(200);
      expect(fixture.repository.promote).toHaveBeenCalledWith(
        expect.objectContaining({ note: "regression" }),
      );
    }

    const absent = failedQueryFixture({
      body: { verdict: "retrieval-miss" },
      promoted: null,
    });
    expect((await absent.invoke(annotateFailedQueryRoute)).status).toBe(404);
  });

  it.each([
    ["coverage-gap", "annotated"],
    ["irrelevant", "dismissed"],
  ] as const)("maps %s annotations to %s", async (verdict, status) => {
    const updated = failedQuery({ status });
    const fixture = failedQueryFixture({
      body: { expectedEvidenceIds: [], note: "note", verdict },
      updated,
    });
    expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(200);
    expect(fixture.repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status,
        metadata: expect.objectContaining({ annotation: expect.any(Object) }),
      }),
    );
  });

  it("returns not found when a non-promotion annotation loses its row", async () => {
    const fixture = failedQueryFixture({ body: { verdict: "irrelevant" }, updated: null });
    expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(404);
  });

  it.each([
    [new FailedQueryPromotionConflictError(), 409],
    [new KnowledgeSpaceAccessError("space_access_forbidden", "denied"), 403],
  ] as const)("maps annotation failure %# to %s", async (annotationError, status) => {
    const fixture = failedQueryFixture({ annotationError, body: { verdict: "irrelevant" } });
    expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(status);
  });

  it("lets unexpected annotation failures escape", async () => {
    const failure = new Error("annotation failed");
    const fixture = failedQueryFixture({
      annotationError: failure,
      body: { verdict: "irrelevant" },
    });
    await expect(fixture.invoke(annotateFailedQueryRoute)).rejects.toBe(failure);
  });

  it("binds API-key expiry into the short-lived mutation permission", async () => {
    const fixture = failedQueryFixture({
      apiKey: { expiresAt: "2026-07-14T13:00:00.000Z", id: "key-1", revision: 2 },
      body: { verdict: "irrelevant" },
      callerKind: "api_key",
      keySpaceId: SPACE_ID,
    });
    expect((await fixture.invoke(annotateFailedQueryRoute)).status).toBe(200);
    expect(fixture.createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.objectContaining({ id: "key-1" }) }),
    );
  });
});

interface FailedQueryFixtureOptions {
  readonly annotationError?: Error;
  readonly apiKey?: unknown;
  readonly asset?: unknown;
  readonly body?: Record<string, unknown>;
  readonly callerKind?: string;
  readonly counts?: Record<string, number>;
  readonly decision?: unknown;
  readonly existing?: FailedQuery | null;
  readonly keySpaceId?: string;
  readonly listResult?: {
    readonly items: FailedQuery[];
    readonly nextCursor?: { readonly id: string };
  };
  readonly promoted?: unknown;
  readonly query?: Record<string, unknown>;
  readonly snapshotError?: Error;
  readonly space?: unknown;
  readonly triageError?: Error;
  readonly triageResult?: unknown;
  readonly triageRunner?: null;
  readonly updated?: FailedQuery | null;
}

function failedQueryFixture(options: FailedQueryFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const createPermissionSnapshot = vi.fn(async () => {
    if (options.snapshotError) throw options.snapshotError;
    return { accessChannel: "interactive", id: "permission-1", permissionScopes: [], revision: 1 };
  });
  const triageRun = vi.fn(async () => {
    if (options.triageError) throw options.triageError;
    return options.triageResult ?? { processed: 0 };
  });
  const list = vi.fn(async () => options.listResult ?? { items: [] });
  const update = vi.fn(async () => {
    if (options.annotationError) throw options.annotationError;
    return options.updated === undefined ? failedQuery({ status: "dismissed" }) : options.updated;
  });
  const promote = vi.fn(async () => {
    if (options.annotationError) throw options.annotationError;
    return options.promoted === undefined
      ? { failedQuery: failedQuery({ status: "promoted" }) }
      : options.promoted;
  });
  const repository = {
    countByStatus: vi.fn(async () => options.counts ?? {}),
    get: vi.fn(async () => (options.existing === undefined ? failedQuery() : options.existing)),
    list,
    promote,
    update,
  };
  registerFailedQueryHandlers({
    access: { createPermissionSnapshot } as never,
    app: app as never,
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { metadata: {} } : options.asset)),
    } as never,
    failedQueries: repository as never,
    ...(options.triageRunner === null
      ? {}
      : { failedQueryTriageRunner: { run: triageRun } as never }),
    nodes: { getMany: vi.fn(async () => []) } as never,
    now: () => "2026-07-14T12:00:00.000Z",
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });

  return {
    createPermissionSnapshot,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(failedQueryContext(options) as never);
    },
    repository: { list, promote, update },
    triageRun,
  };
}

function failedQueryContext(options: FailedQueryFixtureOptions) {
  const defaultDecision = {
    permissionSnapshot: {
      candidateGrants: [],
      knowledgeSpaceId: SPACE_ID,
      subjectId: SUBJECT.subjectId,
      tenantId: SUBJECT.tenantId,
    },
  };
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", options.apiKey],
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["authorizationDecision", "decision" in options ? options.decision : defaultDecision],
    ["callerKind", options.callerKind],
    ["subject", SUBJECT],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      valid: (part: string) => {
        if (part === "param") return { failedQueryId: FAILED_QUERY_ID, id: SPACE_ID };
        if (part === "json") return options.body ?? { verdict: "irrelevant" };
        return options.query ?? { limit: 10 };
      },
    },
  };
}

function failedQuery(overrides: Partial<FailedQuery> = {}): FailedQuery {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    id: FAILED_QUERY_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mode: "fast",
    query: "What is the refund policy?",
    status: "pending-triage",
    trigger: "no-retrieval-evidence",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
