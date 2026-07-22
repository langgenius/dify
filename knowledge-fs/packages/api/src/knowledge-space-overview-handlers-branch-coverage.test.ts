import { describe, expect, it, vi } from "vitest";

import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import {
  KnowledgeSpaceAttentionRevisionConflictError,
  KnowledgeSpaceOverviewLimitError,
  encodeKnowledgeSpaceActivityCursor,
} from "./knowledge-space-overview";
import { registerKnowledgeSpaceOverviewHandlers } from "./knowledge-space-overview-handlers";
import {
  getKnowledgeSpaceOverviewStatsRoute,
  getKnowledgeSpaceProductHealthRoute,
  listKnowledgeSpaceOverviewActivityRoute,
  listKnowledgeSpaceOverviewAttentionRoute,
  transitionKnowledgeSpaceOverviewAttentionRoute,
} from "./knowledge-space-overview-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const EVENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const ROUTES = [
  getKnowledgeSpaceOverviewStatsRoute,
  listKnowledgeSpaceOverviewActivityRoute,
  listKnowledgeSpaceOverviewAttentionRoute,
  transitionKnowledgeSpaceOverviewAttentionRoute,
  getKnowledgeSpaceProductHealthRoute,
] as const;

describe("knowledge-space Overview handler branch coverage", () => {
  it("returns authorization responses for a missing space, denied role, or stale decision", async () => {
    for (const options of [
      { space: null },
      {
        authorizeError: new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ACCESS_DENIED",
          "denied",
        ),
      },
      { decision: undefined },
    ] as const) {
      const fixture = overviewFixture(options);
      for (const route of ROUTES)
        expect((await fixture.invoke(route)).status).toBe(options.space === null ? 404 : 403);
    }
  });

  it("propagates unexpected authorization failures", async () => {
    const failure = new Error("authorization failed");
    const fixture = overviewFixture({ authorizeError: failure });
    for (const route of ROUTES) await expect(fixture.invoke(route)).rejects.toBe(failure);
  });

  it("returns unavailable for every product route without an Overview repository", async () => {
    const fixture = overviewFixture({ overview: false });
    for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(503);
  });

  it("returns stats and cloned health projections", async () => {
    const fixture = overviewFixture();
    expect((await fixture.invoke(getKnowledgeSpaceOverviewStatsRoute)).status).toBe(200);
    const health = await fixture.invoke(getKnowledgeSpaceProductHealthRoute);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ state: "healthy" });
  });

  it("lists fully filtered activity with and without a next cursor", async () => {
    const nextCursor = { id: EVENT_ID, occurredAt: "2026-07-14T12:00:00.000Z" };
    const fixture = overviewFixture({
      activityResult: { items: [activity()], nextCursor },
      query: {
        action: "document.failed",
        cursor: encodeKnowledgeSpaceActivityCursor(nextCursor),
        from: "2026-07-13T12:00:00.000Z",
        limit: 5,
        resourceType: "document",
        result: "failure",
        to: "2026-07-15T12:00:00.000Z",
      },
    });
    const response = await fixture.invoke(listKnowledgeSpaceOverviewActivityRoute);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: EVENT_ID }],
      nextCursor: expect.any(String),
    });
    expect(fixture.overview.listActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.failed",
        resourceType: "document",
        result: "failure",
      }),
    );

    const empty = overviewFixture({ activityResult: { items: [] } });
    await expect(
      (await empty.invoke(listKnowledgeSpaceOverviewActivityRoute)).json(),
    ).resolves.toEqual({
      items: [],
    });
  });

  it.each([
    new KnowledgeSpaceOverviewLimitError(1),
    new URIError("bad cursor"),
    new Error("Invalid activity cursor"),
  ])("maps activity validation failure %# to 400", async (activityError) => {
    const fixture = overviewFixture({ activityError });
    expect((await fixture.invoke(listKnowledgeSpaceOverviewActivityRoute)).status).toBe(400);
  });

  it("propagates unexpected activity failures", async () => {
    const failure = new Error("activity store failed");
    await expect(
      overviewFixture({ activityError: failure }).invoke(listKnowledgeSpaceOverviewActivityRoute),
    ).rejects.toBe(failure);
  });

  it("lists public attention issues and maps bounded-list failures", async () => {
    const fixture = overviewFixture({ query: { includeDismissed: true, limit: 5 } });
    const response = await fixture.invoke(listKnowledgeSpaceOverviewAttentionRoute);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).not.toHaveProperty("requiredPermissionScope");

    const limited = overviewFixture({ attentionError: new KnowledgeSpaceOverviewLimitError(1) });
    expect((await limited.invoke(listKnowledgeSpaceOverviewAttentionRoute)).status).toBe(400);

    const failure = new Error("attention failed");
    await expect(
      overviewFixture({ attentionError: failure }).invoke(listKnowledgeSpaceOverviewAttentionRoute),
    ).rejects.toBe(failure);
  });

  it("transitions attention with optional dismissal and handles a lost issue", async () => {
    const withDismissal = overviewFixture({
      body: {
        dismissedUntil: "2026-07-15T12:00:00.000Z",
        expectedRevision: 1,
        status: "dismissed",
      },
    });
    expect(
      (await withDismissal.invoke(transitionKnowledgeSpaceOverviewAttentionRoute)).status,
    ).toBe(200);
    expect(withDismissal.overview.transitionAttention).toHaveBeenCalledWith(
      expect.objectContaining({ dismissedUntil: "2026-07-15T12:00:00.000Z" }),
    );

    const absent = overviewFixture({ transitionResult: null });
    expect((await absent.invoke(transitionKnowledgeSpaceOverviewAttentionRoute)).status).toBe(404);
  });

  it.each([
    [new KnowledgeSpaceAccessError("space_access_forbidden", "denied"), 403],
    [new KnowledgeSpaceAttentionRevisionConflictError(), 409],
  ] as const)("maps attention transition failure %# to %s", async (transitionError, status) => {
    const fixture = overviewFixture({ transitionError });
    expect((await fixture.invoke(transitionKnowledgeSpaceOverviewAttentionRoute)).status).toBe(
      status,
    );
  });

  it("propagates unexpected transition failures and binds API-key expiry", async () => {
    const failure = new Error("transition failed");
    await expect(
      overviewFixture({ transitionError: failure }).invoke(
        transitionKnowledgeSpaceOverviewAttentionRoute,
      ),
    ).rejects.toBe(failure);

    const api = overviewFixture({
      apiKey: { expiresAt: "2026-07-14T13:00:00.000Z", id: "key-1", revision: 2 },
      callerKind: "api_key",
    });
    expect((await api.invoke(transitionKnowledgeSpaceOverviewAttentionRoute)).status).toBe(200);
    expect(api.createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.objectContaining({ id: "key-1" }) }),
    );
  });
});

interface OverviewFixtureOptions {
  readonly activityError?: Error;
  readonly activityResult?: unknown;
  readonly apiKey?: unknown;
  readonly attentionError?: Error;
  readonly authorizeError?: Error;
  readonly body?: Record<string, unknown>;
  readonly callerKind?: string;
  readonly decision?: unknown;
  readonly overview?: boolean;
  readonly query?: Record<string, unknown>;
  readonly space?: unknown;
  readonly transitionError?: Error;
  readonly transitionResult?: unknown;
}

function overviewFixture(options: OverviewFixtureOptions = {}) {
  const callbacks = new Map<unknown, (context: never) => Promise<Response>>();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<Response>) => {
      callbacks.set(route, callback);
    }),
  };
  const createPermissionSnapshot = vi.fn(async () => ({
    accessChannel: options.callerKind === "api_key" ? "service_api" : "interactive",
    id: "permission-1",
    permissionScopes: [],
    revision: 1,
  }));
  const overview = {
    getHealth: vi.fn(async () => health()),
    getStats: vi.fn(async () => ({ generatedAt: "2026-07-14T12:00:00.000Z" })),
    listActivity: vi.fn(async () => {
      if (options.activityError) throw options.activityError;
      return options.activityResult ?? { items: [] };
    }),
    listAttention: vi.fn(async () => {
      if (options.attentionError) throw options.attentionError;
      return [attention()];
    }),
    transitionAttention: vi.fn(async () => {
      if (options.transitionError) throw options.transitionError;
      return options.transitionResult === undefined ? attention() : options.transitionResult;
    }),
  };
  registerKnowledgeSpaceOverviewHandlers({
    access: { createPermissionSnapshot } as never,
    app: app as never,
    authorization: {
      authorize: vi.fn(async () => {
        if (options.authorizeError) throw options.authorizeError;
        return "decision" in options ? options.decision : decision();
      }),
    } as never,
    now: () => "2026-07-14T12:00:00.000Z",
    ...(options.overview === false ? {} : { overview: overview as never }),
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });
  return {
    createPermissionSnapshot,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(overviewContext(options) as never);
    },
    overview,
  };
}

function overviewContext(options: OverviewFixtureOptions) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", options.apiKey],
    ["callerKind", options.callerKind],
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
      valid: (part: string) => {
        if (part === "param") return { id: SPACE_ID, issueKey: "issue-1" };
        if (part === "json") return options.body ?? { expectedRevision: 1, status: "resolved" };
        return options.query ?? { limit: 10 };
      },
    },
    set: (key: string, value: unknown) => values.set(key, value),
  };
}

function decision() {
  return {
    permissionSnapshot: {
      candidateGrants: [],
      knowledgeSpaceId: SPACE_ID,
      subjectId: SUBJECT.subjectId,
      tenantId: SUBJECT.tenantId,
    },
  };
}

function activity() {
  return {
    action: "document.failed",
    actor: { type: "system" },
    details: {},
    id: EVENT_ID,
    occurredAt: "2026-07-14T12:00:00.000Z",
    resource: { id: "document-1", type: "document" },
    result: "failure",
  };
}

function attention() {
  return {
    action: { kind: "open-resource", resourceId: "document-1", resourceType: "document" },
    evidence: [{ code: "FAILED", observedAt: "2026-07-14T12:00:00.000Z" }],
    issueKey: "issue-1",
    knowledgeSpaceId: SPACE_ID,
    requiredPermissionScope: [],
    resource: { id: "document-1", type: "document" },
    revision: 1,
    ruleId: "failed-document",
    severity: "critical",
    status: "active",
    title: "Document failed",
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
}

function health() {
  const component = { codes: [], state: "healthy" };
  return {
    components: {
      index: component,
      ingestion: component,
      profilePublication: component,
      queryAvailability: component,
      sourceFreshness: component,
      workerReadiness: component,
    },
    generatedAt: "2026-07-14T12:00:00.000Z",
    knowledgeSpaceId: SPACE_ID,
    state: "healthy",
  };
}
