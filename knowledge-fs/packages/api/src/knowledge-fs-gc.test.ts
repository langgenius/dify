import type { ObjectMetadata, PlatformAdapter } from "@knowledge/core";
import { KnowledgeSpaceStagedCommitSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createKnowledgeFsStagedObjectGcDryRun,
  createKnowledgeFsStagedObjectGcExecutor,
  stagedObjectGcVirtualPath,
} from "./knowledge-fs-gc";
import { createInMemoryKnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import { createKnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import { createInMemoryStagedCommitRepository } from "./staged-commit-repository";

describe("createKnowledgeFsStagedObjectGcDryRun", () => {
  it("lists staged object and expired failed commit cleanup candidates without deleting", async () => {
    const commits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    await commits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T09:00:00.000Z",
        errorCode: "parser_failed",
        errorMessage: "parser failed",
        expiresAt: "2026-05-27T10:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
        idempotencyKey: "failed-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        operationType: "document-upload",
        rawObjectKey: "tenant-1/staged/failed.md",
        sizeBytes: 12,
        status: "failed-terminal",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T09:30:00.000Z",
      }),
    );
    await commits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T09:00:00.000Z",
        expiresAt: "2026-05-27T11:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a02",
        idempotencyKey: "fresh-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        operationType: "document-upload",
        rawObjectKey: "tenant-1/staged/fresh.md",
        sizeBytes: 99,
        status: "failed-terminal",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T09:30:00.000Z",
      }),
    );
    const deleted: string[] = [];
    const objectStorage = stagedObjectStorage(
      [
        {
          key: "tenant-1/staged/orphan-a.md",
          metadata: {},
          sizeBytes: 20,
        },
        {
          key: "tenant-1/staged/orphan-b.md",
          metadata: {},
          sizeBytes: 30,
        },
      ],
      deleted,
    );
    const dryRun = createKnowledgeFsStagedObjectGcDryRun({
      commits,
      generateDryRunId: () => "gc-dry-run-1",
      maxFailedCommitsPerRun: 10,
      maxObjectsPerRun: 10,
      now: () => "2026-05-27T10:30:00.000Z",
      objectStorage,
    });

    const report = await dryRun.preview({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      stagedObjectPrefix: "tenant-1/staged/",
      tenantId: "tenant-1",
    });

    expect(deleted).toEqual([]);
    expect(report.summary).toEqual({
      candidateCount: 3,
      estimatedBytes: 62,
      failedCommitCount: 1,
      stagedObjectCount: 2,
    });
    expect(report.candidates.map((candidate) => candidate.candidateType)).toEqual([
      "staged-object",
      "staged-object",
      "failed-commit",
    ]);
    expect(report.candidates.map((candidate) => candidate.idempotencyKey)).toEqual([
      "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/orphan-a.md",
      "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/orphan-b.md",
      "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:failed-commit:018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
    ]);
  });

  it("resumes object pages and includes expired retryable failed commits", async () => {
    const commits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    await commits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T08:00:00.000Z",
        errorCode: "parser_failed",
        errorMessage: "parser failed",
        expiresAt: "2026-05-27T09:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a03",
        idempotencyKey: "retryable-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        operationType: "document-upload",
        rawObjectKey: "tenant-1/staged/retryable.md",
        sizeBytes: 44,
        status: "failed-retryable",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T08:30:00.000Z",
      }),
    );
    const listCalls: Array<{ readonly cursor?: string; readonly limit: number }> = [];
    const objectStorage: PlatformAdapter["objectStorage"] = {
      kind: "memory",
      close: async () => undefined,
      deleteObject: async () => undefined,
      getObject: async () => null,
      getObjectStream: async () => null,
      health: async () => true,
      headObject: async () => null,
      listObjects: async ({ cursor, limit, prefix }) => {
        listCalls.push({ ...(cursor ? { cursor } : {}), limit });
        return {
          objects: [
            {
              key: `${prefix}resumed.md`,
              metadata: {},
              sizeBytes: 21,
            },
          ],
          ...(cursor ? {} : { nextCursor: "page-2" }),
        };
      },
      putObject: async ({ key }) => ({ key, metadata: {}, sizeBytes: 0 }),
    };
    const dryRun = createKnowledgeFsStagedObjectGcDryRun({
      commits,
      generateDryRunId: () => "gc-dry-run-2",
      maxFailedCommitsPerRun: 10,
      maxObjectsPerRun: 1,
      now: () => "2026-05-27T10:30:00.000Z",
      objectStorage,
    });

    const firstPage = await dryRun.preview({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      stagedObjectPrefix: "tenant-1/staged/",
      tenantId: "tenant-1",
    });
    const secondPage = await dryRun.preview({
      cursor: firstPage.cursor,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      stagedObjectPrefix: "tenant-1/staged/",
      tenantId: "tenant-1",
    });

    expect(listCalls).toEqual([{ limit: 1 }, { cursor: "page-2", limit: 1 }]);
    expect(firstPage.cursor).toEqual(
      Buffer.from(JSON.stringify({ objectCursor: "page-2" })).toString("base64url"),
    );
    expect(secondPage.candidates.map((candidate) => candidate.candidateType)).toEqual([
      "staged-object",
      "failed-commit",
    ]);
    expect(secondPage.summary).toMatchObject({
      candidateCount: 2,
      estimatedBytes: 65,
      failedCommitCount: 1,
      stagedObjectCount: 1,
    });
  });

  it("rejects invalid dry-run bounds and cursors", async () => {
    const commits = createInMemoryStagedCommitRepository({
      maxCommits: 1,
      maxListLimit: 1,
    });

    expect(() =>
      createKnowledgeFsStagedObjectGcDryRun({
        commits,
        generateDryRunId: () => "gc-dry-run-invalid",
        maxFailedCommitsPerRun: 1,
        maxObjectsPerRun: 0,
        objectStorage: stagedObjectStorage([], []),
      }),
    ).toThrow("KnowledgeFS GC dry-run maxObjectsPerRun must be at least 1");
    expect(() =>
      createKnowledgeFsStagedObjectGcDryRun({
        commits,
        generateDryRunId: () => "gc-dry-run-invalid",
        maxFailedCommitsPerRun: 0,
        maxObjectsPerRun: 1,
        objectStorage: stagedObjectStorage([], []),
      }),
    ).toThrow("KnowledgeFS GC dry-run maxFailedCommitsPerRun must be at least 1");

    const dryRun = createKnowledgeFsStagedObjectGcDryRun({
      commits,
      generateDryRunId: () => "gc-dry-run-invalid",
      maxFailedCommitsPerRun: 1,
      maxObjectsPerRun: 1,
      objectStorage: stagedObjectStorage([], []),
    });

    await expect(
      dryRun.preview({
        cursor: "not-base64-json",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        stagedObjectPrefix: "tenant-1/staged/",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS GC dry-run cursor is invalid");
  });
});

describe("createKnowledgeFsStagedObjectGcExecutor", () => {
  it("rejects invalid executor bounds", () => {
    expect(() =>
      createKnowledgeFsStagedObjectGcExecutor({
        maxDeletes: 0,
        objectStorage: stagedObjectStorage([], []),
      }),
    ).toThrow("KnowledgeFS GC maxDeletes must be at least 1");
  });

  it("deletes staged object candidates idempotently and skips active lease conflicts", async () => {
    const deleted: string[] = [];
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    await leases.acquire({
      acquiredAt: "2026-05-27T10:00:00.000Z",
      expiresAt: "2026-05-27T10:30:00.000Z",
      heartbeatAt: "2026-05-27T10:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      leaseType: "publish",
      metadata: {},
      sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      status: "active",
      targetId: "tenant-1/staged/blocked.md",
      targetType: "staged-commit",
      tenantId: "tenant-1",
      updatedAt: "2026-05-27T10:00:00.000Z",
      virtualPath: stagedObjectGcVirtualPath("tenant-1/staged/blocked.md"),
    });
    const executor = createKnowledgeFsStagedObjectGcExecutor({
      maxDeletes: 10,
      objectStorage: stagedObjectStorage([], deleted),
      operationLeases: createKnowledgeFsOperationLeaseCoordinator({
        generateLeaseId: (() => {
          let next = 1;
          return () => `018f0d60-7a49-7cc2-9c1b-5b36f18f9c0${next++}`;
        })(),
        leaseTtlMs: 60_000,
        leases,
        now: () => "2026-05-27T10:01:00.000Z",
        sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      }),
    });

    const result = await executor.execute({
      candidates: [
        {
          candidateType: "staged-object",
          count: 1,
          estimatedBytes: 20,
          idempotencyKey:
            "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/delete.md",
          reason: "test",
          target: {
            objectKey: "tenant-1/staged/delete.md",
            type: "staged-commit",
          },
        },
        {
          candidateType: "staged-object",
          count: 1,
          estimatedBytes: 20,
          idempotencyKey:
            "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/blocked.md",
          reason: "test",
          target: {
            objectKey: "tenant-1/staged/blocked.md",
            type: "staged-commit",
          },
        },
        {
          candidateType: "failed-commit",
          count: 1,
          estimatedBytes: 12,
          idempotencyKey: "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:failed-commit:commit-1",
          reason: "test",
          target: {
            id: "commit-1",
            type: "staged-commit",
          },
        },
      ],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      tenantId: "tenant-1",
    });

    expect(deleted).toEqual(["tenant-1/staged/delete.md"]);
    expect(result).toEqual({
      deleted: 1,
      items: [
        {
          idempotencyKey:
            "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/delete.md",
          objectKey: "tenant-1/staged/delete.md",
          status: "deleted",
        },
        {
          idempotencyKey:
            "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/blocked.md",
          objectKey: "tenant-1/staged/blocked.md",
          status: "skipped-active-lease",
        },
      ],
      skipped: 1,
      tenantId: "tenant-1",
    });
  });

  it("rejects staged object mutation batches that exceed maxDeletes before deleting", async () => {
    const deleted: string[] = [];
    const executor = createKnowledgeFsStagedObjectGcExecutor({
      maxDeletes: 1,
      objectStorage: stagedObjectStorage([], deleted),
    });

    await expect(
      executor.execute({
        candidates: [
          {
            candidateType: "staged-object",
            count: 1,
            estimatedBytes: 20,
            idempotencyKey:
              "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/delete-a.md",
            reason: "test",
            target: {
              objectKey: "tenant-1/staged/delete-a.md",
              type: "staged-commit",
            },
          },
          {
            candidateType: "staged-object",
            count: 1,
            estimatedBytes: 20,
            idempotencyKey:
              "gc:tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:staged-object:tenant-1/staged/delete-b.md",
            reason: "test",
            target: {
              objectKey: "tenant-1/staged/delete-b.md",
              type: "staged-commit",
            },
          },
        ],
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS staged object GC maxDeletes=1 exceeded");
    expect(deleted).toEqual([]);
  });
});

function stagedObjectStorage(
  objects: readonly ObjectMetadata[],
  deleted: string[],
): PlatformAdapter["objectStorage"] {
  return {
    kind: "memory",
    close: async () => undefined,
    deleteObject: async (key) => {
      deleted.push(key);
    },
    getObject: async () => null,
    getObjectStream: async () => null,
    health: async () => true,
    headObject: async () => null,
    listObjects: async ({ limit, prefix }) => ({
      objects: objects.filter((object) => object.key.startsWith(prefix)).slice(0, limit),
    }),
    putObject: async () => {
      throw new Error("dry-run must not write objects");
    },
  };
}
