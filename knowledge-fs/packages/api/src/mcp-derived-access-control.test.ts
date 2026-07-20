import type { AuthSubject } from "@knowledge/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import {
  type KnowledgeMcpPermissionContext,
  type ResearchTaskJob,
  createInMemoryAgentWorkspaceSnapshotRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeMcpServer,
  createKnowledgeSpaceAccessService,
  createKnowledgeSpaceAuthorizationGuard,
} from "./index";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const TENANT_ID = "tenant-1";
const OWNER: AuthSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "owner-1",
  tenantId: TENANT_ID,
};
const MEMBER: AuthSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "member-2",
  tenantId: TENANT_ID,
};

describe("MCP durable derived-result access control", () => {
  it("binds Research and Workspace results to the exact creator and current ACL revision", async () => {
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
        now: () => "2026-07-14T12:00:00.000Z",
      }),
    });
    await access.initialize({
      knowledgeSpaceId: SPACE_ID,
      ownerSubjectId: OWNER.subjectId,
      tenantId: TENANT_ID,
    });
    await access.setMemberRole({
      actorSubjectId: OWNER.subjectId,
      expectedRevision: 0,
      knowledgeSpaceId: SPACE_ID,
      role: "editor",
      subjectId: MEMBER.subjectId,
      tenantId: TENANT_ID,
    });
    await access.updatePolicy({
      actorSubjectId: OWNER.subjectId,
      expectedRevision: 1,
      knowledgeSpaceId: SPACE_ID,
      partialMemberSubjectIds: [],
      tenantId: TENANT_ID,
      visibility: "all_members",
    });
    await access.updateApiAccess({
      actorSubjectId: OWNER.subjectId,
      enabled: true,
      expectedRevision: 1,
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    const state = createDerivedState();
    const ownerMcp = createKnowledgeMcpServer(derivedMcpOptions({ access, state, subject: OWNER }));
    const memberMcp = createKnowledgeMcpServer(
      derivedMcpOptions({ access, state, subject: MEMBER }),
    );

    const createdResearch = await ownerMcp.callTool("knowledge.research.create", {
      knowledgeSpaceId: SPACE_ID,
      query: "creator-bound research",
      topK: 3,
    });
    const createdWorkspace = await ownerMcp.callTool(
      "knowledge.workspace_snapshot.create",
      workspaceCreateInput(),
    );
    expectNoMcpDerivedInternals(createdResearch);
    expectNoMcpDerivedInternals(createdWorkspace);

    await expect(
      ownerMcp.callTool("knowledge.research.get", { id: "research-mcp-1" }),
    ).resolves.toMatchObject({ structuredContent: { id: "research-mcp-1" } });
    await expect(
      ownerMcp.callTool("knowledge.workspace_snapshot.get", { id: "workspace-mcp-1" }),
    ).resolves.toMatchObject({ structuredContent: { id: "workspace-mcp-1" } });

    for (const [tool, input] of [
      ["knowledge.research.get", { id: "research-mcp-1" }],
      ["knowledge.research.cancel", { id: "research-mcp-1" }],
      ["knowledge.workspace_snapshot.get", { id: "workspace-mcp-1" }],
      ["knowledge.workspace_snapshot.replay", { id: "workspace-mcp-1" }],
    ] as const) {
      await expect(memberMcp.callTool(tool, input), tool).rejects.toThrow(
        "Derived result not found",
      );
    }

    await access.updatePolicy({
      actorSubjectId: OWNER.subjectId,
      expectedRevision: 2,
      knowledgeSpaceId: SPACE_ID,
      partialMemberSubjectIds: [],
      tenantId: TENANT_ID,
      visibility: "only_me",
    });
    await expect(
      ownerMcp.callTool("knowledge.research.get", { id: "research-mcp-1" }),
    ).rejects.toThrow("Knowledge space access denied");
    await expect(
      ownerMcp.callTool("knowledge.workspace_snapshot.replay", { id: "workspace-mcp-1" }),
    ).rejects.toThrow("Knowledge space access denied");
  });
});

function createDerivedState() {
  return {
    researchJob: null as ResearchTaskJob | null,
    snapshots: createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 10,
      maxEvidenceBundles: 10,
      maxMounts: 10,
      maxSnapshots: 10,
      maxSourceVersions: 10,
      now: () => "2026-07-14T12:00:00.000Z",
    }),
  };
}

function derivedMcpOptions(input: {
  readonly access: ReturnType<typeof createKnowledgeSpaceAccessService>;
  readonly state: ReturnType<typeof createDerivedState>;
  readonly subject: AuthSubject;
}): Parameters<typeof createKnowledgeMcpServer>[0] {
  return {
    ...minimalHandlers(),
    authorization: {
      access: input.access,
      guard: createKnowledgeSpaceAuthorizationGuard({ access: input.access }),
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      subject: input.subject,
    },
    research: {
      cancel: async ({ id }) => {
        if (!input.state.researchJob || input.state.researchJob.id !== id) {
          return null;
        }
        input.state.researchJob = {
          ...input.state.researchJob,
          stage: "canceled",
          updatedAt: 2,
        };
        return input.state.researchJob;
      },
      create: async (request) => {
        const permission = requiredDurablePermission(request);
        input.state.researchJob = {
          cost: { entries: [], totalUsd: 0 },
          createdAt: 1,
          executionAttempts: 0,
          id: "research-mcp-1",
          knowledgeSpaceId: request.knowledgeSpaceId,
          maxExecutionAttempts: 5,
          metadata: {},
          permissionSnapshot: {
            accessChannel: permission.accessChannel,
            id: permission.id,
            revision: permission.revision,
          },
          query: request.query,
          rowVersion: 1,
          stage: "queued",
          subjectId: permission.subjectId,
          tenantId: permission.tenantId,
          topK: request.topK,
          updatedAt: 1,
        };
        return input.state.researchJob;
      },
      get: async ({ id }) => (input.state.researchJob?.id === id ? input.state.researchJob : null),
      plan: async () => {
        throw new Error("not used");
      },
    },
    workspaceSnapshots: {
      create: async (request) => {
        const permission = requiredDurablePermission(request);
        return input.state.snapshots.create({
          commandLog: request.commandLog,
          evidenceBundles: request.evidenceBundles,
          id: "workspace-mcp-1",
          indexProjection: request.indexProjection,
          knowledgeSpaceId: request.knowledgeSpaceId,
          manifestVersion: request.manifestVersion,
          metadata: request.metadata,
          mounts: request.mounts,
          pathVersions: request.pathVersions,
          permissionSnapshot: {
            accessChannel: permission.accessChannel,
            id: permission.id,
            revision: permission.revision,
            scopes: [...(request.permissionScope ?? [])],
            subjectId: permission.subjectId,
            tenantId: permission.tenantId,
          },
          researchTaskJobId: request.researchTaskJobId,
          sourceVersions: request.sourceVersions,
          tenantId: permission.tenantId,
          traceIds: request.traceIds,
        });
      },
      get: ({ id }) => input.state.snapshots.get({ id, tenantId: TENANT_ID }),
      replay: async ({ id, traceId }) => ({
        commands: [],
        completedAt: "2026-07-14T12:00:02.000Z",
        id: "workspace-replay-mcp-1",
        knowledgeSpaceId: SPACE_ID,
        snapshotId: id,
        startedAt: "2026-07-14T12:00:01.000Z",
        summary: { changed: 0, failed: 0, matched: 0, total: 0 },
        tenantId: TENANT_ID,
        ...(traceId ? { traceId } : {}),
      }),
    },
  };
}

function requiredDurablePermission(input: KnowledgeMcpPermissionContext) {
  if (!input.durablePermission) {
    throw new Error("MCP durable permission is required");
  }
  return input.durablePermission;
}

function workspaceCreateInput() {
  return {
    commandLog: [],
    evidenceBundles: [],
    indexProjection: { fingerprint: "projection-1", projectionIds: [] },
    knowledgeSpaceId: SPACE_ID,
    mounts: [],
    sourceVersions: [],
    traceIds: [],
  };
}

function minimalHandlers(): Omit<Parameters<typeof createKnowledgeMcpServer>[0], "authorization"> {
  return {
    fetchEvidence: async () => {
      throw new Error("not used");
    },
    fs: {
      cat: async () => {
        throw new Error("not used");
      },
      diff: async () => {
        throw new Error("not used");
      },
      find: async () => {
        throw new Error("not used");
      },
      grep: async () => {
        throw new Error("not used");
      },
      ls: async () => {
        throw new Error("not used");
      },
      openNode: async () => {
        throw new Error("not used");
      },
      stat: async () => {
        throw new Error("not used");
      },
      tree: async () => {
        throw new Error("not used");
      },
    },
    search: async () => ({ items: [] }),
    shell: {
      execute: async () => {
        throw new Error("not used");
      },
      plan: async () => {
        throw new Error("not used");
      },
    },
  };
}

function expectNoMcpDerivedInternals(result: CallToolResult): void {
  const serialized = JSON.stringify(result);
  for (const key of [
    "leaseToken",
    "permissionScope",
    "permissionSnapshot",
    "queueJobId",
    "rowVersion",
    "subjectId",
    "tenantId",
  ]) {
    expect(serialized).not.toContain(`\"${key}\"`);
  }
}
