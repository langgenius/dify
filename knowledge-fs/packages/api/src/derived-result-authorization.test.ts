import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { AgentWorkspaceReplay, AgentWorkspaceSnapshot } from "./agent-workspace-snapshot";
import {
  DerivedResultOwnerMismatchError,
  authorizeAgentWorkspaceDerivedResult,
  authorizeResearchTaskDerivedResult,
  issueKnowledgeSpaceDurablePermission,
  toMcpPublicDerivedResult,
  toPublicAgentWorkspaceReplay,
  toPublicAgentWorkspaceSnapshot,
  toPublicResearchTaskJob,
} from "./derived-result-authorization";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { ResearchTaskJob } from "./research-task-job";

const subject: AuthSubject = {
  scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
  subjectId: "subject-1",
  tenantId: "tenant-1",
};
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

function createAuthorizationGuard() {
  const authorize = vi.fn<KnowledgeSpaceAuthorizationGuard["authorize"]>(async (input) => ({
    accessContext: {
      apiAccess: { enabled: true, id: "api-access-1", revision: 1 },
      member: {
        id: "member-1",
        revision: 1,
        role: "owner",
        subjectId: input.subject.subjectId,
      },
      partialMemberSubjectIds: [],
      policy: {
        id: "policy-1",
        ownerSubjectId: input.subject.subjectId,
        revision: 1,
        visibility: "all_members",
      },
    },
    permissionSnapshot: {
      apiAccessRevision: 1,
      callerKind: input.callerKind,
      candidateGrants: ["document:read"],
      issuedAt: "2026-07-21T12:00:00.000Z",
      knowledgeSpaceId: input.knowledgeSpaceId,
      memberRevision: 1,
      memberRole: "owner",
      policyRevision: 1,
      subjectId: input.subject.subjectId,
      tenantId: input.subject.tenantId,
    },
  }));
  return { authorize, guard: { authorize } };
}

function permissionSnapshot(
  overrides: Partial<KnowledgeSpacePermissionSnapshot> = {},
): KnowledgeSpacePermissionSnapshot {
  return {
    accessChannel: "interactive",
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    createdAt: "2026-07-21T12:00:00.000Z",
    expiresAt: "2026-07-21T13:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
    knowledgeSpaceId,
    memberRevision: 1,
    permissionScopes: ["document:read", "document:write"],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: subject.subjectId,
    tenantId: subject.tenantId,
    updatedAt: "2026-07-21T12:00:00.000Z",
    visibility: "all_members",
    ...overrides,
  };
}

function researchTaskJob(overrides: Partial<ResearchTaskJob> = {}): ResearchTaskJob {
  return {
    budgetUsd: 2,
    cost: { entries: [], totalUsd: 0.25 },
    createdAt: 1_000,
    executionAttempts: 1,
    id: "research-task-1",
    knowledgeSpaceId,
    limits: { maxToolCalls: 4 },
    maxExecutionAttempts: 5,
    metadata: {
      __knowledgeFsPermission: "internal",
      publicLabel: "visible",
    },
    mode: "research",
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      revision: 1,
    },
    query: "Explain the authorization result",
    rowVersion: 2,
    stage: "completed",
    subjectId: subject.subjectId,
    tenantId: subject.tenantId,
    topK: 8,
    updatedAt: 2_000,
    ...overrides,
  };
}

function agentWorkspaceSnapshot(
  overrides: Partial<AgentWorkspaceSnapshot> = {},
): AgentWorkspaceSnapshot {
  return {
    commandLog: [],
    createdAt: "2026-07-21T12:00:00.000Z",
    evidenceBundles: [],
    fingerprint: "snapshot-sha256:test",
    id: "snapshot-1",
    indexProjection: { fingerprint: "projection-1", projectionIds: [] },
    knowledgeSpaceId,
    manifestVersion: 1,
    metadata: { visible: true },
    mounts: [],
    pathVersions: [],
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      revision: 1,
      scopes: ["document:read"],
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
    },
    sourceVersions: [],
    tenantId: subject.tenantId,
    traceIds: ["trace-1"],
    ...overrides,
  };
}

function agentWorkspaceReplay(): AgentWorkspaceReplay {
  return {
    commands: [],
    completedAt: "2026-07-21T12:01:00.000Z",
    id: "replay-1",
    knowledgeSpaceId,
    snapshotId: "snapshot-1",
    startedAt: "2026-07-21T12:00:00.000Z",
    summary: { changed: 0, failed: 0, matched: 0, total: 0 },
    tenantId: subject.tenantId,
    traceId: "trace-1",
  };
}

describe("derived result authorization", () => {
  it.each([
    ["viewer", "read", true],
    ["editor", "write", true],
    ["viewer", "write", false],
    ["owner", "admin", true],
    ["editor", "admin", false],
  ] as const)(
    "evaluates a %s durable permission for %s access",
    async (role, requiredAccess, allowed) => {
      const snapshot = permissionSnapshot({ role });
      const createPermissionSnapshot = vi.fn<
        KnowledgeSpaceAccessService["createPermissionSnapshot"]
      >(async () => snapshot);
      const authorization = createAuthorizationGuard();
      const result = issueKnowledgeSpaceDurablePermission({
        access: { createPermissionSnapshot },
        authorization: authorization.guard,
        callerKind: "interactive",
        expiresAt: snapshot.expiresAt,
        knowledgeSpaceId,
        requiredAccess,
        subject,
      });

      if (allowed) {
        await expect(result).resolves.toEqual(snapshot);
      } else {
        await expect(result).rejects.toMatchObject({
          code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
        });
      }
      expect(authorization.authorize).toHaveBeenCalledWith({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess,
        subject,
      });
    },
  );

  it("requires and propagates an authenticated API-key binding", async () => {
    const snapshot = permissionSnapshot({
      accessChannel: "service_api",
      apiKeyId: "api-key-1",
      apiKeyRevision: 3,
    });
    const createPermissionSnapshot = vi.fn<KnowledgeSpaceAccessService["createPermissionSnapshot"]>(
      async () => snapshot,
    );
    const authorization = createAuthorizationGuard();
    const baseInput = {
      access: { createPermissionSnapshot },
      authorization: authorization.guard,
      callerKind: "api_key" as const,
      expiresAt: snapshot.expiresAt,
      knowledgeSpaceId,
      requiredAccess: "read" as const,
      subject,
    };

    await expect(issueKnowledgeSpaceDurablePermission(baseInput)).rejects.toBeInstanceOf(
      KnowledgeSpaceAuthorizationError,
    );
    await expect(
      issueKnowledgeSpaceDurablePermission({
        ...baseInput,
        apiKey: { expiresAt: snapshot.expiresAt, id: "api-key-1", revision: 3 },
      }),
    ).resolves.toEqual(snapshot);
    expect(createPermissionSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessChannel: "service_api",
        apiKey: { expiresAt: snapshot.expiresAt, id: "api-key-1", revision: 3 },
      }),
    );
  });

  it("conceals access-service failures while preserving unexpected failures", async () => {
    const authorization = createAuthorizationGuard();
    const baseInput = {
      authorization: authorization.guard,
      callerKind: "interactive" as const,
      expiresAt: "2026-07-21T13:00:00.000Z",
      knowledgeSpaceId,
      requiredAccess: "read" as const,
      subject,
    };
    const deniedAccess = {
      createPermissionSnapshot: async () => {
        throw new KnowledgeSpaceAccessError("space_access_not_found", "missing access state");
      },
    };
    await expect(
      issueKnowledgeSpaceDurablePermission({ ...baseInput, access: deniedAccess }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });

    const unexpectedAccess = {
      createPermissionSnapshot: async () => {
        throw new Error("access backend unavailable");
      },
    };
    await expect(
      issueKnowledgeSpaceDurablePermission({ ...baseInput, access: unexpectedAccess }),
    ).rejects.toThrow("access backend unavailable");
  });

  it("revalidates a research-task owner binding before authorizing access", async () => {
    const snapshot = permissionSnapshot();
    const revalidatePermissionSnapshot = vi.fn<
      KnowledgeSpaceAccessService["revalidatePermissionSnapshot"]
    >(async () => snapshot);
    const authorization = createAuthorizationGuard();

    await expect(
      authorizeResearchTaskDerivedResult({
        access: { revalidatePermissionSnapshot },
        authorization: authorization.guard,
        callerKind: "interactive",
        job: researchTaskJob(),
        requiredAccess: "read",
        subject,
      }),
    ).resolves.toEqual(snapshot);
    expect(revalidatePermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: snapshot.id,
        knowledgeSpaceId,
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
      }),
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeSpaceId, requiredAccess: "read", subject }),
    );
  });

  it.each([
    ["missing subject", { subjectId: undefined }],
    ["missing permission", { permissionSnapshot: undefined }],
    ["wrong subject", { subjectId: "subject-2" }],
    ["wrong tenant", { tenantId: "tenant-2" }],
  ] as const)("conceals a research task with %s", async (_case, overrides) => {
    const authorization = createAuthorizationGuard();
    await expect(
      authorizeResearchTaskDerivedResult({
        access: {
          revalidatePermissionSnapshot: async () => permissionSnapshot(),
        },
        authorization: authorization.guard,
        callerKind: "interactive",
        job: researchTaskJob(overrides),
        requiredAccess: "read",
        subject,
      }),
    ).rejects.toBeInstanceOf(DerivedResultOwnerMismatchError);
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  it("revalidates an agent workspace owner binding before authorizing access", async () => {
    const snapshot = permissionSnapshot();
    const revalidatePermissionSnapshot = vi.fn<
      KnowledgeSpaceAccessService["revalidatePermissionSnapshot"]
    >(async () => snapshot);
    const authorization = createAuthorizationGuard();

    await expect(
      authorizeAgentWorkspaceDerivedResult({
        access: { revalidatePermissionSnapshot },
        authorization: authorization.guard,
        callerKind: "interactive",
        requiredAccess: "write",
        snapshot: agentWorkspaceSnapshot(),
        subject,
      }),
    ).resolves.toEqual(snapshot);
    expect(authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeSpaceId, requiredAccess: "write", subject }),
    );
  });

  it.each([
    ["wrong snapshot tenant", { tenantId: "tenant-2" }, {}],
    ["wrong subject", {}, { subjectId: "subject-2" }],
    ["wrong permission tenant", {}, { tenantId: "tenant-2" }],
    ["missing access channel", {}, { accessChannel: undefined }],
    ["missing permission id", {}, { id: undefined }],
    ["missing permission revision", {}, { revision: undefined }],
  ] as const)(
    "conceals an agent workspace with %s",
    async (_case, snapshotOverrides, permissionOverrides) => {
      const authorization = createAuthorizationGuard();
      const base = agentWorkspaceSnapshot();
      await expect(
        authorizeAgentWorkspaceDerivedResult({
          access: {
            revalidatePermissionSnapshot: async () => permissionSnapshot(),
          },
          authorization: authorization.guard,
          callerKind: "interactive",
          requiredAccess: "read",
          snapshot: agentWorkspaceSnapshot({
            ...snapshotOverrides,
            permissionSnapshot: { ...base.permissionSnapshot, ...permissionOverrides },
          }),
          subject,
        }),
      ).rejects.toMatchObject({ message: "Derived result not found" });
      expect(authorization.authorize).not.toHaveBeenCalled();
    },
  );

  it("exposes only public research-task, workspace snapshot, and replay fields", () => {
    const job = researchTaskJob({
      completedAt: 2_000,
      error: "completed with warning",
      heartbeatAt: 1_500,
      leaseToken: "secret-lease",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    expect(toPublicResearchTaskJob(job)).toEqual({
      budgetUsd: 2,
      completedAt: 2_000,
      cost: job.cost,
      createdAt: 1_000,
      error: "completed with warning",
      id: "research-task-1",
      knowledgeSpaceId,
      limits: { maxToolCalls: 4 },
      metadata: { publicLabel: "visible" },
      mode: "research",
      query: "Explain the authorization result",
      stage: "completed",
      topK: 8,
      updatedAt: 2_000,
    });

    const snapshot = agentWorkspaceSnapshot();
    expect(toPublicAgentWorkspaceSnapshot(snapshot)).toEqual(
      expect.not.objectContaining({
        permissionSnapshot: expect.anything(),
        tenantId: expect.anything(),
      }),
    );
    expect(toPublicAgentWorkspaceSnapshot(snapshot)).toMatchObject({
      id: snapshot.id,
      knowledgeSpaceId,
    });

    const replay = agentWorkspaceReplay();
    expect(toPublicAgentWorkspaceReplay(replay)).toEqual(
      expect.not.objectContaining({ tenantId: expect.anything() }),
    );
    expect(toPublicAgentWorkspaceReplay(replay)).toMatchObject({
      id: replay.id,
      knowledgeSpaceId,
    });
  });

  it("recursively removes MCP authorization and worker-control fields", () => {
    expect(
      toMcpPublicDerivedResult({
        permissionSnapshot: { id: "secret" },
        public: "kept",
        results: [
          {
            nested: { subjectId: "subject-1", title: "Visible" },
            queueJobId: "queue-1",
          },
          null,
          "plain-value",
        ],
        tenantId: "tenant-1",
      }),
    ).toEqual({
      public: "kept",
      results: [{ nested: { title: "Visible" } }, null, "plain-value"],
    });
  });
});
