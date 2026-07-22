import { describe, expect, it, vi } from "vitest";

import { hashKnowledgeSpaceApiKey } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceApiKeyAuthenticationError,
  constantTimeApiKeyHashMatches,
  createKnowledgeSpaceApiKeyAuthenticator,
  parseKnowledgeSpaceApiKeyToken,
} from "./knowledge-space-api-key-authentication";
import { createKnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const keyId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6a11";
const token = `kfs_${keyId}_abcdefghijklmnopqrstuvwxyz012345`;
const now = "2026-07-14T12:00:00.000Z";

describe("knowledge space API key authentication", () => {
  it("authenticates a hash-matched key and re-authorizes its principal", async () => {
    const findActiveApiKeyById = vi.fn(async () => apiKey());
    const markApiKeyUsed = vi.fn(async () => undefined);
    const getAccessContext = vi.fn(async () => accessContext(true));
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById, markApiKeyUsed },
      authorization: createKnowledgeSpaceAuthorizationGuard({
        access: { getAccessContext },
        now: () => now,
      }),
      now: () => now,
    });

    const result = await authenticate.authenticate({
      knowledgeSpaceId,
      requiredAccess: "write",
      token,
    });

    expect(findActiveApiKeyById).toHaveBeenCalledWith({ id: keyId });
    expect(getAccessContext).toHaveBeenCalledWith({
      knowledgeSpaceId,
      subjectId: "service-principal-1",
      tenantId,
    });
    expect(markApiKeyUsed).toHaveBeenCalledWith({
      id: keyId,
      knowledgeSpaceId,
      tenantId,
      usedAt: now,
    });
    expect(result).toMatchObject({
      keyId,
      subject: { scopes: [], subjectId: "service-principal-1", tenantId },
    });
    expect(result.authorization.permissionSnapshot.candidateGrants).not.toContain(
      "knowledge-spaces:*",
    );
    expect(result.authorization.permissionSnapshot.callerKind).toBe("api_key");
  });

  it("rejects a key with the correct id but wrong secret before authorization", async () => {
    const findActiveApiKeyById = vi.fn(async () => apiKey());
    const authorize = vi.fn();
    const markApiKeyUsed = vi.fn(async () => undefined);
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById, markApiKeyUsed },
      authorization: { authorize },
      now: () => now,
    });

    await expect(
      authenticate.authenticate({
        knowledgeSpaceId,
        requiredAccess: "read",
        token: `kfs_${keyId}_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceApiKeyAuthenticationError);
    expect(authorize).not.toHaveBeenCalled();
    expect(markApiKeyUsed).not.toHaveBeenCalled();
  });

  it("rejects malformed and unknown keys with the same public error", async () => {
    const findActiveApiKeyById = vi.fn(async () => null);
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById },
      authorization: { authorize: vi.fn() },
      now: () => now,
    });

    for (const value of ["not-a-key", `kfs_${keyId}_abcdefghijklmnopqrstuvwxyz012345`]) {
      await expect(
        authenticate.authenticate({
          knowledgeSpaceId,
          requiredAccess: "read",
          token: value,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_KNOWLEDGE_SPACE_API_KEY",
        message: "Invalid knowledge space API key",
      });
    }

    expect(findActiveApiKeyById).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["space mismatch", { knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9999" }],
    ["id mismatch", { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7777" }],
    ["revoked", { revokedAt: "2026-07-14T11:00:00.000Z" }],
    ["revoked status without timestamp", { status: "revoked" }],
    ["expired", { expiresAt: now }],
    ["corrupt stored hash", { keyHash: "not-a-hash" }],
  ] as const)("fails closed for a persisted record with %s", async (_label, override) => {
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById: async () => apiKey(override) },
      authorization: { authorize: vi.fn() },
      now: () => now,
    });

    await expect(
      authenticate.authenticate({ knowledgeSpaceId, requiredAccess: "read", token }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceApiKeyAuthenticationError);
  });

  it("does not mark usage when the current API access policy rejects the key", async () => {
    const markApiKeyUsed = vi.fn(async () => undefined);
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById: async () => apiKey(), markApiKeyUsed },
      authorization: createKnowledgeSpaceAuthorizationGuard({
        access: { getAccessContext: async () => accessContext(false) },
      }),
      now: () => now,
    });

    await expect(
      authenticate.authenticate({ knowledgeSpaceId, requiredAccess: "read", token }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_API_ACCESS_DISABLED",
    });
    expect(markApiKeyUsed).not.toHaveBeenCalled();
  });

  it("observes repository revocation on the next request", async () => {
    const findActiveApiKeyById = vi
      .fn()
      .mockResolvedValueOnce(apiKey())
      .mockResolvedValueOnce(null);
    const authenticate = createKnowledgeSpaceApiKeyAuthenticator({
      access: { findActiveApiKeyById },
      authorization: createKnowledgeSpaceAuthorizationGuard({
        access: { getAccessContext: async () => accessContext(true) },
      }),
      now: () => now,
    });
    const input = { knowledgeSpaceId, requiredAccess: "read" as const, token };

    await expect(authenticate.authenticate(input)).resolves.toBeDefined();
    await expect(authenticate.authenticate(input)).rejects.toBeInstanceOf(
      KnowledgeSpaceApiKeyAuthenticationError,
    );
  });
});

describe("API key helpers", () => {
  it("parses only the versioned UUID token format", () => {
    expect(parseKnowledgeSpaceApiKeyToken(token)).toEqual({ keyId });
    expect(parseKnowledgeSpaceApiKeyToken(`kfs_not-a-uuid_${"a".repeat(32)}`)).toBeNull();
    expect(parseKnowledgeSpaceApiKeyToken(`kfs_${keyId}_short`)).toBeNull();
  });

  it("compares only valid SHA-256 hex digests", () => {
    const hash = hashKnowledgeSpaceApiKey(token);
    expect(constantTimeApiKeyHashMatches(hash, hash)).toBe(true);
    expect(constantTimeApiKeyHashMatches(hash, hashKnowledgeSpaceApiKey(`${token}x`))).toBe(false);
    expect(constantTimeApiKeyHashMatches("bad", "bad")).toBe(false);
  });
});

function apiKey(
  override: Partial<{
    expiresAt: string;
    id: string;
    keyHash: string;
    knowledgeSpaceId: string;
    revokedAt: string;
    status: "active" | "revoked";
    tenantId: string;
  }> = {},
) {
  return {
    createdAt: now,
    createdBySubjectId: "owner-1",
    id: keyId,
    keyHash: hashKnowledgeSpaceApiKey(token),
    keyPrefix: `kfs_${keyId.slice(0, 8)}`,
    knowledgeSpaceId,
    name: "CI service",
    principalSubjectId: "service-principal-1",
    revision: 1,
    status: "active" as const,
    tenantId,
    updatedAt: now,
    ...override,
  };
}

function accessContext(apiAccessEnabled: boolean) {
  return {
    apiAccess: {
      createdAt: now,
      enabled: apiAccessEnabled,
      id: "api-access-1",
      knowledgeSpaceId,
      revision: 2,
      tenantId,
      updatedAt: now,
      updatedBySubjectId: "owner-1",
    },
    member: {
      createdAt: now,
      createdBySubjectId: "owner-1",
      id: "member-1",
      knowledgeSpaceId,
      revision: 3,
      role: "editor" as const,
      subjectId: "service-principal-1",
      tenantId,
      updatedAt: now,
    },
    partialMemberSubjectIds: [],
    policy: {
      createdAt: now,
      id: "policy-1",
      knowledgeSpaceId,
      ownerSubjectId: "owner-1",
      revision: 4,
      tenantId,
      updatedAt: now,
      updatedBySubjectId: "owner-1",
      visibility: "all_members" as const,
    },
  };
}
