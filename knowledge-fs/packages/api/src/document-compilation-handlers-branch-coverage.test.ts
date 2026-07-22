import { describe, expect, it, vi } from "vitest";

import { registerDocumentCompilationHandlers } from "./document-compilation-handlers";
import type { DocumentCompilationJob } from "./document-compilation-job";
import {
  cancelDocumentCompilationJobRoute,
  getDocumentCompilationJobRoute,
  retryDocumentCompilationJobRoute,
} from "./document-compilation-routes";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

const JOB_ID = "document-compilation-job-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const ROUTES = [
  getDocumentCompilationJobRoute,
  cancelDocumentCompilationJobRoute,
  retryDocumentCompilationJobRoute,
] as const;

describe("document-compilation handler branch coverage", () => {
  it("reports unavailable, missing, and cross-tenant jobs on every route", async () => {
    for (const options of [
      { jobsAvailable: false },
      { job: null },
      { job: compilationJob({ tenantId: "another-tenant" }) },
    ] as const) {
      const fixture = compilationFixture(options);
      for (const route of ROUTES) {
        expect((await fixture.invoke(route)).status).toBe(
          options.jobsAvailable === false ? 503 : 404,
        );
      }
    }
  });

  it("rejects a mismatched API-key space on every route", async () => {
    const fixture = compilationFixture({ callerKind: "api_key", keySpaceId: "another-space" });
    for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(403);
  });

  it("requires exact legacy requester provenance and a durable snapshot", async () => {
    for (const job of [
      compilationJob({ requestedBySubjectId: "another-owner" }),
      compilationJobWithoutPermissionSnapshot(),
    ]) {
      const fixture = compilationFixture({ job });
      for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("fails closed on durable permission or current authorization denial", async () => {
    for (const options of [
      {
        revalidateError: new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ACCESS_DENIED",
          "denied",
        ),
      },
      {
        authorizeError: new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ACCESS_DENIED",
          "denied",
        ),
      },
    ]) {
      const fixture = compilationFixture(options);
      for (const route of ROUTES) {
        expect((await fixture.invoke(route)).status).toBe(options.revalidateError ? 404 : 403);
      }
    }
  });

  it("propagates unexpected durable and current authorization failures", async () => {
    for (const options of [
      { revalidateError: new Error("revalidation failed") },
      { authorizeError: new Error("authorization failed") },
    ]) {
      const fixture = compilationFixture(options);
      for (const route of ROUTES) {
        await expect(fixture.invoke(route)).rejects.toBe(
          options.revalidateError ?? options.authorizeError,
        );
      }
    }
  });

  it("fails closed when the referenced asset is missing or outside current grants", async () => {
    for (const asset of [null, { metadata: { permissionScope: ["private"] } }]) {
      const fixture = compilationFixture({ asset });
      for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("returns a public status response through legacy authorization", async () => {
    const fixture = compilationFixture();
    const response = await fixture.invoke(getDocumentCompilationJobRoute);
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("permissionSnapshot");
    expect(response.body).not.toHaveProperty("requestedBySubjectId");
    expect(response.body).not.toHaveProperty("capabilityGrantId");
    expect(fixture.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ requiredAccess: "read" }),
    );
  });

  it("uses a middleware decision when no authorization guard is configured", async () => {
    const fixture = compilationFixture({ authorization: false });
    expect((await fixture.invoke(getDocumentCompilationJobRoute)).status).toBe(200);
  });

  it("recognizes only an exact child-job capability binding", async () => {
    const exact = compilationFixture({ capability: capabilityGrant() });
    for (const route of ROUTES) expect((await exact.invoke(route)).status).toBe(200);
    expect(exact.revalidatePermissionSnapshot).not.toHaveBeenCalled();

    for (const capability of [
      { ...capabilityGrant(), resource: { id: JOB_ID, parent_id: SPACE_ID, type: "query" } },
      { ...capabilityGrant(), resource: { id: "other", parent_id: SPACE_ID, type: "job" } },
      { ...capabilityGrant(), resource: { id: JOB_ID, parent_id: "other", type: "job" } },
      { ...capabilityGrant(), namespaceId: "another-tenant" },
      { ...capabilityGrant(), subject: "another-owner" },
    ]) {
      const fixture = compilationFixture({
        capability,
        job: compilationJobWithoutPermissionSnapshot({ requestedBySubjectId: "other" }),
      });
      for (const route of ROUTES) expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("maps legacy control-snapshot denial and supports successful cancel and retry", async () => {
    for (const options of [
      { createSnapshotRole: "viewer" },
      { createError: new KnowledgeSpaceAccessError("space_access_forbidden", "denied") },
    ] as const) {
      const fixture = compilationFixture(options);
      expect((await fixture.invoke(cancelDocumentCompilationJobRoute)).status).toBe(403);
      expect((await fixture.invoke(retryDocumentCompilationJobRoute)).status).toBe(403);
    }

    const fixture = compilationFixture();
    expect((await fixture.invoke(cancelDocumentCompilationJobRoute)).status).toBe(200);
    expect((await fixture.invoke(retryDocumentCompilationJobRoute)).status).toBe(200);
    expect(fixture.cancel).toHaveBeenCalledWith(
      JOB_ID,
      "Canceled by request",
      expect.objectContaining({ requestedBySubjectId: SUBJECT.subjectId }),
    );
    expect(fixture.retry).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ requestedBySubjectId: SUBJECT.subjectId }),
    );
  });

  it("propagates unexpected fresh-snapshot failures", async () => {
    const failure = new Error("snapshot backend failed");
    const fixture = compilationFixture({ createError: failure });
    await expect(fixture.invoke(cancelDocumentCompilationJobRoute)).rejects.toBe(failure);
    await expect(fixture.invoke(retryDocumentCompilationJobRoute)).rejects.toBe(failure);
  });

  it("maps state-machine conflicts and an unavailable retry operation", async () => {
    expect(
      (
        await compilationFixture({ cancelError: new Error("terminal") }).invoke(
          cancelDocumentCompilationJobRoute,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await compilationFixture({ retryError: new Error("terminal") }).invoke(
          retryDocumentCompilationJobRoute,
        )
      ).status,
    ).toBe(409);
    expect(
      (await compilationFixture({ retryAvailable: false }).invoke(retryDocumentCompilationJobRoute))
        .status,
    ).toBe(409);
  });
});

interface CompilationFixtureOptions {
  readonly asset?: unknown;
  readonly authorization?: boolean;
  readonly authorizeError?: Error;
  readonly callerKind?: string;
  readonly cancelError?: Error;
  readonly capability?: unknown;
  readonly createError?: Error;
  readonly createSnapshotRole?: "editor" | "viewer";
  readonly job?: DocumentCompilationJob | null;
  readonly jobsAvailable?: boolean;
  readonly keySpaceId?: string;
  readonly revalidateError?: Error;
  readonly retryAvailable?: boolean;
  readonly retryError?: Error;
}

function compilationFixture(options: CompilationFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const job = options.job === undefined ? compilationJob() : options.job;
  const revalidatePermissionSnapshot = vi.fn(async () => {
    if (options.revalidateError) throw options.revalidateError;
    return permissionSnapshot("editor");
  });
  const createPermissionSnapshot = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return permissionSnapshot(options.createSnapshotRole ?? "editor");
  });
  const authorize = vi.fn(async () => {
    if (options.authorizeError) throw options.authorizeError;
    return {};
  });
  const cancel = vi.fn(async () => {
    if (options.cancelError) throw options.cancelError;
    return compilationJob({ stage: "canceled" });
  });
  const retry = vi.fn(async () => {
    if (options.retryError) throw options.retryError;
    return compilationJob({ stage: "queued" });
  });
  const documentCompilationJobs =
    options.jobsAvailable === false
      ? undefined
      : {
          advance: vi.fn(),
          cancel,
          fail: vi.fn(),
          get: vi.fn(async () => job),
          getMany: vi.fn(),
          ...(options.retryAvailable === false ? {} : { retry }),
          start: vi.fn(),
        };
  registerDocumentCompilationHandlers({
    access: { createPermissionSnapshot, revalidatePermissionSnapshot } as never,
    app: app as never,
    assets: {
      get: vi.fn(async () =>
        options.asset === undefined ? { metadata: { permissionScope: [] } } : options.asset,
      ),
    } as never,
    ...(options.authorization === false ? {} : { authorization: { authorize } as never }),
    documentCompilationJobs: documentCompilationJobs as never,
  });
  return {
    authorize,
    cancel,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(compilationContext(options) as never);
    },
    retry,
    revalidatePermissionSnapshot,
  };
}

function compilationContext(options: CompilationFixtureOptions) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", undefined],
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["authorizationDecision", {}],
    ["callerKind", options.callerKind],
    ["capabilityV2Grant", options.capability],
    ["subject", SUBJECT],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: { valid: () => ({ id: JOB_ID }) },
  };
}

function compilationJob(overrides: Partial<DocumentCompilationJob> = {}): DocumentCompilationJob {
  return {
    createdAt: 1,
    documentAssetId: ASSET_ID,
    id: JOB_ID,
    knowledgeSpaceId: SPACE_ID,
    permissionSnapshot: { accessChannel: "interactive", id: "permission-1", revision: 1 },
    requestedBySubjectId: SUBJECT.subjectId,
    stage: "queued",
    tenantId: SUBJECT.tenantId,
    updatedAt: 1,
    version: 1,
    ...overrides,
  };
}

function compilationJobWithoutPermissionSnapshot(
  overrides: Partial<DocumentCompilationJob> = {},
): DocumentCompilationJob {
  const { permissionSnapshot: _permissionSnapshot, ...job } = compilationJob(overrides);
  return job;
}

function permissionSnapshot(role: "editor" | "viewer") {
  return {
    accessChannel: "interactive",
    apiAccessRevision: 1,
    apiKeyId: undefined,
    accessPolicyRevision: 1,
    createdAt: "2026-07-21T12:00:00.000Z",
    expiresAt: "2026-07-21T13:00:00.000Z",
    id: "permission-1",
    knowledgeSpaceId: SPACE_ID,
    memberRevision: 1,
    permissionScopes: [],
    revision: 1,
    role,
    status: "active",
    subjectId: SUBJECT.subjectId,
    tenantId: SUBJECT.tenantId,
    updatedAt: "2026-07-21T12:00:00.000Z",
    visibility: "private",
  };
}

function capabilityGrant() {
  return {
    contentScopeIds: [],
    grantId: "grant-1",
    namespaceId: SUBJECT.tenantId,
    resource: { id: JOB_ID, parent_id: SPACE_ID, type: "job" },
    subject: SUBJECT.subjectId,
  };
}
