import { EvidenceBundleSchema } from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { PublishedProjectionReadUnavailableError } from "./published-projection-read-snapshot";
import { registerResearchTaskHandlers } from "./research-task-handlers";
import type { ResearchTaskJob } from "./research-task-job";
import {
  cancelResearchTaskRoute,
  createResearchTaskRoute,
  getResearchTaskRoute,
  listKnowledgeSpaceResearchTasksRoute,
  listResearchTaskPartialsRoute,
  planResearchTaskRoute,
  streamResearchTaskProgressRoute,
} from "./research-task-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OTHER_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e42";
const SUBJECT = {
  scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("research task handler branch coverage", () => {
  it.each([0, 1.5])("rejects invalid permission snapshot TTL %s", (permissionSnapshotTtlMs) => {
    expect(() => researchFixture({ permissionSnapshotTtlMs })).toThrow(
      "Research task permissionSnapshotTtlMs must be a positive integer",
    );
  });

  it("forbids the legacy profile fallback in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => researchFixture()).toThrow(
      "Legacy Research profile fallback is forbidden in production",
    );
  });

  it.each([
    undefined,
    capability({ action: "research_tasks.create" }),
    capability({ namespaceId: "tenant-2" }),
    capability({ subject: "user-2" }),
    capability({ resource: { id: SPACE_ID, parent_id: null, type: "research_task" } }),
    capability({ resource: { id: OTHER_SPACE_ID, parent_id: null, type: "knowledge_space" } }),
    capability({ resource: { id: SPACE_ID, parent_id: "parent", type: "knowledge_space" } }),
  ])("rejects an inexact list capability binding", async (grant) => {
    const fixture = researchFixture({ capability: grant });
    expect((await fixture.invoke(listKnowledgeSpaceResearchTasksRoute)).status).toBe(403);
  });

  it("handles missing spaces and unavailable list storage", async () => {
    const missing = researchFixture({ capability: capability(), space: null });
    expect((await missing.invoke(listKnowledgeSpaceResearchTasksRoute)).status).toBe(404);

    const unavailable = researchFixture({
      capability: capability(),
      listError: new Error("database unavailable"),
    });
    expect((await unavailable.invoke(listKnowledgeSpaceResearchTasksRoute)).status).toBe(503);
  });

  it("passes a decoded cursor and returns a next cursor", async () => {
    const fixture = researchFixture({
      capability: capability(),
      listNextCursor: { createdAt: 20, id: "next/task" },
      query: { cursor: "10|previous%2Ftask", limit: 1 },
    });
    const response = await fixture.invoke(listKnowledgeSpaceResearchTasksRoute);
    expect(response).toMatchObject({ body: { nextCursor: "20|next%2Ftask" }, status: 200 });
    expect(fixture.listBySpace).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt: 10, id: "previous/task" } }),
    );
  });

  it.each([
    capability({ action: "research_tasks.create" }),
    capability({ namespaceId: "tenant-2" }),
    capability({ subject: "user-2" }),
    capability({ resource: { id: SPACE_ID, parent_id: null, type: "research_task" } }),
    capability({ resource: { id: OTHER_SPACE_ID, parent_id: null, type: "knowledge_space" } }),
    capability({ resource: { id: SPACE_ID, parent_id: "parent", type: "knowledge_space" } }),
  ])("rejects an inexact plan capability binding", async (grant) => {
    const fixture = researchFixture({ capability: grant });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(403);
  });

  it("accepts an exact plan capability without interactive authorization", async () => {
    const fixture = researchFixture({ capability: capability({ action: "research_tasks.plan" }) });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(200);
    expect(fixture.authorize).not.toHaveBeenCalled();
  });

  it("maps expected plan authorization denial and propagates unexpected failures", async () => {
    const denied = researchFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "denied",
      ),
    });
    expect(await denied.invoke(planResearchTaskRoute)).toMatchObject({
      body: { code: "KNOWLEDGE_SPACE_ACCESS_DENIED", error: "denied" },
      status: 403,
    });

    const failure = new Error("authorization unavailable");
    await expect(
      researchFixture({ authorizeError: failure }).invoke(planResearchTaskRoute),
    ).rejects.toBe(failure);
  });

  it.each([
    [new Error("invalid plan"), "invalid plan"],
    ["invalid plan", "Invalid research task plan request"],
  ] as const)("maps invalid plan failures", async (planError, message) => {
    const fixture = researchFixture({ planError });
    expect(await fixture.invoke(planResearchTaskRoute)).toMatchObject({
      body: { error: message },
      status: 400,
    });
  });

  it("requires Capability v2 when compatibility admission is disabled", async () => {
    const fixture = researchFixture({ allowLegacyPermissionSnapshotAdmission: false });
    expect(await fixture.invoke(createResearchTaskRoute)).toMatchObject({
      body: { error: "Capability v2 is required for Research admission" },
      status: 403,
    });
  });

  it.each([
    [new Error("invalid create"), "invalid create"],
    ["invalid create", "Invalid research task request"],
  ] as const)("maps invalid create failures", async (planError, message) => {
    const fixture = researchFixture({ capability: capability(), planError });
    expect(await fixture.invoke(createResearchTaskRoute)).toMatchObject({
      body: { error: message },
      status: 400,
    });
  });

  it("maps create authorization denial", async () => {
    const fixture = researchFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "create denied",
      ),
    });
    expect(await fixture.invoke(createResearchTaskRoute)).toMatchObject({
      body: { code: "KNOWLEDGE_SPACE_ACCESS_DENIED", error: "create denied" },
      status: 403,
    });
  });

  it("persists every optional auto-mode decision field", async () => {
    const fixture = researchFixture({
      autoResolution: {
        finishReason: "stop",
        generationModel: "reason-v5",
        mode: "fast",
        promptVersion: "auto-retrieval-mode-router-v1",
        provider: "provider-a",
        reasonCode: "direct_lookup",
        usage: { completionTokens: 2, promptTokens: 3, totalTokens: 5 },
      },
      body: { knowledgeSpaceId: SPACE_ID, metadata: {}, mode: "auto", query: "status" },
      capability: capability({ action: "research_tasks.create" }),
      runtimeSnapshot: publishedRuntimeSnapshot(),
    });
    const response = await fixture.invoke(createResearchTaskRoute);
    expect(response.status).toBe(201);
    expect(fixture.start).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId: "grant-1",
        metadata: expect.objectContaining({
          __knowledgeFsAutoRetrievalModeDecision: expect.objectContaining({
            finishReason: "stop",
            generationModel: "reason-v5",
            provider: "provider-a",
            reasonCode: "direct_lookup",
            usage: { completionTokens: 2, promptTokens: 3, totalTokens: 5 },
          }),
        }),
      }),
    );
  });

  it("persists a degraded auto-mode fallback with only its error metadata", async () => {
    const fixture = researchFixture({
      autoError: new Error("router unavailable"),
      body: { knowledgeSpaceId: SPACE_ID, metadata: {}, mode: "auto", query: "status" },
      capability: capability({ action: "research_tasks.create" }),
      runtimeSnapshot: publishedRuntimeSnapshot(),
    });
    const response = await fixture.invoke(createResearchTaskRoute);
    expect(response.status).toBe(201);
    expect(fixture.start).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          __knowledgeFsAutoRetrievalModeDecision: expect.objectContaining({
            degraded: true,
            errorClass: "Error",
            resolver: "fallback",
          }),
        }),
        mode: "deep",
      }),
    );
  });

  it.each([
    capability({ action: "research_tasks.read" }),
    capability({
      action: "research_tasks.read",
      resource: { id: JOB_ID, parent_id: SPACE_ID, type: "query" },
    }),
    capability({
      action: "research_tasks.read",
      resource: { id: "other-job", parent_id: SPACE_ID, type: "research_task" },
    }),
    capability({
      action: "research_tasks.read",
      resource: { id: JOB_ID, parent_id: OTHER_SPACE_ID, type: "research_task" },
    }),
    capability({ action: "research_tasks.read", namespaceId: "tenant-2" }),
    capability({ action: "research_tasks.read", subject: "user-2" }),
  ])("falls back to durable authorization for each inexact job capability", async (grant) => {
    const fixture = researchFixture({ capability: grant });
    expect((await fixture.invoke(getResearchTaskRoute)).status).toBe(200);
    expect(fixture.revalidatePermissionSnapshot).toHaveBeenCalledOnce();
  });

  it("uses an exact job capability without durable revalidation", async () => {
    const fixture = researchFixture({ capability: jobCapability() });
    expect((await fixture.invoke(getResearchTaskRoute)).status).toBe(200);
    expect(fixture.revalidatePermissionSnapshot).not.toHaveBeenCalled();
  });

  it("maps a foreign durable owner and current authorization denial", async () => {
    const foreign = researchFixture({ job: researchJob({ subjectId: "user-2" }) });
    expect(await foreign.invoke(getResearchTaskRoute)).toMatchObject({
      body: { code: "KNOWLEDGE_SPACE_ACCESS_DENIED" },
      status: 403,
    });

    const denied = researchFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "revoked",
      ),
    });
    expect(await denied.invoke(getResearchTaskRoute)).toMatchObject({
      body: { code: "KNOWLEDGE_SPACE_ACCESS_DENIED", error: "revoked" },
      status: 403,
    });
  });

  it("propagates an unexpected derived-result authorization failure", async () => {
    const failure = new Error("authorization storage unavailable");
    await expect(
      researchFixture({ revalidateError: failure }).invoke(getResearchTaskRoute),
    ).rejects.toBe(failure);
  });

  it("hides missing, cross-tenant, and deletion-uncertain jobs", async () => {
    for (const options of [
      { job: null },
      { job: researchJob({ tenantId: "tenant-2" }) },
      { visibilityResults: [new Error("deletion database unavailable")] },
    ] satisfies readonly ResearchFixtureOptions[]) {
      expect((await researchFixture(options).invoke(getResearchTaskRoute)).status).toBe(404);
    }
  });

  it("rechecks deletion visibility before returning a job", async () => {
    const fixture = researchFixture({ visibilityResults: [true, false] });
    expect((await fixture.invoke(getResearchTaskRoute)).status).toBe(404);
  });

  it("filters inactive partial evidence, preserves active items, and returns the cursor", async () => {
    const partials = [partialResult("active", []), partialResult("inactive", [ASSET_ID])];
    const fixture = researchFixture({
      asset: null,
      partialItems: partials,
      partialNextCursor: "2",
      query: { cursor: "1", limit: 10 },
    });
    const response = await fixture.invoke(listResearchTaskPartialsRoute);
    expect(response).toMatchObject({
      body: { items: [expect.objectContaining({ sequence: 1 })], nextCursor: "2" },
      status: 200,
    });
    expect(fixture.listPartials).toHaveBeenCalledWith(expect.objectContaining({ cursor: "1" }));
  });

  it("rechecks deletion visibility after loading partials", async () => {
    const fixture = researchFixture({ visibilityResults: [true, false] });
    expect((await fixture.invoke(listResearchTaskPartialsRoute)).status).toBe(404);
  });

  it.each([
    { directStream: false },
    { capabilityGrants: false },
    { capability: jobCapability({ action: "research_tasks.read" }) },
    {
      capability: jobCapability({
        resource: { id: JOB_ID, parent_id: SPACE_ID, type: "query" },
      }),
    },
    {
      capability: jobCapability({
        resource: { id: "other-job", parent_id: SPACE_ID, type: "research_task" },
      }),
    },
    { query: { knowledgeSpaceId: OTHER_SPACE_ID, limit: 10 } },
  ] satisfies readonly ResearchFixtureOptions[])(
    "rejects an incomplete direct-stream capability binding",
    async (options) => {
      const fixture = researchFixture({ capability: jobCapability(), ...options });
      expect((await fixture.invoke(streamResearchTaskProgressRoute)).status).toBe(403);
    },
  );

  it("rejects a cross-space API key on status, partial, stream, and cancel routes", async () => {
    const fixture = researchFixture({ callerKind: "api_key", keySpaceId: OTHER_SPACE_ID });
    for (const route of [
      getResearchTaskRoute,
      listResearchTaskPartialsRoute,
      streamResearchTaskProgressRoute,
      cancelResearchTaskRoute,
    ]) {
      expect((await fixture.invoke(route)).status).toBe(403);
    }
  });

  it("rechecks deletion visibility before canceling and maps cancellation conflicts", async () => {
    const hidden = researchFixture({ visibilityResults: [true, false] });
    expect((await hidden.invoke(cancelResearchTaskRoute)).status).toBe(404);

    const conflict = researchFixture({ cancelError: new Error("already terminal") });
    expect((await conflict.invoke(cancelResearchTaskRoute)).status).toBe(409);
  });

  it.each([
    new Error("snapshot read failed"),
    new PublishedProjectionReadUnavailableError({
      knowledgeSpaceId: SPACE_ID,
      tenantId: SUBJECT.tenantId,
    }),
  ])("fails closed when resolving a runtime snapshot fails", async (runtimeResolveError) => {
    const fixture = researchFixture({
      runtimeResolveError,
      runtimeSnapshot: publishedRuntimeSnapshot(),
    });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(503);
  });

  it.each([
    {},
    publishedRuntimeSnapshot({ knowledgeSpaceId: OTHER_SPACE_ID }),
    publishedRuntimeSnapshot({ tenantId: "tenant-2" }),
  ])("fails closed for a malformed or mismatched runtime snapshot", async (runtimeSnapshot) => {
    const fixture = researchFixture({ runtimeSnapshot });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(503);
  });

  it.each([
    new Error("readiness failed"),
    new PublishedProjectionReadUnavailableError({
      knowledgeSpaceId: SPACE_ID,
      tenantId: SUBJECT.tenantId,
    }),
  ])("fails closed when runtime readiness fails", async (runtimeAssertError) => {
    const fixture = researchFixture({
      runtimeAssertError,
      runtimeSnapshot: publishedRuntimeSnapshot(),
    });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(503);
  });

  it("requires an embedding profile for an ordinary retrieval mode", async () => {
    const snapshot = publishedRuntimeSnapshot();
    const fixture = researchFixture({
      body: { knowledgeSpaceId: SPACE_ID, mode: "fast", query: "status" },
      runtimeSnapshot: {
        ...snapshot,
        embeddingCapabilitySnapshot: undefined,
        embeddingProfile: undefined,
      },
    });
    expect((await fixture.invoke(planResearchTaskRoute)).status).toBe(503);
  });
});

interface ResearchFixtureOptions {
  readonly allowLegacyPermissionSnapshotAdmission?: boolean;
  readonly asset?: unknown;
  readonly authorizeError?: unknown;
  readonly autoError?: unknown;
  readonly autoResolution?: Record<string, unknown>;
  readonly body?: Record<string, unknown>;
  readonly callerKind?: "agent" | "api_key" | "interactive" | "mcp";
  readonly cancelError?: unknown;
  readonly capability?: DifyCapabilityV2SanitizedGrant | undefined;
  readonly capabilityGrants?: boolean;
  readonly directStream?: boolean;
  readonly job?: ResearchTaskJob | null;
  readonly keySpaceId?: string;
  readonly listError?: unknown;
  readonly listNextCursor?: { readonly createdAt: number; readonly id: string };
  readonly partialItems?: readonly unknown[];
  readonly partialNextCursor?: string;
  readonly permissionSnapshotTtlMs?: number;
  readonly planError?: unknown;
  readonly query?: Record<string, unknown>;
  readonly revalidateError?: unknown;
  readonly runtimeAssertError?: unknown;
  readonly runtimeResolveError?: unknown;
  readonly runtimeSnapshot?: unknown;
  readonly space?: { readonly id: string } | null;
  readonly visibilityResults?: readonly (boolean | Error)[];
}

function researchFixture(options: ResearchFixtureOptions = {}) {
  const callbacks = new Map<unknown, (context: never) => Promise<HandlerResponse>>();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<HandlerResponse>) => {
      callbacks.set(route, callback);
    }),
  };
  const authorize = vi.fn(async () => {
    if (options.authorizeError !== undefined) throw options.authorizeError;
    return {};
  });
  const revalidatePermissionSnapshot = vi.fn(async () => {
    if (options.revalidateError !== undefined) throw options.revalidateError;
    return permissionSnapshot();
  });
  const listBySpace = vi.fn(async () => {
    if (options.listError !== undefined) throw options.listError;
    return {
      items: [researchJob()],
      ...(options.listNextCursor ? { nextCursor: options.listNextCursor } : {}),
    };
  });
  const start = vi.fn(async (input: Record<string, unknown>) =>
    researchJob({ ...(input as Partial<ResearchTaskJob>), id: JOB_ID }),
  );
  const listPartials = vi.fn(async () => ({
    items: options.partialItems ?? [],
    ...(options.partialNextCursor ? { nextCursor: options.partialNextCursor } : {}),
  }));
  let visibilityIndex = 0;
  const visibility = options.visibilityResults
    ? {
        isSpaceReadable: vi.fn(async () => {
          const result = options.visibilityResults?.[visibilityIndex++] ?? true;
          if (result instanceof Error) throw result;
          return result;
        }),
      }
    : undefined;
  const runtimeSnapshotResolver =
    options.runtimeSnapshot === undefined
      ? undefined
      : {
          assertReady: vi.fn(async () => {
            if (options.runtimeAssertError !== undefined) throw options.runtimeAssertError;
          }),
          resolve: vi.fn(async () => {
            if (options.runtimeResolveError !== undefined) throw options.runtimeResolveError;
            return options.runtimeSnapshot;
          }),
        };
  registerResearchTaskHandlers({
    access: {
      createPermissionSnapshot: vi.fn(async () => permissionSnapshot()),
      revalidatePermissionSnapshot,
    } as never,
    allowLegacyPermissionSnapshotAdmission: options.allowLegacyPermissionSnapshotAdmission ?? true,
    allowLegacyProfileFallback: runtimeSnapshotResolver === undefined,
    app: app as never,
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { id: ASSET_ID } : options.asset)),
    } as never,
    authorization: { authorize } as never,
    autoRetrievalModeResolver:
      options.autoResolution || options.autoError
        ? ({
            resolve: vi.fn(async () => {
              if (options.autoError !== undefined) throw options.autoError;
              return options.autoResolution;
            }),
          } as never)
        : undefined,
    capabilityGrants:
      options.capabilityGrants === false
        ? undefined
        : { assertPublicationAllowed: vi.fn(async () => undefined) },
    deletionVisibility: visibility as never,
    directStream:
      options.directStream === false ? undefined : { allowedOrigins: [], maxConnectionMs: 10 },
    dryRunResearchPlanner: {
      plan: vi.fn((input: Record<string, unknown>) => {
        if (options.planError !== undefined) throw options.planError;
        return researchPlan(input);
      }),
    } as never,
    ...(options.permissionSnapshotTtlMs === undefined
      ? {}
      : { permissionSnapshotTtlMs: options.permissionSnapshotTtlMs }),
    researchTaskJobs: {
      cancel: vi.fn(async () => {
        if (options.cancelError !== undefined) throw options.cancelError;
        return researchJob({ stage: "canceled" });
      }),
      get: vi.fn(async () => (options.job === undefined ? researchJob() : options.job)),
      listBySpace,
      start,
    } as never,
    researchTaskPartialResults: { list: listPartials } as never,
    researchTaskProgressEvents: {} as never,
    runtimeSnapshotResolver: runtimeSnapshotResolver as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });

  return {
    authorize,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(researchContext(options, route) as never);
    },
    listBySpace,
    listPartials,
    revalidatePermissionSnapshot,
    start,
  };
}

interface HandlerResponse {
  readonly body: unknown;
  readonly status: number;
}

function researchContext(options: ResearchFixtureOptions, route: unknown) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", undefined],
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["callerKind", options.callerKind],
    ["capabilityV2Grant", options.capability],
    ["subject", SUBJECT],
    ["traceId", undefined],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      header: (_name: string) => undefined,
      valid: (part: string) => {
        if (part === "param") {
          return route === listKnowledgeSpaceResearchTasksRoute ? { id: SPACE_ID } : { id: JOB_ID };
        }
        if (part === "json") {
          return options.body ?? { knowledgeSpaceId: SPACE_ID, mode: "research", query: "status" };
        }
        return (
          options.query ?? {
            ...(route === streamResearchTaskProgressRoute ? { knowledgeSpaceId: SPACE_ID } : {}),
            limit: 10,
          }
        );
      },
    },
  };
}

function capability(
  overrides: Partial<DifyCapabilityV2SanitizedGrant> = {},
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "research_tasks.list",
    callerKind: "interactive",
    grantId: "grant-1",
    namespaceId: SUBJECT.tenantId,
    resource: { id: SPACE_ID, parent_id: null, type: "knowledge_space" },
    subject: SUBJECT.subjectId,
    ...overrides,
  } as DifyCapabilityV2SanitizedGrant;
}

function jobCapability(
  overrides: Partial<DifyCapabilityV2SanitizedGrant> = {},
): DifyCapabilityV2SanitizedGrant {
  return capability({
    action: "research_tasks.stream",
    resource: { id: JOB_ID, parent_id: SPACE_ID, type: "research_task" },
    ...overrides,
  });
}

function researchJob(overrides: Partial<ResearchTaskJob> = {}): ResearchTaskJob {
  return {
    cost: { entries: [], totalUsd: 0 },
    createdAt: 1,
    executionAttempts: 0,
    id: JOB_ID,
    knowledgeSpaceId: SPACE_ID,
    maxExecutionAttempts: 3,
    metadata: {},
    permissionSnapshot: { accessChannel: "interactive", id: "snapshot-1", revision: 1 },
    query: "status",
    rowVersion: 1,
    stage: "queued",
    subjectId: SUBJECT.subjectId,
    tenantId: SUBJECT.tenantId,
    updatedAt: 1,
    ...overrides,
  };
}

function permissionSnapshot() {
  return {
    accessChannel: "interactive",
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    expiresAt: "2026-07-21T01:00:00.000Z",
    id: "snapshot-1",
    knowledgeSpaceId: SPACE_ID,
    memberRevision: 1,
    permissionScopes: [],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: SUBJECT.subjectId,
    tenantId: SUBJECT.tenantId,
    updatedAt: "2026-07-21T00:00:00.000Z",
    visibility: "only_me",
  } as const;
}

function researchPlan(input: Record<string, unknown>) {
  const requestedMode = (input.mode as string | undefined) ?? "research";
  const resolvedMode =
    (input.resolvedMode as string | undefined) ??
    (requestedMode === "auto" ? "research" : requestedMode);
  return {
    budget: { exceedsBudget: false },
    estimates: {
      latencyMs: { p50: 1, p95: 2 },
      retrievalSteps: 1,
      scannedResources: 1,
      toolCalls: 1,
    },
    knowledgeSpaceId: input.knowledgeSpaceId,
    query: input.query,
    retrievalPlan: { requestedMode, resolvedMode, topK: input.topK ?? 10 },
    steps: [],
    strategyVersion: "research-dry-run-planner-v1",
  };
}

function partialResult(label: string, documentAssetIds: readonly string[]) {
  const suffix = label === "active" ? "1" : "2";
  const evidenceBundle = EvidenceBundleSchema.parse({
    createdAt: "2026-07-21T00:00:00.000Z",
    id: `018f0d60-7a49-7cc2-9c1b-5b36f18f2f0${suffix}`,
    items: documentAssetIds.map((documentAssetId) => ({
      citations: [{ documentAssetId, documentVersion: 1, sectionPath: [] }],
      conflicts: [],
      freshness: { status: "fresh" },
      metadata: {},
      nodeId: `018f0d60-7a49-7cc2-9c1b-5b36f18f2f1${suffix}`,
      score: 1,
      scores: { final: 1, retrieval: 1 },
      text: label,
    })),
    missingEvidence: [],
    query: "status",
    state: "partial",
    traceId: `018f0d60-7a49-7cc2-9c1b-5b36f18f2f2${suffix}`,
  });
  return {
    evidenceBundle,
    knowledgeSpaceId: SPACE_ID,
    researchTaskJobId: JOB_ID,
    sequence: label === "active" ? 1 : 2,
    tenantId: SUBJECT.tenantId,
  };
}

function publishedRuntimeSnapshot(
  projectionOverrides: { readonly knowledgeSpaceId?: string; readonly tenantId?: string } = {},
) {
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
      knowledgeSpaceId: projectionOverrides.knowledgeSpaceId ?? SPACE_ID,
      projectionVersion: 8,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
      tenantId: projectionOverrides.tenantId ?? SUBJECT.tenantId,
    },
    retrievalCapabilitySnapshot: {
      reasoning: { pluginUniqueIdentifier: "reasoning-install-v5" },
    },
    retrievalProfile: {
      defaultMode: "deep",
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
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.42 },
      topK: 37,
    },
  };
}
