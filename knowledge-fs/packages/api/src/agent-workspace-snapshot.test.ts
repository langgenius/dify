import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  ResourceMountSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  buildAgentWorkspaceSnapshotFingerprint,
  createAgentWorkspaceReplayService,
  createDatabaseAgentWorkspaceSnapshotRepository,
  createInMemoryAgentWorkspaceSnapshotRepository,
} from "./agent-workspace-snapshot";

describe("agent workspace snapshot repository", () => {
  it("builds stable fingerprints from manifest, permission, source, path, and projection versions", () => {
    const input = {
      manifestVersion: 2,
      pathVersions: [
        { version: "path@2", virtualPath: "/knowledge/docs/b.md" },
        { version: "path@1", virtualPath: "/knowledge/docs/a.md" },
      ],
      permissionSnapshot: {
        scopes: ["write", "read", "read"],
        subjectId: "subject-1",
        tenantId: "tenant-1",
      },
      projectionFingerprint: "projection-v2",
      sourceVersions: [
        {
          provider: "object-storage",
          providerResourceKey: "tenant-1/uploads/b.md",
          version: "sha256:def",
        },
        {
          provider: "object-storage",
          providerResourceKey: "tenant-1/uploads/a.md",
          version: "sha256:abc",
        },
      ],
    };

    const fingerprint = buildAgentWorkspaceSnapshotFingerprint(input);

    expect(fingerprint).toMatch(/^snapshot-sha256:[a-f0-9]{64}$/);
    expect(
      buildAgentWorkspaceSnapshotFingerprint({
        ...input,
        pathVersions: [...input.pathVersions].reverse(),
        permissionSnapshot: {
          ...input.permissionSnapshot,
          scopes: ["read", "write"],
        },
        sourceVersions: [...input.sourceVersions].reverse(),
      }),
    ).toBe(fingerprint);
    expect(buildAgentWorkspaceSnapshotFingerprint({ ...input, manifestVersion: 3 })).not.toBe(
      fingerprint,
    );
    expect(
      buildAgentWorkspaceSnapshotFingerprint({
        ...input,
        projectionFingerprint: "projection-v3",
      }),
    ).not.toBe(fingerprint);
    expect(
      buildAgentWorkspaceSnapshotFingerprint({
        ...input,
        pathVersions: [{ version: "path@3", virtualPath: "/knowledge/docs/a.md" }],
      }),
    ).not.toBe(fingerprint);
    expect(
      buildAgentWorkspaceSnapshotFingerprint({
        ...input,
        sourceVersions: [
          {
            provider: "object-storage",
            providerResourceKey: "tenant-1/uploads/a.md",
            version: "sha256:changed",
          },
        ],
      }),
    ).not.toBe(fingerprint);
  });

  it("captures clone-isolated research workspace context by tenant", async () => {
    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 4,
      maxEvidenceBundles: 2,
      maxMounts: 2,
      maxSnapshots: 2,
      maxSourceVersions: 2,
      now: () => "2026-05-12T16:00:00.000Z",
    });
    const snapshot = await repository.create({
      commandLog: [
        {
          command: "ls /knowledge/docs --limit 2",
          completedAt: "2026-05-12T15:59:02.000Z",
          cost: { estimatedRows: 3 },
          input: { path: "/knowledge/docs" },
          outputSummary: "2 docs",
          startedAt: "2026-05-12T15:59:01.000Z",
        },
      ],
      evidenceBundles: [evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a01")],
      id: "workspace-snapshot-1",
      indexProjection: {
        fingerprint: "projection-v1",
        projectionIds: ["projection-1"],
      },
      knowledgeSpaceId,
      manifestVersion: 2,
      metadata: { reason: "research-resume" },
      mounts: [
        ResourceMountSchema.parse({
          cachePolicy: { strategy: "none" },
          capabilities: ["ls", "cat"],
          createdAt: "2026-05-12T15:58:00.000Z",
          freshnessPolicy: { strategy: "manual" },
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d01",
          knowledgeSpaceId,
          metadata: {},
          mode: "read",
          mountPath: "/sources/uploads",
          permissionScope: ["tenant:tenant-1"],
          permissionSnapshotVersion: 1,
          provider: "object-storage",
          resourceType: "source",
          providerResourceKey: "tenant-1/uploads",
          sourcePointer: "s3://knowledge-fs/tenant-1/uploads",
          tenantId: "tenant-1",
          updatedAt: "2026-05-12T15:58:00.000Z",
        }),
      ],
      pathVersions: [{ version: "path@1", virtualPath: "/knowledge/docs/a.md" }],
      permissionSnapshot: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "subject-1",
        tenantId: "tenant-1",
      },
      researchTaskJobId: "research-task-job-1",
      sourceVersions: [
        {
          provider: "object-storage",
          providerResourceKey: "tenant-1/uploads/a.md",
          version: "sha256:abc",
        },
      ],
      tenantId: "tenant-1",
      traceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6e01"],
    });

    expect(snapshot).toMatchObject({
      createdAt: "2026-05-12T16:00:00.000Z",
      fingerprint: expect.stringMatching(/^snapshot-sha256:[a-f0-9]{64}$/),
      id: "workspace-snapshot-1",
      indexProjection: { fingerprint: "projection-v1" },
      knowledgeSpaceId,
      manifestVersion: 2,
      pathVersions: [{ version: "path@1", virtualPath: "/knowledge/docs/a.md" }],
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });

    snapshot.permissionSnapshot.scopes.push("mutated");
    const firstMount = snapshot.mounts[0];
    if (!firstMount) {
      throw new Error("expected snapshot mount");
    }
    firstMount.metadata.mutated = true;

    await expect(
      repository.get({ id: "workspace-snapshot-1", tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      mounts: [{ metadata: {} }],
      permissionSnapshot: { scopes: ["knowledge-spaces:read"] },
    });
    await expect(
      repository.get({ id: "workspace-snapshot-1", tenantId: "other-tenant" }),
    ).resolves.toBeNull();
  });

  it("replays bounded command logs and compares current output with the snapshot", async () => {
    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 4,
      maxEvidenceBundles: 2,
      maxMounts: 2,
      maxSnapshots: 2,
      maxSourceVersions: 2,
      now: () => "2026-05-12T16:00:00.000Z",
    });
    await repository.create({
      ...baseSnapshotInput("workspace-snapshot-1"),
      commandLog: [
        {
          command: "ls /knowledge/docs --limit 2",
          input: { path: "/knowledge/docs" },
          outputSummary: "2 docs",
          startedAt: "2026-05-12T15:59:01.000Z",
        },
        {
          command: "cat /knowledge/docs/a.md",
          input: { path: "/knowledge/docs/a.md" },
          outputSummary: "old body",
          startedAt: "2026-05-12T15:59:03.000Z",
        },
      ],
    });
    const seen: string[] = [];
    const replay = createAgentWorkspaceReplayService({
      generateId: () => "workspace-replay-1",
      maxCommands: 4,
      maxOutputSummaryBytes: 32,
      now: (() => {
        let tick = 0;
        return () => `2026-05-12T16:00:0${tick++}.000Z`;
      })(),
      runner: {
        run: async ({ command, commandIndex, snapshot, traceId }) => {
          seen.push(`${snapshot.id}:${commandIndex}:${command.command}:${traceId}`);
          return {
            outputSummary: commandIndex === 0 ? "2 docs" : "new body",
          };
        },
      },
      snapshots: repository,
    });

    const result = await replay.replay({
      id: "workspace-snapshot-1",
      permissionSnapshot: replayPermissionSnapshot(),
      tenantId: "tenant-1",
      traceId: "trace-1",
    });

    expect(result).toMatchObject({
      id: "workspace-replay-1",
      knowledgeSpaceId,
      snapshotId: "workspace-snapshot-1",
      summary: { changed: 1, failed: 0, matched: 1, total: 2 },
      tenantId: "tenant-1",
      traceId: "trace-1",
    });
    expect(result?.commands).toMatchObject([
      {
        command: "ls /knowledge/docs --limit 2",
        originalOutputSummary: "2 docs",
        replayedOutputSummary: "2 docs",
        status: "matched",
      },
      {
        command: "cat /knowledge/docs/a.md",
        originalOutputSummary: "old body",
        replayedOutputSummary: "new body",
        status: "changed",
      },
    ]);
    expect(seen).toEqual([
      "workspace-snapshot-1:0:ls /knowledge/docs --limit 2:trace-1",
      "workspace-snapshot-1:1:cat /knowledge/docs/a.md:trace-1",
    ]);

    if (!result) {
      throw new Error("expected replay result");
    }
    const replayedInput = result.commands[0]?.input;
    if (!replayedInput) {
      throw new Error("expected replayed input");
    }
    replayedInput.mutated = true;
    const again = await replay.replay({
      id: "workspace-snapshot-1",
      permissionSnapshot: replayPermissionSnapshot(),
      tenantId: "tenant-1",
    });
    expect(again?.commands[0]?.input).toEqual({ path: "/knowledge/docs" });
    const snapshot = await repository.get({ id: "workspace-snapshot-1", tenantId: "tenant-1" });
    if (!snapshot) {
      throw new Error("expected snapshot");
    }
    await expect(
      replay.replay({
        id: "workspace-snapshot-1",
        permissionSnapshot: replayPermissionSnapshot(),
        snapshotFingerprint: snapshot.fingerprint,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ snapshotId: "workspace-snapshot-1" });
    await expect(
      replay.replay({
        id: "workspace-snapshot-1",
        permissionSnapshot: replayPermissionSnapshot(),
        snapshotFingerprint:
          "snapshot-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      replay.replay({
        id: "workspace-snapshot-1",
        permissionSnapshot: replayPermissionSnapshot(),
        tenantId: "other-tenant",
      }),
    ).resolves.toBeNull();
  });

  it("bounds replay command count and output summaries", async () => {
    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 2,
      maxEvidenceBundles: 1,
      maxMounts: 1,
      maxSnapshots: 1,
      maxSourceVersions: 1,
    });
    await repository.create({
      ...baseSnapshotInput("workspace-snapshot-1"),
      commandLog: [
        {
          command: "ls /knowledge/docs --limit 2",
          input: {},
          outputSummary: "orig",
          startedAt: "2026-05-12T15:59:01.000Z",
        },
      ],
    });

    expect(() =>
      createAgentWorkspaceReplayService({
        maxCommands: 0,
        maxOutputSummaryBytes: 32,
        runner: { run: async () => ({ outputSummary: "ok" }) },
        snapshots: repository,
      }),
    ).toThrow("Agent workspace replay maxCommands must be at least 1");

    const replay = createAgentWorkspaceReplayService({
      maxCommands: 1,
      maxOutputSummaryBytes: 4,
      runner: { run: async () => ({ outputSummary: "too long" }) },
      snapshots: repository,
    });

    await expect(
      replay.replay({
        id: "workspace-snapshot-1",
        permissionSnapshot: replayPermissionSnapshot(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      commands: [
        {
          error: "Agent workspace replay output summary exceeds maxOutputSummaryBytes=4",
          status: "failed",
        },
      ],
      summary: { failed: 1 },
    });

    const missingSummaryReplay = createAgentWorkspaceReplayService({
      maxCommands: 1,
      maxOutputSummaryBytes: 4,
      runner: { run: async () => ({}) },
      snapshots: repository,
    });
    await expect(
      missingSummaryReplay.replay({
        id: "workspace-snapshot-1",
        permissionSnapshot: replayPermissionSnapshot(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      commands: [{ status: "changed" }],
    });
  });

  it("rejects snapshots with missing required identifiers", async () => {
    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 1,
      maxEvidenceBundles: 1,
      maxMounts: 1,
      maxSnapshots: 1,
      maxSourceVersions: 1,
    });

    await expect(
      repository.create({
        ...baseSnapshotInput("workspace-snapshot-1"),
        tenantId: " ",
      }),
    ).rejects.toThrow("Agent workspace snapshot tenantId is required");
  });

  it("bounds snapshot capacity and captured collection sizes", async () => {
    expect(() =>
      createInMemoryAgentWorkspaceSnapshotRepository({
        maxCommandLogEntries: 1,
        maxEvidenceBundles: 1,
        maxMounts: 1,
        maxSnapshots: 0,
        maxSourceVersions: 1,
      }),
    ).toThrow("Agent workspace snapshot repository maxSnapshots must be at least 1");

    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 1,
      maxEvidenceBundles: 1,
      maxMounts: 1,
      maxSnapshots: 1,
      maxSourceVersions: 1,
    });

    await expect(
      repository.create({
        ...baseSnapshotInput("workspace-snapshot-1"),
        mounts: [
          baseMount("018f0d60-7a49-7cc2-9c1b-5b36f18f6d01"),
          baseMount("018f0d60-7a49-7cc2-9c1b-5b36f18f6d02"),
        ],
      }),
    ).rejects.toThrow("Agent workspace snapshot mounts exceed maxMounts=1");

    await repository.create(baseSnapshotInput("workspace-snapshot-1"));
    await expect(repository.create(baseSnapshotInput("workspace-snapshot-2"))).rejects.toThrow(
      "Agent workspace snapshot repository maxSnapshots=1 exceeded",
    );
  });

  it("invalidates and deletes in-memory snapshots by bounded knowledge-space pages", async () => {
    const repository = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 1,
      maxEvidenceBundles: 1,
      maxMounts: 1,
      maxSnapshots: 2,
      maxSourceVersions: 1,
    });
    await repository.create(baseSnapshotInput("workspace-snapshot-1"));

    await expect(
      repository.invalidateByKnowledgeSpace({
        invalidatedAt: "2026-07-14T12:00:00.000Z",
        knowledgeSpaceId,
        limit: 1,
        reason: "durable-deletion:document_asset",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ complete: false, processed: 1 });
    await expect(
      repository.get({ id: "workspace-snapshot-1", tenantId: "tenant-1" }),
    ).resolves.toBeNull();
    await expect(
      repository.deleteInvalidatedByKnowledgeSpace({
        knowledgeSpaceId,
        limit: 2,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ complete: true, processed: 1 });
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`persists exact authorization and shares invalidation across replicas (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      let row: Record<string, unknown> | undefined;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert") {
          row = {
            access_channel: input.params[4],
            created_at: input.params[10],
            fingerprint: input.params[8],
            id: input.params[0],
            invalidated_at: null,
            invalidation_reason: null,
            knowledge_space_id: input.params[2],
            payload: JSON.parse(String(input.params[9])),
            permission_scopes: JSON.parse(String(input.params[7])),
            permission_snapshot_id: input.params[5],
            permission_snapshot_revision: input.params[6],
            subject_id: input.params[3],
            tenant_id: input.params[1],
          };
          return { rows: dialect === "postgres" ? [row] : [], rowsAffected: 1 };
        }
        if (input.operation === "select" && input.sql.includes("ORDER BY")) {
          const wantsInvalidated = input.sql.includes("IS NOT NULL");
          const isInvalidated = row?.invalidated_at !== null && row?.invalidated_at !== undefined;
          return row && wantsInvalidated === isInvalidated
            ? { rows: [{ id: row.id }], rowsAffected: 0 }
            : { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "select") {
          return row && row.invalidated_at == null
            ? { rows: [row], rowsAffected: 0 }
            : { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "update" && row) {
          row.invalidated_at = input.params[0];
          row.invalidation_reason = input.params[1];
          return { rows: [], rowsAffected: 1 };
        }
        if (input.operation === "delete") {
          row = undefined;
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        kind: dialect,
        executor: execute,
        transaction: async (callback) => callback({ execute }),
      });
      const options = {
        database,
        maxCommandLogEntries: 2,
        maxEvidenceBundles: 2,
        maxMounts: 2,
        maxSourceVersions: 2,
        now: () => "2026-07-14T12:00:00.000Z",
      } as const;
      const writer = createDatabaseAgentWorkspaceSnapshotRepository(options);
      const reader = createDatabaseAgentWorkspaceSnapshotRepository(options);
      const snapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6f10";
      const created = await writer.create({
        ...baseSnapshotInput(snapshotId),
        permissionSnapshot: {
          accessChannel: "agent",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6f11",
          revision: 3,
          scopes: ["knowledge-spaces:read"],
          subjectId: "subject-1",
          tenantId: "tenant-1",
        },
      });
      await expect(reader.get({ id: snapshotId, tenantId: "tenant-1" })).resolves.toEqual(created);

      const insert = calls.find((call) => call.operation === "insert");
      expect(insert?.sql).toContain("knowledge_space_permission_snapshots");
      const spaceLock = calls.find(
        (call) => call.operation === "select" && call.tableName === "knowledge_spaces",
      );
      expect(spaceLock?.sql).toContain("FOR UPDATE");
      expect(spaceLock?.sql).toContain("lifecycle_state");
      expect(
        calls.find((call) => call.operation === "select" && call.tableName === "deletion_jobs")
          ?.sql,
      ).toContain("active_slot");
      expect(insert?.params.slice(3, 7)).toEqual([
        "subject-1",
        "agent",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6f11",
        3,
      ]);
      const get = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "agent_workspace_snapshots" &&
          !call.sql.includes("ORDER BY"),
      );
      expect(get?.sql).toContain("deletion_jobs");
      expect(get?.sql).toContain("active_slot");

      await writer.invalidateByKnowledgeSpace({
        invalidatedAt: "2026-07-14T12:01:00.000Z",
        knowledgeSpaceId,
        limit: 10,
        reason: "durable-deletion:source",
        tenantId: "tenant-1",
      });
      await expect(reader.get({ id: snapshotId, tenantId: "tenant-1" })).resolves.toBeNull();
      await expect(
        writer.deleteInvalidatedByKnowledgeSpace({
          knowledgeSpaceId,
          limit: 10,
          tenantId: "tenant-1",
        }),
      ).resolves.toEqual({ complete: true, processed: 1 });
      expect(calls.some((call) => call.operation === "delete")).toBe(true);
    });
  }
});

function baseSnapshotInput(id: string) {
  return {
    commandLog: [],
    evidenceBundles: [],
    id,
    indexProjection: {
      fingerprint: "projection-v1",
      projectionIds: [],
    },
    knowledgeSpaceId,
    metadata: {},
    mounts: [baseMount("018f0d60-7a49-7cc2-9c1b-5b36f18f6d01")],
    permissionSnapshot: {
      scopes: ["knowledge-spaces:read"],
      subjectId: "subject-1",
      tenantId: "tenant-1",
    },
    sourceVersions: [],
    tenantId: "tenant-1",
    traceIds: [],
  };
}

function replayPermissionSnapshot() {
  return {
    scopes: ["knowledge-spaces:read"],
    subjectId: "subject-1",
    tenantId: "tenant-1",
  };
}

function baseMount(id: string) {
  return ResourceMountSchema.parse({
    cachePolicy: { strategy: "none" },
    capabilities: ["ls", "cat"],
    createdAt: "2026-05-12T15:58:00.000Z",
    freshnessPolicy: { strategy: "manual" },
    id,
    knowledgeSpaceId,
    metadata: {},
    mode: "read",
    mountPath: "/sources/uploads",
    permissionScope: ["tenant:tenant-1"],
    permissionSnapshotVersion: 1,
    provider: "object-storage",
    resourceType: "source",
    providerResourceKey: `tenant-1/uploads/${id}`,
    sourcePointer: `s3://knowledge-fs/tenant-1/uploads/${id}`,
    tenantId: "tenant-1",
    updatedAt: "2026-05-12T15:58:00.000Z",
  });
}

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6f01";

function evidenceBundle(id: string) {
  return {
    createdAt: "2026-05-12T15:59:00.000Z",
    id,
    items: [],
    missingEvidence: [],
    query: "research",
    state: "partial" as const,
  };
}
