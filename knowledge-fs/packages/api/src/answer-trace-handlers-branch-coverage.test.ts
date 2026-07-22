import { type AnswerTrace, EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { registerAnswerTraceHandlers } from "./answer-trace-handlers";
import {
  getAnswerTraceRoute,
  listQueryConflictsRoute,
  listQueryEvidenceRoute,
  listQueryMissingRoute,
} from "./answer-trace-routes";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const RELATED_NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00";
const MISSING_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const SUBJECT = { scopes: ["knowledge-spaces:read"], subjectId: "owner-1", tenantId: "tenant-1" };
const ROUTES = [
  getAnswerTraceRoute,
  listQueryEvidenceRoute,
  listQueryConflictsRoute,
  listQueryMissingRoute,
] as const;

describe("answer-trace handler branch coverage", () => {
  it("returns not found across all routes for a missing trace or tenant space", async () => {
    for (const options of [{ trace: null }, { space: null }] as const) {
      const fixture = traceFixture(options);
      for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("rejects a mismatched API-key space across all routes", async () => {
    const fixture = traceFixture({ callerKind: "api_key", keySpaceId: "another-space" });
    for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(403);
  });

  it("hides traces from a different requester without a current capability", async () => {
    const fixture = traceFixture({ trace: answerTrace({ subjectId: "another-owner" }) });
    for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
  });

  it("serves every projection through an exact query capability and strips internal fields", async () => {
    const trace = answerTrace({
      permissionSnapshot: undefined,
      subjectId: undefined,
      tenantId: undefined,
    });
    const fixture = traceFixture({ capability: capabilityGrant(), trace });
    for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(200);
    expect((await fixture.invoke(getAnswerTraceRoute)).body).not.toHaveProperty(
      "capabilityGrantId",
    );
    expect((await fixture.invoke(getAnswerTraceRoute)).body).not.toHaveProperty("subjectId");
  });

  it("fails closed when durable revalidation or current authorization is denied", async () => {
    const denied = traceFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "denied",
      ),
    });
    for (const route of ROUTES) expect((await denied.invoke(route)).status).toBe(403);
  });

  it("propagates unexpected durable authorization failures", async () => {
    const failure = new Error("authorization backend failed");
    const fixture = traceFixture({ authorizeError: failure });
    for (const route of ROUTES) await expect(fixture.invoke(route)).rejects.toBe(failure);
  });

  it("rejects a dangling evidenceBundleId and inactive evidence documents", async () => {
    const dangling = traceFixture({ trace: answerTrace({ evidenceBundleId: "dangling" }) });
    for (const route of ROUTES) expect((await dangling.invoke(route)).status).toBe(404);

    const inactive = traceFixture({ asset: null, trace: bundledTrace() });
    for (const route of ROUTES) expect((await inactive.invoke(route)).status).toBe(404);
  });

  it("rejects missing or hidden evidence nodes and hidden citation assets", async () => {
    const cases = [
      { nodes: [] },
      {
        nodes: [node(NODE_ID, ["private"]), node(RELATED_NODE_ID), node(MISSING_ID)],
      },
      {
        asset: { metadata: { permissionScope: ["private"] } },
        nodes: [node(NODE_ID), node(RELATED_NODE_ID), node(MISSING_ID)],
      },
    ];
    for (const options of cases) {
      const fixture = traceFixture({ ...options, trace: bundledTrace() });
      for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("returns evidence, conflict, and missing projections for a currently visible bundle", async () => {
    const fixture = traceFixture({
      nodes: [node(NODE_ID), node(RELATED_NODE_ID), node(MISSING_ID)],
      trace: bundledTrace(),
    });
    expect((await fixture.invoke(getAnswerTraceRoute)).status).toBe(200);
    expect(await fixture.invoke(listQueryEvidenceRoute)).toMatchObject({
      body: { items: [{ targetId: NODE_ID }] },
      status: 200,
    });
    expect(await fixture.invoke(listQueryConflictsRoute)).toMatchObject({
      body: { items: [{ targetId: RELATED_NODE_ID }] },
      status: 200,
    });
    expect(await fixture.invoke(listQueryMissingRoute)).toMatchObject({
      body: { items: [{ targetId: MISSING_ID }] },
      status: 200,
    });
  });

  it("maps invalid virtual cursors on all list routes", async () => {
    const fixture = traceFixture({
      nodes: [node(NODE_ID), node(RELATED_NODE_ID), node(MISSING_ID)],
      query: { cursor: "invalid", limit: 10 },
      trace: bundledTrace(),
    });
    for (const route of [listQueryEvidenceRoute, listQueryConflictsRoute, listQueryMissingRoute]) {
      expect((await fixture.invoke(route)).status).toBe(400);
    }
  });

  it("recognizes only an exact query capability binding", async () => {
    for (const capability of [
      { ...capabilityGrant(), resource: { id: TRACE_ID, parent_id: SPACE_ID, type: "job" } },
      { ...capabilityGrant(), resource: { id: "other", parent_id: SPACE_ID, type: "query" } },
      { ...capabilityGrant(), resource: { id: TRACE_ID, parent_id: "other", type: "query" } },
      { ...capabilityGrant(), namespaceId: "other" },
      { ...capabilityGrant(), subject: "other" },
    ]) {
      const fixture = traceFixture({
        capability,
        trace: answerTrace({ permissionSnapshot: undefined, subjectId: "other" }),
      });
      expect((await fixture.invoke(getAnswerTraceRoute)).status).toBe(404);
    }
  });
});

interface TraceFixtureOptions {
  readonly asset?: unknown;
  readonly authorizeError?: Error;
  readonly callerKind?: string;
  readonly capability?: unknown;
  readonly keySpaceId?: string;
  readonly nodes?: readonly unknown[];
  readonly query?: Record<string, unknown>;
  readonly space?: unknown;
  readonly trace?: AnswerTrace | null;
}

function traceFixture(options: TraceFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const trace = options.trace === undefined ? answerTrace() : options.trace;
  registerAnswerTraceHandlers({
    access: {
      revalidatePermissionSnapshot: vi.fn(async () => ({
        accessChannel: "interactive",
        apiKeyId: undefined,
        permissionScopes: [],
        revision: 1,
      })),
    } as never,
    answerTraceRepository: { getById: vi.fn(async () => trace) } as never,
    app: app as never,
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { metadata: {} } : options.asset)),
    } as never,
    authorization: {
      authorize: vi.fn(async () => {
        if (options.authorizeError) throw options.authorizeError;
        return {};
      }),
    } as never,
    nodes: { getMany: vi.fn(async () => options.nodes ?? []) } as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });
  return {
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(traceContext(options) as never);
    },
  };
}

function traceContext(options: TraceFixtureOptions) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["authorizationDecision", undefined],
    ["callerKind", options.callerKind],
    ["capabilityV2Grant", options.capability],
    ["subject", SUBJECT],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      valid: (part: string) =>
        part === "param" ? { traceId: TRACE_ID } : (options.query ?? { limit: 10 }),
    },
  };
}

function answerTrace(overrides: Partial<AnswerTrace> = {}): AnswerTrace {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    id: TRACE_ID,
    knowledgeSpaceId: SPACE_ID,
    mode: "fast",
    permissionSnapshot: { accessChannel: "interactive", id: "permission-1", revision: 1 },
    query: "What changed?",
    steps: [],
    subjectId: SUBJECT.subjectId,
    tenantId: SUBJECT.tenantId,
    ...overrides,
  };
}

function bundledTrace(): AnswerTrace {
  const bundle = EvidenceBundleSchema.parse({
    createdAt: "2026-07-14T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
    items: [
      {
        citations: [{ documentAssetId: ASSET_ID, documentVersion: 1, sectionPath: ["Roadmap"] }],
        conflicts: [{ reason: "conflict", severity: "warning", withNodeId: RELATED_NODE_ID }],
        freshness: { status: "fresh" },
        metadata: {},
        nodeId: NODE_ID,
        score: 0.9,
        scores: { final: 0.9, retrieval: 0.8 },
        text: "Evidence",
      },
    ],
    missingEvidence: [
      { expectedEvidenceId: MISSING_ID, metadata: {}, reason: "not-retrieved", text: "Missing" },
    ],
    query: "What changed?",
    state: "partial",
    traceId: TRACE_ID,
  });
  return answerTrace({
    evidenceBundleId: bundle.id,
    steps: [
      {
        metadata: { evidenceBundle: bundle },
        name: "final",
        startedAt: "2026-07-14T12:00:00.000Z",
        status: "ok",
      },
    ],
  });
}

function capabilityGrant() {
  return {
    contentScopeIds: [],
    namespaceId: SUBJECT.tenantId,
    resource: { id: TRACE_ID, parent_id: SPACE_ID, type: "query" },
    subject: SUBJECT.subjectId,
  };
}

function node(id: string, permissionScope: unknown = undefined) {
  return { documentAssetId: ASSET_ID, id, permissionScope };
}
