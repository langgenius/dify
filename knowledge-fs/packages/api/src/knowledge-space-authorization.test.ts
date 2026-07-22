import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  type KnowledgeSpaceAuthorizationAccessContext,
  createKnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const issuedAt = "2026-07-14T12:00:00.000Z";

describe("knowledge space authorization guard", () => {
  it.each([
    ["owner", "read"],
    ["owner", "write"],
    ["owner", "admin"],
    ["editor", "read"],
    ["editor", "write"],
    ["viewer", "read"],
  ] as const)("allows %s to perform %s", async (role, requiredAccess) => {
    const getAccessContext = vi.fn(async () => accessContext({ role }));
    const guard = createKnowledgeSpaceAuthorizationGuard({
      access: { getAccessContext },
      now: () => issuedAt,
    });

    const result = await guard.authorize({
      callerKind: "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject: subject("user-1", ["client:forged", "knowledge-spaces:*"]),
    });

    expect(getAccessContext).toHaveBeenCalledWith({
      knowledgeSpaceId,
      subjectId: "user-1",
      tenantId,
    });
    expect(result.permissionSnapshot).toMatchObject({
      apiAccessRevision: 5,
      callerKind: "interactive",
      issuedAt,
      knowledgeSpaceId,
      memberRevision: 3,
      memberRole: role,
      policyRevision: 4,
      subjectId: "user-1",
      tenantId,
    });
    expect(result.permissionSnapshot.candidateGrants).toEqual([
      `knowledge-space:${knowledgeSpaceId}`,
      `knowledge-space:${knowledgeSpaceId}:member:user-1`,
      `knowledge-space:${knowledgeSpaceId}:role:${role}`,
      `knowledge-space:${knowledgeSpaceId}:visibility:all_members`,
      `tenant:${tenantId}`,
    ]);
    expect(result.permissionSnapshot.candidateGrants).not.toContain("client:forged");
    expect(result.permissionSnapshot.candidateGrants).not.toContain("knowledge-spaces:*");
  });

  it.each([
    ["viewer", "write"],
    ["viewer", "admin"],
    ["editor", "admin"],
  ] as const)("rejects %s for %s", async (role, requiredAccess) => {
    const guard = guardFor(accessContext({ role }));

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess,
        subject: subject("user-1"),
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_ROLE_DENIED",
    });
  });

  it("fails closed when tenant-scoped membership does not exist", async () => {
    const getAccessContext = vi.fn(async () => null);
    const guard = createKnowledgeSpaceAuthorizationGuard({ access: { getAccessContext } });

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
      message: "Knowledge space access denied",
    });
    expect(getAccessContext).toHaveBeenCalledWith({
      knowledgeSpaceId,
      subjectId: "user-1",
      tenantId,
    });
  });

  it("fails closed when a repository returns another member", async () => {
    const guard = guardFor(accessContext({ subjectId: "user-2" }));

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
  });

  it.each(["service_api", "api_key", "mcp", "agent"] as const)(
    "blocks %s immediately while API access is disabled",
    async (callerKind) => {
      const guard = guardFor(accessContext({ apiAccessEnabled: false }));

      await expect(
        guard.authorize({
          callerKind,
          knowledgeSpaceId,
          requiredAccess: "read",
          subject: subject("user-1"),
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_API_ACCESS_DISABLED",
      });
    },
  );

  it("does not apply the API access switch to an interactive bearer session", async () => {
    const guard = guardFor(accessContext({ apiAccessEnabled: false }));

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).resolves.toMatchObject({ permissionSnapshot: { subjectId: "user-1" } });
  });

  it("allows only the policy-bound subject for only_me", async () => {
    const allowed = guardFor(accessContext({ ownerSubjectId: "user-1", visibility: "only_me" }));
    const denied = guardFor(
      accessContext({ ownerSubjectId: "user-2", role: "owner", visibility: "only_me" }),
    );

    await expect(
      allowed.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).resolves.toBeDefined();
    await expect(
      denied.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_VISIBILITY_DENIED" });
  });

  it("requires an exact selected member for partial_members", async () => {
    const allowed = guardFor(
      accessContext({
        partialMemberSubjectIds: ["user-2", "user-1"],
        visibility: "partial_members",
      }),
    );
    const denied = guardFor(
      accessContext({ partialMemberSubjectIds: ["user-2"], visibility: "partial_members" }),
    );

    await expect(
      allowed.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).resolves.toBeDefined();
    await expect(
      denied.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_VISIBILITY_DENIED" });
  });

  it("re-reads membership and API access on every request", async () => {
    const getAccessContext = vi
      .fn()
      .mockResolvedValueOnce(accessContext({ apiAccessEnabled: true }))
      .mockResolvedValueOnce(accessContext({ apiAccessEnabled: false }));
    const guard = createKnowledgeSpaceAuthorizationGuard({ access: { getAccessContext } });
    const input = {
      callerKind: "api_key" as const,
      knowledgeSpaceId,
      requiredAccess: "read" as const,
      subject: subject("user-1"),
    };

    await expect(guard.authorize(input)).resolves.toBeDefined();
    await expect(guard.authorize(input)).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_API_ACCESS_DISABLED",
    });
    expect(getAccessContext).toHaveBeenCalledTimes(2);
  });

  it("returns defensive copies of the context and permission grants", async () => {
    const stored = accessContext({
      partialMemberSubjectIds: ["user-1"],
      visibility: "partial_members",
    });
    const guard = guardFor(stored);
    const result = await guard.authorize({
      callerKind: "interactive",
      knowledgeSpaceId,
      requiredAccess: "read",
      subject: subject("user-1"),
    });

    (result.accessContext.partialMemberSubjectIds as string[]).push("attacker");
    (result.permissionSnapshot.candidateGrants as string[]).push("attacker");

    expect(stored.partialMemberSubjectIds).toEqual(["user-1"]);
    const again = await guard.authorize({
      callerKind: "interactive",
      knowledgeSpaceId,
      requiredAccess: "read",
      subject: subject("user-1"),
    });
    expect(again.permissionSnapshot.candidateGrants).not.toContain("attacker");
  });

  it("fails closed for malformed persisted revisions", async () => {
    const context = accessContext();
    const malformed = { ...context, member: { ...context.member, revision: 0 } };
    const guard = guardFor(malformed);

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toThrow("member.revision must be a positive integer");
  });

  it.each([
    [
      "invalid role",
      (context: KnowledgeSpaceAuthorizationAccessContext) => ({
        ...context,
        member: { ...context.member, role: "administrator" },
      }),
    ],
    [
      "invalid visibility",
      (context: KnowledgeSpaceAuthorizationAccessContext) => ({
        ...context,
        policy: { ...context.policy, visibility: "tenant" },
      }),
    ],
    [
      "non-boolean API access",
      (context: KnowledgeSpaceAuthorizationAccessContext) => ({
        ...context,
        apiAccess: { ...context.apiAccess, enabled: "yes" },
      }),
    ],
  ] as const)("fails closed for %s returned by the access repository", async (_label, mutate) => {
    const malformed = mutate(
      accessContext(),
    ) as unknown as KnowledgeSpaceAuthorizationAccessContext;
    const guard = guardFor(malformed);

    await expect(
      guard.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "read",
        subject: subject("user-1"),
      }),
    ).rejects.toThrow(/invalid|must be boolean/);
  });
});

function subject(subjectId: string, scopes: readonly string[] = []): AuthSubject {
  return { scopes: [...scopes], subjectId, tenantId };
}

function accessContext(
  overrides: {
    readonly apiAccessEnabled?: boolean;
    readonly ownerSubjectId?: string;
    readonly partialMemberSubjectIds?: readonly string[];
    readonly role?: "owner" | "editor" | "viewer";
    readonly subjectId?: string;
    readonly visibility?: "only_me" | "all_members" | "partial_members";
  } = {},
): KnowledgeSpaceAuthorizationAccessContext {
  const subjectId = overrides.subjectId ?? "user-1";
  return {
    apiAccess: {
      enabled: overrides.apiAccessEnabled ?? true,
      id: "api-access-1",
      revision: 5,
    },
    member: {
      id: "member-1",
      revision: 3,
      role: overrides.role ?? "viewer",
      subjectId,
    },
    partialMemberSubjectIds: [...(overrides.partialMemberSubjectIds ?? [])],
    policy: {
      id: "policy-1",
      ownerSubjectId: overrides.ownerSubjectId ?? subjectId,
      revision: 4,
      visibility: overrides.visibility ?? "all_members",
    },
  };
}

function guardFor(context: KnowledgeSpaceAuthorizationAccessContext) {
  return createKnowledgeSpaceAuthorizationGuard({
    access: { getAccessContext: async () => context },
    now: () => issuedAt,
  });
}
