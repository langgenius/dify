import type { Source } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { SOURCE_OPERATION_FAILURES } from "./source-operation-error";
import { createInMemorySourceRepository } from "./source-repository";
import type { SourceSyncRunner } from "./source-sync-runner";
import { createSourceSyncScheduler } from "./source-sync-scheduler";

const SPACE = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-08T02:00:00.000Z");

function recordingRunner(): SourceSyncRunner & { synced: Source[] } {
  const synced: Source[] = [];

  return {
    sync: async ({ source }) => {
      synced.push(source);

      return { failed: 0, imported: 1, kind: "website-crawl", skipped: 0 };
    },
    synced,
  };
}

describe("createSourceSyncScheduler", () => {
  it("runs due sources and records syncState with the next run time", async () => {
    const sources = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    // updatedAt anchor 00:00 + everyHours 1 => due at 01:00, now is 02:00 -> due.
    const due = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { syncPolicy: { everyHours: 1 }, tenantId: "tenant-1" },
      name: "due",
      type: "web",
      uri: "u",
    });
    // 00:00 + 6h => 06:00 > 02:00 -> not due.
    await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { syncPolicy: { everyHours: 6 }, tenantId: "tenant-1" },
      name: "not-due",
      type: "web",
      uri: "u",
    });
    // No policy -> ignored entirely.
    await sources.create({ knowledgeSpaceId: SPACE, name: "manual", type: "web", uri: "u" });
    const runner = recordingRunner();
    const scheduler = createSourceSyncScheduler({
      intervalMs: 60_000,
      maxSourcesPerTick: 50,
      now: () => NOW,
      runner,
      sources,
    });

    const result = await scheduler.tick();

    expect(result).toMatchObject({ due: 1, failed: 0, scanned: 3, synced: 1 });
    expect(runner.synced.map((source) => source.name)).toEqual(["due"]);
    const updated = await sources.get({ id: due.id, knowledgeSpaceId: SPACE });
    expect(updated?.metadata.syncState).toEqual({
      lastSyncAt: "2026-07-08T02:00:00.000Z",
      lastSyncStatus: "ok",
      nextSyncAt: "2026-07-08T03:00:00.000Z",
    });

    // Immediately after, nothing is due until nextSyncAt.
    await expect(scheduler.tick()).resolves.toMatchObject({ due: 0, synced: 0 });
  });

  it("skips disabled, in-flight, and tenantless sources", async () => {
    const sources = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { syncPolicy: { everyHours: 1 }, tenantId: "tenant-1" },
      name: "disabled",
      status: "disabled",
      type: "web",
      uri: "u",
    });
    await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        syncPolicy: { everyHours: 1 },
        syncState: {
          nextSyncAt: "2026-07-08T01:00:00.000Z",
          syncStartedAt: "2026-07-08T01:59:00.000Z",
        },
        tenantId: "tenant-1",
      },
      name: "in-flight",
      status: "syncing",
      type: "web",
      uri: "u",
    });
    await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { syncPolicy: { everyHours: 1 } },
      name: "no-tenant",
      type: "web",
      uri: "u",
    });
    const runner = recordingRunner();
    const scheduler = createSourceSyncScheduler({
      intervalMs: 60_000,
      maxSourcesPerTick: 50,
      now: () => NOW,
      runner,
      sources,
    });

    const result = await scheduler.tick();

    expect(result).toMatchObject({
      due: 1,
      skippedInFlight: 1,
      skippedNoTenant: 1,
      synced: 0,
    });
    expect(runner.synced).toEqual([]);
  });

  it("retries a stale in-flight sync and records runner failures", async () => {
    const sources = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const stale = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        syncPolicy: { everyHours: 1 },
        // Started 2h ago (> 30min stale window) -> retried.
        syncState: {
          nextSyncAt: "2026-07-08T01:00:00.000Z",
          syncStartedAt: "2026-07-08T00:00:00.000Z",
        },
        tenantId: "tenant-1",
      },
      name: "stale",
      status: "syncing",
      type: "web",
      uri: "u",
    });
    const scheduler = createSourceSyncScheduler({
      intervalMs: 60_000,
      maxSourcesPerTick: 50,
      now: () => NOW,
      runner: {
        sync: async () => {
          throw new Error("connector down credential-secret");
        },
      },
      sources,
    });

    const result = await scheduler.tick();

    expect(result).toMatchObject({ due: 1, failed: 1, synced: 0 });
    const updated = await sources.get({ id: stale.id, knowledgeSpaceId: SPACE });
    expect(updated?.metadata.syncState).toMatchObject({
      lastSyncError: SOURCE_OPERATION_FAILURES.sync.message,
      lastSyncErrorCode: SOURCE_OPERATION_FAILURES.sync.code,
      lastSyncStatus: "error",
      nextSyncAt: "2026-07-08T03:00:00.000Z",
    });
    expect(JSON.stringify(updated?.metadata)).not.toContain("credential-secret");
  });

  it("refuses to double-run a source freshly claimed by another replica", async () => {
    // Repo clock = scheduler clock, so the concurrent claim below reads as fresh.
    const sources = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T02:00:00.000Z",
    });
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        syncPolicy: { everyHours: 1 },
        syncState: { nextSyncAt: "2026-07-08T01:00:00.000Z" },
        tenantId: "tenant-1",
      },
      name: "contended",
      type: "web",
      uri: "u",
    });
    // Another replica claims between our listing and our claim.
    await sources.claimForSync({
      id: source.id,
      knowledgeSpaceId: SPACE,
      now: "2026-07-08T02:00:00.000Z",
      staleBefore: "2026-07-08T01:30:00.000Z",
    });
    const runner = recordingRunner();
    const scheduler = createSourceSyncScheduler({
      intervalMs: 60_000,
      maxSourcesPerTick: 50,
      now: () => NOW,
      runner,
      sources,
    });

    const result = await scheduler.tick();

    expect(result).toMatchObject({ due: 1, skippedInFlight: 1, synced: 0 });
    expect(runner.synced).toEqual([]);
  });

  it("releases the claim when another replica completed the sync between listing and claiming", async () => {
    const sources = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        syncPolicy: { everyHours: 1 },
        // Fresh truth: already synced, next run in the future.
        syncState: {
          lastSyncAt: "2026-07-08T01:59:00.000Z",
          nextSyncAt: "2026-07-08T02:59:00.000Z",
        },
        tenantId: "tenant-1",
      },
      name: "raced",
      type: "web",
      uri: "u",
    });
    // Stale listing snapshot: still shows the pre-sync nextSyncAt.
    const staleListing = {
      ...sources,
      listAll: async () => ({
        items: [
          {
            ...source,
            metadata: {
              ...source.metadata,
              syncState: { nextSyncAt: "2026-07-08T01:00:00.000Z" },
            },
          },
        ],
      }),
    };
    const runner = recordingRunner();
    const scheduler = createSourceSyncScheduler({
      intervalMs: 60_000,
      maxSourcesPerTick: 50,
      now: () => NOW,
      runner,
      sources: staleListing,
    });

    const result = await scheduler.tick();

    expect(result).toMatchObject({ due: 1, skippedInFlight: 1, synced: 0 });
    expect(runner.synced).toEqual([]);
    // The claim was released: status restored, fresh syncState untouched.
    const after = await sources.get({ id: source.id, knowledgeSpaceId: SPACE });
    expect(after?.status).toBe("active");
    expect(after?.metadata.syncState).toMatchObject({ nextSyncAt: "2026-07-08T02:59:00.000Z" });
  });

  it("rejects invalid scheduler bounds", () => {
    const sources = createInMemorySourceRepository({ maxSources: 1 });
    const runner = recordingRunner();

    expect(() =>
      createSourceSyncScheduler({ intervalMs: 500, maxSourcesPerTick: 10, runner, sources }),
    ).toThrow("intervalMs must be at least 1000");
    expect(() =>
      createSourceSyncScheduler({ intervalMs: 60_000, maxSourcesPerTick: 0, runner, sources }),
    ).toThrow("maxSourcesPerTick must be at least 1");
  });
});
