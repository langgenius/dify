import { describe, expect, it } from "vitest";

import {
  createInMemoryRetentionPolicyRepository,
  createKnowledgeSpaceRetentionCleanupWorker,
} from "./retention-policy";

describe("retention policy utilities", () => {
  it("creates clone-isolated default and updated retention policies", async () => {
    let id = 0;
    const repository = createInMemoryRetentionPolicyRepository({
      generateId: () => {
        id += 1;
        return `policy-${id}`;
      },
      maxPolicies: 2,
      now: () => "2026-05-13T00:00:00.000Z",
    });

    const defaultPolicy = await repository.get({ tenantId: "tenant-1" });
    expect(defaultPolicy).toMatchObject({
      answerTraceRetentionDays: 90,
      id: "policy-1",
      knowledgeSpaceId: null,
      scope: "tenant",
      tenantId: "tenant-1",
    });

    const updated = await repository.update({
      patch: { rawDocumentRetentionDays: 365, sessionInactivityMinutes: 60 },
      scope: { tenantId: "tenant-1" },
    });
    expect(updated).toMatchObject({
      rawDocumentRetentionDays: 365,
      sessionInactivityMinutes: 60,
    });

    await expect(repository.get({ tenantId: "tenant-1" })).resolves.toMatchObject({
      rawDocumentRetentionDays: 365,
      sessionInactivityMinutes: 60,
    });
    await expect(
      repository.update({
        patch: { parseArtifactVersions: 0 },
        scope: { tenantId: "tenant-1" },
      }),
    ).rejects.toThrow("Retention policy parseArtifactVersions must be at least 1");
  });

  it("validates and processes bounded knowledge-space cleanup payloads", async () => {
    const enqueued: unknown[] = [];
    const retentionPolicies = createInMemoryRetentionPolicyRepository({
      maxPolicies: 2,
      now: () => "2026-05-13T00:00:00.000Z",
    });
    await retentionPolicies.update({
      patch: { answerTraceRetentionDays: 2, sessionInactivityMinutes: 45 },
      scope: { knowledgeSpaceId: "space-1", tenantId: "tenant-1" },
    });
    const worker = createKnowledgeSpaceRetentionCleanupWorker({
      answerTraces: {
        deleteOlderThan: async () => 1,
      },
      indexProjections: {
        pruneInactiveVersions: async ({ type }) => (type === "dense-vector" ? 2 : 3),
      },
      jobs: {
        enqueue: async (input) => {
          enqueued.push(input);
          return {
            attempts: 0,
            createdAt: Date.parse("2026-05-13T00:00:00.000Z"),
            id: "job-1",
            payload: input.payload,
            status: "queued",
            type: input.type,
            updatedAt: Date.parse("2026-05-13T00:00:00.000Z"),
          };
        },
      },
      maxProjectionDeletes: 4,
      maxTraceDeletes: 5,
      now: () => "2026-05-13T00:00:00.000Z",
      retentionPolicies,
    });

    await expect(
      worker.enqueue({ knowledgeSpaceId: "space-1", tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ id: "job-1" });
    expect(enqueued).toEqual([
      expect.objectContaining({
        idempotencyKey: "retention.cleanup.knowledge-space:tenant-1:space-1",
        type: "retention.cleanup.knowledge-space",
      }),
    ]);

    await expect(
      worker.process({
        knowledgeSpaceId: "space-1",
        maxProjectionDeletes: 4,
        maxTraceDeletes: 5,
        projectionRetainVersions: 1,
        requestedAt: "2026-05-13T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      answerTraceOlderThan: "2026-05-11T00:00:00.000Z",
      answerTracesDeleted: 1,
      denseVectorProjectionsDeleted: 2,
      ftsProjectionsDeleted: 3,
      knowledgeSpaceId: "space-1",
      sessionTtlMinutes: 45,
      tenantId: "tenant-1",
    });
  });
});
