import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  registerKnowledgeSpaceAccessHandlers,
  toApiKeyResponse,
} from "./knowledge-space-access-handlers";
import {
  addKnowledgeSpaceMemberRoute,
  bootstrapKnowledgeSpaceAccessRoute,
  deleteKnowledgeSpaceMemberRoute,
  getKnowledgeSpaceAccessPolicyRoute,
  getKnowledgeSpaceApiAccessRoute,
  issueKnowledgeSpaceApiKeyRoute,
  listKnowledgeSpaceApiKeysRoute,
  listKnowledgeSpaceMembersRoute,
  revokeKnowledgeSpaceApiKeyRoute,
  updateKnowledgeSpaceAccessPolicyRoute,
  updateKnowledgeSpaceApiAccessRoute,
  updateKnowledgeSpaceMemberRoute,
} from "./knowledge-space-access-routes";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SUBJECT = {
  scopes: ["knowledge-spaces:admin"],
  subjectId: "owner-1",
  tenantId: "tenant-1",
};

describe("knowledge-space access handler branch coverage", () => {
  it("enforces bootstrap admin scope and an existing tenant space", async () => {
    await expect(
      accessFixture({ subject: { ...SUBJECT, scopes: [] } }).invoke(
        bootstrapKnowledgeSpaceAccessRoute,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      accessFixture({ space: null }).invoke(bootstrapKnowledgeSpaceAccessRoute),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("bootstraps access state and detects missing post-initialize state", async () => {
    expect((await accessFixture().invoke(bootstrapKnowledgeSpaceAccessRoute)).status).toBe(201);
    await expect(
      accessFixture({ bootstrapStateMissing: true }).invoke(bootstrapKnowledgeSpaceAccessRoute),
    ).rejects.toThrow("did not persist");
  });

  it("maps absent policy and API-access state", async () => {
    await expect(
      accessFixture({ policy: null }).invoke(getKnowledgeSpaceAccessPolicyRoute),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      accessFixture({ apiAccess: null }).invoke(getKnowledgeSpaceApiAccessRoute),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("forwards optional list cursors and returns optional next cursors", async () => {
    const fixture = accessFixture({ listCursor: "next", queryCursor: "cursor" });
    expect((await fixture.invoke(listKnowledgeSpaceMembersRoute)).body).toMatchObject({
      nextCursor: "next",
    });
    expect((await fixture.invoke(listKnowledgeSpaceApiKeysRoute)).body).toMatchObject({
      nextCursor: "next",
    });
    expect(fixture.listMembers).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor" }));
    expect(fixture.listApiKeys).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor" }));
  });

  it("returns not found when member removal loses its target", async () => {
    const response = await accessFixture({ removed: false }).invoke(
      deleteKnowledgeSpaceMemberRoute,
    );
    expect(response.status).toBe(404);
  });

  it("executes every successful mutation response", async () => {
    const fixture = accessFixture({ bodyExpiresAt: "2026-07-22T12:00:00.000Z" });
    for (const route of [
      updateKnowledgeSpaceAccessPolicyRoute,
      addKnowledgeSpaceMemberRoute,
      updateKnowledgeSpaceMemberRoute,
      deleteKnowledgeSpaceMemberRoute,
      updateKnowledgeSpaceApiAccessRoute,
      issueKnowledgeSpaceApiKeyRoute,
      revokeKnowledgeSpaceApiKeyRoute,
    ]) {
      expect((await fixture.invoke(route)).status).toBeLessThan(300);
    }
    expect(fixture.issueApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: "2026-07-22T12:00:00.000Z" }),
    );
  });

  it("omits an absent API-key expiration from issuance", async () => {
    const fixture = accessFixture();
    expect((await fixture.invoke(issueKnowledgeSpaceApiKeyRoute)).status).toBe(201);
    expect(fixture.issueApiKey).toHaveBeenCalledWith(
      expect.not.objectContaining({ expiresAt: expect.anything() }),
    );
  });

  it("serializes every optional API-key timestamp only when present", () => {
    const complete = apiKey({
      expiresAt: "2026-07-22T12:00:00.000Z",
      lastUsedAt: "2026-07-21T12:30:00.000Z",
      revokedAt: "2026-07-21T13:00:00.000Z",
    });
    expect(toApiKeyResponse(complete as never)).toMatchObject({
      expiresAt: "2026-07-22T12:00:00.000Z",
      lastUsedAt: "2026-07-21T12:30:00.000Z",
      revokedAt: "2026-07-21T13:00:00.000Z",
    });
    expect(toApiKeyResponse(apiKey() as never)).not.toHaveProperty("expiresAt");
  });

  it.each([
    [new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ACCESS_DENIED", "denied"), 403],
    [new KnowledgeSpaceAccessError("space_access_invalid_request", "invalid"), 400],
    [new KnowledgeSpaceAccessError("space_access_not_found", "missing"), 404],
    [new KnowledgeSpaceAccessError("space_access_forbidden", "forbidden"), 403],
    [new KnowledgeSpaceAccessError("space_access_capacity_exceeded", "full"), 429],
    [new KnowledgeSpaceAccessError("space_access_already_initialized", "exists"), 409],
    [new KnowledgeSpaceAccessError("space_access_last_owner", "last owner"), 409],
    [new KnowledgeSpaceAccessError("space_access_partial_member_not_found", "missing"), 409],
    [new KnowledgeSpaceAccessError("space_access_partial_members_required", "required"), 409],
    [new KnowledgeSpaceAccessError("space_access_policy_owner", "owner"), 409],
    [new KnowledgeSpaceAccessError("space_access_revision_conflict", "conflict"), 409],
    [new KnowledgeSpaceAccessError("space_access_permission_snapshot_invalid", "invalid"), 403],
  ] as const)("maps domain failure %# to HTTP status", async (failure, status) => {
    await expect(
      accessFixture({ authorizationError: failure }).invoke(getKnowledgeSpaceAccessPolicyRoute),
    ).rejects.toMatchObject({ status });
  });

  it("rethrows an unexpected access-layer failure unchanged", async () => {
    const failure = new Error("database unavailable");
    await expect(
      accessFixture({ authorizationError: failure }).invoke(getKnowledgeSpaceAccessPolicyRoute),
    ).rejects.toBe(failure);
  });

  it("exposes the mapped HTTP response body", async () => {
    const failure = new KnowledgeSpaceAccessError("space_access_invalid_request", "invalid input");
    try {
      await accessFixture({ authorizationError: failure }).invoke(
        getKnowledgeSpaceAccessPolicyRoute,
      );
      throw new Error("expected mapped failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      const response = (error as HTTPException).getResponse();
      await expect(response.json()).resolves.toEqual({
        code: "space_access_invalid_request",
        error: "invalid input",
      });
    }
  });
});

interface AccessFixtureOptions {
  readonly apiAccess?: unknown;
  readonly authorizationError?: Error;
  readonly bodyExpiresAt?: string;
  readonly bootstrapStateMissing?: boolean;
  readonly listCursor?: string;
  readonly policy?: unknown;
  readonly queryCursor?: string;
  readonly removed?: boolean;
  readonly space?: unknown;
  readonly subject?: typeof SUBJECT;
}

function accessFixture(options: AccessFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const state = {
    partialMemberSubjectIds: [],
    policy: {
      id: "policy-1",
      ownerSubjectId: SUBJECT.subjectId,
      revision: 1,
      visibility: "only_me",
    },
  };
  let initialized = false;
  const listMembers = vi.fn(async () => ({
    items: [member()],
    ...(options.listCursor ? { nextCursor: options.listCursor } : {}),
  }));
  const listApiKeys = vi.fn(async () => ({
    items: [apiKey()],
    ...(options.listCursor ? { nextCursor: options.listCursor } : {}),
  }));
  const issueApiKey = vi.fn(async () => ({ apiKey: apiKey(), token: "secret-token" }));
  const access = {
    getAccessPolicy: vi.fn(async () => {
      if (initialized && options.bootstrapStateMissing) return null;
      return options.policy === undefined ? state : options.policy;
    }),
    getApiAccess: vi.fn(async () =>
      options.apiAccess === undefined ? apiAccess() : options.apiAccess,
    ),
    initialize: vi.fn(async () => {
      initialized = true;
    }),
    issueApiKey,
    listApiKeys,
    listMembers,
    removeMember: vi.fn(async () => options.removed ?? true),
    revokeApiKey: vi.fn(async () => apiKey({ revokedAt: "2026-07-21T13:00:00.000Z" })),
    setMemberRole: vi.fn(async () => member()),
    updateApiAccess: vi.fn(async () => apiAccess()),
    updatePolicy: vi.fn(async () => state),
  };
  registerKnowledgeSpaceAccessHandlers({
    access: access as never,
    app: app as never,
    authorization: {
      authorize: vi.fn(async () => {
        if (options.authorizationError) throw options.authorizationError;
        return {};
      }),
    } as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });
  return {
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(accessContext(options) as never);
    },
    issueApiKey,
    listApiKeys,
    listMembers,
  };
}

function accessContext(options: AccessFixtureOptions) {
  const body = {
    enabled: true,
    expectedRevision: 1,
    ...(options.bodyExpiresAt ? { expiresAt: options.bodyExpiresAt } : {}),
    name: "CI key",
    ownerSubjectId: SUBJECT.subjectId,
    partialMemberSubjectIds: [],
    principalSubjectId: "viewer-1",
    role: "viewer",
    subjectId: "viewer-1",
    visibility: "only_me",
  };
  return {
    body: (value: unknown, status: number) => ({ body: value, status }),
    get: () => options.subject ?? SUBJECT,
    json: (value: unknown, status: number) => ({ body: value, status }),
    req: {
      valid: (part: string) => {
        if (part === "param") return { id: SPACE_ID, keyId: "key-1", subjectId: "viewer-1" };
        if (part === "query") {
          return {
            expectedRevision: 1,
            limit: 10,
            ...(options.queryCursor ? { cursor: options.queryCursor } : {}),
          };
        }
        return body;
      },
    },
  };
}

function member() {
  return { id: "member-1", revision: 1, role: "viewer", subjectId: "viewer-1" };
}

function apiAccess() {
  return { enabled: true, id: "api-access-1", revision: 1 };
}

function apiKey(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-07-21T12:00:00.000Z",
    id: "key-1",
    keyPrefix: "kfs_1234",
    name: "CI key",
    principalSubjectId: "viewer-1",
    revision: 1,
    status: "active",
    updatedAt: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}
