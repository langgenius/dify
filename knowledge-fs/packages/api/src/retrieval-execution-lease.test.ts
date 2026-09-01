import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RetrievalExecutionAdmissionError,
  type RetrievalExecutionLease,
  RetrievalExecutionLeaseLostError,
  type RetrievalExecutionLeaseRepository,
  createDatabaseRetrievalExecutionLeaseRepository,
  createRetrievalExecutionLeaseCoordinator,
} from "./retrieval-execution-lease";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const leaseId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const leaseToken = "token-a";

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly result: DatabaseExecuteResult;
  readonly tableName: string;
}

describe.each(["postgres", "tidb"] as const)(
  "database retrieval execution lease repository (%s)",
  (dialect) => {
    it("serializes acquisition on the space and rejects an active deletion before insert", async () => {
      const script = scriptedDatabase(dialect, [
        step("knowledge_spaces", "select", [activeSpaceRow()]),
        step("deletion_jobs", "select", [{ id: "deletion-1" }]),
      ]);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(repository.acquire(acquireInput())).rejects.toBeInstanceOf(
        RetrievalExecutionAdmissionError,
      );
      expect(script.calls[0]?.sql).toContain("FOR UPDATE");
      expect(script.calls[0]?.sql).toContain(identifier(dialect, "lifecycle_state"));
      expect(script.calls[1]?.sql).toContain(identifier(dialect, "active_slot"));
      expect(script.calls[1]?.sql).toContain(identifier(dialect, "target_type"));
      expect(script.calls[1]?.sql).toContain("= 'knowledge_space'");
      expect(script.calls[1]?.sql).toContain(identifier(dialect, "target_id"));
      expect(script.calls[1]?.sql).toContain("FOR UPDATE");
      expect(script.calls[1]?.params).toEqual(
        dialect === "postgres"
          ? [tenantId, knowledgeSpaceId]
          : [tenantId, knowledgeSpaceId, knowledgeSpaceId],
      );
      script.expectDone();
    });

    it.each(["source", "logical_document", "document_asset"] as const)(
      "admits retrieval while an unrelated %s deletion is active",
      async (targetType) => {
        const script = targetScopedDeletionDatabase(dialect, targetType);
        const repository = createDatabaseRetrievalExecutionLeaseRepository({
          database: script.database,
        });

        await expect(repository.acquire(acquireInput())).resolves.toEqual(lease());

        const deletionAdmission = script.calls[1];
        expect(deletionAdmission?.sql).toContain(identifier(dialect, "target_type"));
        expect(deletionAdmission?.sql).toContain("= 'knowledge_space'");
        expect(deletionAdmission?.sql).toContain(identifier(dialect, "target_id"));
        expect(deletionAdmission?.params).toEqual(
          dialect === "postgres"
            ? [tenantId, knowledgeSpaceId]
            : [tenantId, knowledgeSpaceId, knowledgeSpaceId],
        );
        expect(script.calls).toHaveLength(dialect === "postgres" ? 5 : 6);
      },
    );

    it("acquires with database-clock TTL only after the locked deletion admission", async () => {
      const acquired = leaseRow();
      const steps = [
        step("knowledge_spaces", "select", [activeSpaceRow()]),
        step("deletion_jobs", "select", []),
        step("deletion_jobs", "select", []),
        step("retrieval_execution_leases", "select", [
          { database_now: "2026-07-14T12:00:00.000Z" },
        ]),
        step("retrieval_execution_leases", "insert", dialect === "postgres" ? [acquired] : [], 1),
        ...(dialect === "tidb" ? [step("retrieval_execution_leases", "select", [acquired])] : []),
      ];
      const script = scriptedDatabase(dialect, steps);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(repository.acquire(acquireInput())).resolves.toEqual(lease());
      const insert = script.calls[4];
      if (!insert) throw new Error("retrieval lease insert missing");
      expect(insert.params).toEqual(
        dialect === "postgres"
          ? [
              leaseId,
              tenantId,
              knowledgeSpaceId,
              "subject-a",
              traceId,
              leaseToken,
              "2026-07-14T12:00:00.000Z",
              30_000,
            ]
          : [
              leaseId,
              tenantId,
              knowledgeSpaceId,
              "subject-a",
              traceId,
              leaseToken,
              30_000_000,
              "2026-07-14T12:00:00.000Z",
            ],
      );
      expect(insert.sql).toContain(
        dialect === "postgres" ? "INTERVAL '1 millisecond'" : "DATE_ADD(",
      );
      if (dialect === "postgres") {
        expect(insert.sql).toContain(
          `SELECT $7::timestamptz AS ${identifier(dialect, "lease_base")}`,
        );
      }
      if (dialect === "tidb") {
        expect(insert.sql.match(/\?/gu)).toHaveLength(insert.params.length);
      }
      script.expectDone();
    });

    it("orders same-millisecond acquisitions strictly across an active child-deletion fence", async () => {
      const deletionFence = "2026-07-14T12:00:00.123Z";
      const postFenceAcquiredAt = "2026-07-14T12:00:00.124Z";
      const acquired = leaseRow({
        acquired_at: postFenceAcquiredAt,
        expires_at: "2026-07-14T12:00:30.124Z",
        heartbeat_at: postFenceAcquiredAt,
        updated_at: postFenceAcquiredAt,
      });
      const script = scriptedDatabase(dialect, [
        step("knowledge_spaces", "select", [activeSpaceRow()]),
        step("deletion_jobs", "select", []),
        step("deletion_jobs", "select", [{ deletion_fence: deletionFence }]),
        step("retrieval_execution_leases", "select", [{ database_now: deletionFence }]),
        step("retrieval_execution_leases", "insert", dialect === "postgres" ? [acquired] : [], 1),
        ...(dialect === "tidb" ? [step("retrieval_execution_leases", "select", [acquired])] : []),
      ]);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(repository.acquire(acquireInput())).resolves.toEqual(
        lease({
          acquiredAt: postFenceAcquiredAt,
          expiresAt: "2026-07-14T12:00:30.124Z",
          heartbeatAt: postFenceAcquiredAt,
          updatedAt: postFenceAcquiredAt,
        }),
      );

      const activeChildFenceRead = script.calls[2];
      const databaseClockRead = script.calls[3];
      const insert = script.calls[4];
      if (!activeChildFenceRead || !databaseClockRead || !insert) {
        throw new Error("retrieval admission reads or insert missing");
      }
      expect(activeChildFenceRead.sql).toContain("COALESCE(");
      expect(activeChildFenceRead.sql).toContain(identifier(dialect, "started_at"));
      expect(activeChildFenceRead.sql).toContain(identifier(dialect, "created_at"));
      expect(activeChildFenceRead.sql).toContain(identifier(dialect, "active_slot"));
      expect(activeChildFenceRead.sql).toContain(
        `${identifier(dialect, "target_type")} <> 'knowledge_space'`,
      );
      expect(activeChildFenceRead.sql).toContain("ORDER BY COALESCE(");
      expect(activeChildFenceRead.sql).toContain("LIMIT 1 FOR UPDATE");
      expect(activeChildFenceRead.sql).not.toContain("MAX(");
      expect(activeChildFenceRead.sql.includes("date_trunc('milliseconds'")).toBe(
        dialect === "postgres",
      );
      expect(databaseClockRead.sql).toContain(
        dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)",
      );
      expect(databaseClockRead.sql).toContain(identifier(dialect, "database_now"));
      expect(insert.params).toEqual(
        dialect === "postgres"
          ? [
              leaseId,
              tenantId,
              knowledgeSpaceId,
              "subject-a",
              traceId,
              leaseToken,
              postFenceAcquiredAt,
              30_000,
            ]
          : [
              leaseId,
              tenantId,
              knowledgeSpaceId,
              "subject-a",
              traceId,
              leaseToken,
              30_000_000,
              postFenceAcquiredAt,
            ],
      );
      if (dialect === "tidb") {
        expect(activeChildFenceRead.sql.match(/\?/gu)).toHaveLength(
          activeChildFenceRead.params.length,
        );
        expect(databaseClockRead.sql.match(/\?/gu) ?? []).toHaveLength(
          databaseClockRead.params.length,
        );
        expect(insert.sql.match(/\?/gu)).toHaveLength(insert.params.length);
        const ttlPlaceholder = insert.sql.indexOf("INTERVAL ? MICROSECOND");
        const leaseBasePlaceholder = insert.sql.indexOf(
          `SELECT ? AS ${identifier(dialect, "lease_base")}`,
        );
        expect(ttlPlaceholder).toBeGreaterThanOrEqual(0);
        expect(leaseBasePlaceholder).toBeGreaterThan(ttlPlaceholder);
        expect(insert.params[6]).toBe(30_000_000);
        expect(insert.params[7]).toBe(postFenceAcquiredAt);
      }

      // A lease admitted before the deletion can share its millisecond and remains drainable;
      // the first lease admitted after the committed child fence is forced into the next tick.
      const preFenceAcquiredAt = deletionFence;
      expect(Date.parse(preFenceAcquiredAt)).toBe(Date.parse(deletionFence));
      expect(Date.parse(postFenceAcquiredAt)).toBeGreaterThan(Date.parse(deletionFence));
      script.expectDone();
    });

    it("uses token plus rowVersion and refuses a stale heartbeat/release ABA fence", async () => {
      const script = scriptedDatabase(dialect, [
        step("retrieval_execution_leases", "update", [], 0),
        step("retrieval_execution_leases", "update", [], 0),
      ]);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(
        repository.heartbeat({
          id: leaseId,
          leaseToken: "stale-token",
          leaseTtlMs: 30_000,
          rowVersion: 0,
          tenantId,
        }),
      ).resolves.toBeNull();
      await expect(
        repository.release({
          id: leaseId,
          leaseToken: "stale-token",
          rowVersion: 0,
          tenantId,
        }),
      ).resolves.toBeNull();

      expect(script.calls).toHaveLength(2);
      for (const call of script.calls) {
        expect(call.sql).toContain(identifier(dialect, "lease_token"));
        expect(call.sql).toContain(identifier(dialect, "row_version"));
        expect(call.params).toContain("stale-token");
      }
      expect(script.calls[0]?.sql).toContain(
        dialect === "postgres" ? "> clock_timestamp()" : "> CURRENT_TIMESTAMP(3)",
      );
      expect(script.calls[0]?.sql).toContain("NOT EXISTS");
      expect(script.calls[0]?.sql).toContain(identifier(dialect, "active_slot"));
      expect(script.calls[0]?.sql).toContain(identifier(dialect, "target_type"));
      expect(script.calls[0]?.sql).toContain("= 'knowledge_space'");
      expect(script.calls[0]?.sql).toContain(identifier(dialect, "target_id"));
      expect(script.calls[0]?.sql).toContain("GREATEST");
      for (const column of ["acquired_at", "heartbeat_at", "updated_at"] as const) {
        expect(script.calls[0]?.sql).toContain(identifier(dialect, column));
      }
      expect(script.calls[1]?.sql).toContain("GREATEST");
      for (const column of ["acquired_at", "heartbeat_at", "updated_at"] as const) {
        expect(script.calls[1]?.sql).toContain(identifier(dialect, column));
      }
      if (dialect === "tidb") {
        expect(script.calls[0]?.params).toEqual([30_000_000, tenantId, leaseId, "stale-token", 0]);
        expect(script.calls[1]?.params).toEqual([tenantId, leaseId, "stale-token", 0]);
        for (const call of script.calls) {
          expect(call.sql.match(/\?/gu)).toHaveLength(call.params.length);
        }
      }
      script.expectDone();
    });

    it("keeps assert and heartbeat active during target-scoped deletion", async () => {
      const asserted = leaseRow();
      const heartbeated = leaseRow({ row_version: 1 });
      const script = scriptedDatabase(dialect, [
        step("retrieval_execution_leases", "select", [asserted]),
        step(
          "retrieval_execution_leases",
          "update",
          dialect === "postgres" ? [heartbeated] : [],
          1,
        ),
        ...(dialect === "tidb"
          ? [step("retrieval_execution_leases", "select", [heartbeated])]
          : []),
      ]);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(
        repository.assertActive({ id: leaseId, leaseToken, rowVersion: 0, tenantId }),
      ).resolves.toEqual(lease());
      await expect(
        repository.heartbeat({
          id: leaseId,
          leaseToken,
          leaseTtlMs: 30_000,
          rowVersion: 0,
          tenantId,
        }),
      ).resolves.toEqual(lease({ rowVersion: 1 }));

      for (const call of script.calls.filter(
        (candidate) =>
          candidate.tableName === "retrieval_execution_leases" &&
          (candidate.operation === "select" || candidate.operation === "update") &&
          candidate.sql.includes("active_deletion"),
      )) {
        expect(call.sql).toContain(identifier(dialect, "target_type"));
        expect(call.sql).toContain("= 'knowledge_space'");
        expect(call.sql).toContain(identifier(dialect, "target_id"));
      }
      script.expectDone();
    });

    it("expires only bounded stale rows and reports remaining stale/live work", async () => {
      const script = scriptedDatabase(dialect, [
        step("retrieval_execution_leases", "select", [
          { id: leaseId, lease_token: leaseToken, row_version: 0 },
        ]),
        step("retrieval_execution_leases", "update", [], 1),
        step("retrieval_execution_leases", "select", [{ id: "expired-remaining" }]),
        step("retrieval_execution_leases", "select", [{ id: "live" }]),
      ]);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(
        repository.drainExpiredForSpace({
          acquiredBefore: "2026-07-14T12:00:10.000Z",
          knowledgeSpaceId,
          limit: 25,
          tenantId,
        }),
      ).resolves.toEqual({ expired: 1, hasExpiredRemaining: true, hasLive: true });
      expect(script.calls[0]?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        "2026-07-14T12:00:10.000Z",
        25,
      ]);
      expect(script.calls[0]?.sql).toContain("FOR UPDATE");
      expect(script.calls[0]?.sql).toContain(`ORDER BY ${identifier(dialect, "expires_at")} ASC`);
      expect(script.calls[1]?.params).toEqual([tenantId, leaseId, leaseToken, 0]);
      expect(script.calls[1]?.sql).toContain("<= CURRENT_TIMESTAMP");
      expect(script.calls[2]?.sql).toContain("<= CURRENT_TIMESTAMP");
      expect(script.calls[3]?.sql).toContain("> CURRENT_TIMESTAMP");
      for (const call of [script.calls[0], script.calls[2], script.calls[3]]) {
        expect(call?.sql).toContain(identifier(dialect, "acquired_at"));
        expect(call?.sql).toContain(dialect === "postgres" ? "$3" : "?");
        expect(call?.params).toContain("2026-07-14T12:00:10.000Z");
      }
      script.expectDone();
    });
  },
);

describe("retrieval execution lease coordinator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("heartbeats in the background, aborts on loss, and rejects further output assertions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const initial = lease({ expiresAt: "2026-07-14T12:00:00.030Z" });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => initial),
      assertActive: vi.fn(async () => initial),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(async () => null),
      release: vi.fn(async () => null),
    };
    const coordinator = createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    });
    const active = await coordinator.acquire({
      knowledgeSpaceId,
      subjectId: "subject-a",
      tenantId,
      traceId,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(active.signal.aborted).toBe(true);
    await expect(active.assertActive()).rejects.toBeInstanceOf(RetrievalExecutionLeaseLostError);
    await expect(active.release()).resolves.toBeUndefined();
    expect(repository.heartbeat).toHaveBeenCalledWith({
      id: leaseId,
      leaseToken,
      leaseTtlMs: 30,
      rowVersion: 0,
      tenantId,
    });
  });

  it("serializes assertion, heartbeat, and ABA-safe release on the latest rowVersion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const initial = lease();
    const asserted = lease({ rowVersion: 1 });
    const released = lease({ rowVersion: 2, status: "released" });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => initial),
      assertActive: vi.fn(async () => asserted),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(async () => lease({ rowVersion: 9 })),
      release: vi.fn(async () => released),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await active.assertActive();
    await active.release();

    expect(repository.release).toHaveBeenCalledWith({
      id: leaseId,
      leaseToken,
      rowVersion: 1,
      tenantId,
    });
    expect(active.signal.aborted).toBe(false);
  });

  it("keeps the lease after one transient heartbeat repository failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const initial = lease({ expiresAt: "2026-07-14T12:00:00.030Z" });
    const recovered = lease({
      expiresAt: "2026-07-14T12:00:00.050Z",
      heartbeatAt: "2026-07-14T12:00:00.020Z",
      rowVersion: 1,
      updatedAt: "2026-07-14T12:00:00.020Z",
    });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => initial),
      assertActive: vi.fn(async () => recovered),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi
        .fn<RetrievalExecutionLeaseRepository["heartbeat"]>()
        .mockRejectedValueOnce(new Error("database connection reset"))
        .mockResolvedValueOnce(recovered),
      release: vi.fn(async () => lease({ rowVersion: 2, status: "released" })),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(10);
    expect(active.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    expect(active.signal.aborted).toBe(false);
    expect(repository.heartbeat).toHaveBeenCalledTimes(2);
    await expect(active.assertActive()).resolves.toBeUndefined();
    await expect(active.release()).resolves.toBeUndefined();
  });

  it("aborts at the last known database expiry when heartbeat failures persist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => lease({ expiresAt: "2026-07-14T12:00:00.030Z" })),
      assertActive: vi.fn(async () => lease({ expiresAt: "2026-07-14T12:00:00.030Z" })),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      release: vi.fn(async () => null),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(20);
    expect(active.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    expect(active.signal.aborted).toBe(true);
    await expect(active.assertActive()).rejects.toBeInstanceOf(RetrievalExecutionLeaseLostError);
    await expect(active.release()).resolves.toBeUndefined();
  });

  it("starts the initial local deadline when a fresh acquired lease is returned", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const monotonicEpoch = Date.now();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now() - monotonicEpoch);
    const databaseClockLease = lease({
      acquiredAt: "2036-07-14T12:00:00.000Z",
      expiresAt: "2036-07-14T12:00:00.030Z",
      heartbeatAt: "2036-07-14T12:00:00.000Z",
      updatedAt: "2036-07-14T12:00:00.000Z",
    });
    let finishAcquire!: (value: RetrievalExecutionLease) => void;
    const pendingAcquire = new Promise<RetrievalExecutionLease>((resolve) => {
      finishAcquire = resolve;
    });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(() => pendingAcquire),
      assertActive: vi.fn(async () => databaseClockLease),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(() => new Promise<null>(() => undefined)),
      release: vi.fn(async () => null),
    };
    const activePromise = createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(100);
    finishAcquire(databaseClockLease);
    const active = await activePromise;
    await vi.advanceTimersByTimeAsync(0);
    expect(active.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(29);
    expect(active.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(active.signal.aborted).toBe(true);
    await expect(active.release()).resolves.toBeUndefined();
  });

  it("aborts on the local deadline even when the heartbeat call never settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const databaseClockLease = lease({
      acquiredAt: "2036-07-14T12:00:00.000Z",
      expiresAt: "2036-07-14T12:00:00.030Z",
      heartbeatAt: "2036-07-14T12:00:00.000Z",
      updatedAt: "2036-07-14T12:00:00.000Z",
    });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => databaseClockLease),
      assertActive: vi.fn(async () => databaseClockLease),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(() => new Promise<null>(() => undefined)),
      release: vi.fn(async () => null),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(30);

    expect(active.signal.aborted).toBe(true);
    expect(repository.heartbeat).toHaveBeenCalledOnce();
    await expect(active.release()).resolves.toBeUndefined();
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("does not extend the local monotonic deadline when assertActive only rereads the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const databaseClockLease = lease({
      acquiredAt: "2036-07-14T12:00:00.000Z",
      expiresAt: "2036-07-14T12:00:00.100Z",
      heartbeatAt: "2036-07-14T12:00:00.000Z",
      updatedAt: "2036-07-14T12:00:00.000Z",
    });
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => databaseClockLease),
      assertActive: vi.fn(async () => lease({ ...databaseClockLease, rowVersion: 1 })),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      release: vi.fn(async () => null),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 90,
      leaseTtlMs: 100,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(20);
    await expect(active.assertActive()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(69);
    expect(active.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(11);
    expect(active.signal.aborted).toBe(true);
    expect(repository.heartbeat).toHaveBeenCalledOnce();
  });

  it("does not let release cancel the local expiry guard behind a hung heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const repository: RetrievalExecutionLeaseRepository = {
      acquire: vi.fn(async () => lease({ expiresAt: "2026-07-14T12:00:00.030Z" })),
      assertActive: vi.fn(async () => lease({ expiresAt: "2026-07-14T12:00:00.030Z" })),
      drainExpiredForSpace: vi.fn(),
      heartbeat: vi.fn(() => new Promise<null>(() => undefined)),
      release: vi.fn(async () => null),
    };
    const active = await createRetrievalExecutionLeaseCoordinator({
      generateId: () => leaseId,
      generateToken: () => leaseToken,
      heartbeatIntervalMs: 10,
      leaseTtlMs: 30,
      repository,
    }).acquire({ knowledgeSpaceId, subjectId: "subject-a", tenantId, traceId });

    await vi.advanceTimersByTimeAsync(10);
    const release = active.release();
    let releaseSettled = false;
    void release.then(() => {
      releaseSettled = true;
    });

    await vi.advanceTimersByTimeAsync(15);
    expect(releaseSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    await Promise.resolve();

    expect(active.signal.aborted).toBe(true);
    expect(releaseSettled).toBe(true);
    expect(repository.release).not.toHaveBeenCalled();
  });
});

function acquireInput() {
  return {
    id: leaseId,
    knowledgeSpaceId,
    leaseToken,
    leaseTtlMs: 30_000,
    subjectId: "subject-a",
    tenantId,
    traceId,
  };
}

function activeSpaceRow() {
  return {
    deletion_job_id: null,
    id: knowledgeSpaceId,
    lifecycle_state: "active",
  };
}

function lease(overrides: Partial<RetrievalExecutionLease> = {}): RetrievalExecutionLease {
  return {
    acquiredAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T12:00:30.000Z",
    heartbeatAt: "2026-07-14T12:00:00.000Z",
    id: leaseId,
    knowledgeSpaceId,
    leaseToken,
    rowVersion: 0,
    status: "active",
    subjectId: "subject-a",
    tenantId,
    traceId,
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function leaseRow(overrides: Record<string, unknown> = {}) {
  return {
    acquired_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-14T12:00:30.000Z",
    heartbeat_at: "2026-07-14T12:00:00.000Z",
    id: leaseId,
    knowledge_space_id: knowledgeSpaceId,
    lease_token: leaseToken,
    row_version: 0,
    status: "active",
    subject_id: "subject-a",
    tenant_id: tenantId,
    trace_id: traceId,
    updated_at: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function step(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rows: readonly Record<string, unknown>[],
  rowsAffected = operation === "select" ? rows.length : 0,
): ScriptStep {
  return { operation, result: { rows, rowsAffected }, tableName };
}

function scriptedDatabase(dialect: "postgres" | "tidb", steps: readonly ScriptStep[]) {
  const remaining = [...steps];
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    const expected = remaining.shift();
    expect(expected, `unexpected ${input.operation} ${input.tableName}`).toBeDefined();
    expect(input.operation).toBe(expected?.operation);
    expect(input.tableName).toBe(expected?.tableName);
    return expected?.result ?? { rows: [], rowsAffected: 0 };
  };
  return {
    calls,
    database: createSchemaDatabaseAdapter({
      executor,
      kind: dialect,
      transaction: async (callback) => callback({ execute: executor }),
    }),
    expectDone: () => expect(remaining).toEqual([]),
  };
}

function targetScopedDeletionDatabase(
  dialect: "postgres" | "tidb",
  targetType: "document_asset" | "logical_document" | "source",
) {
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    if (input.tableName === "knowledge_spaces") {
      return { rows: [activeSpaceRow()], rowsAffected: 1 };
    }
    if (input.tableName === "deletion_jobs") {
      const correctlyScoped =
        input.sql.includes(identifier(dialect, "target_type")) &&
        input.sql.includes("= 'knowledge_space'") &&
        input.sql.includes(identifier(dialect, "target_id"));
      // Model an active child row: a correctly scoped SQL query excludes it, while an accidental
      // space-wide predicate observes it and reproduces the production outage.
      return {
        rows: correctlyScoped
          ? []
          : [
              {
                deletion_fence: "2026-07-14T11:59:59.999Z",
                id: "deletion-1",
                target_type: targetType,
              },
            ],
        rowsAffected: correctlyScoped ? 0 : 1,
      };
    }
    if (input.operation === "insert" && input.tableName === "retrieval_execution_leases") {
      return {
        rows: dialect === "postgres" ? [leaseRow()] : [],
        rowsAffected: 1,
      };
    }
    if (input.operation === "select" && input.tableName === "retrieval_execution_leases") {
      if (input.sql.includes(identifier(dialect, "database_now"))) {
        return {
          rows: [{ database_now: "2026-07-14T12:00:00.000Z" }],
          rowsAffected: 1,
        };
      }
      return { rows: [leaseRow()], rowsAffected: 1 };
    }
    throw new Error(`Unexpected ${input.operation} on ${input.tableName}`);
  };
  return {
    calls,
    database: createSchemaDatabaseAdapter({
      executor,
      kind: dialect,
      transaction: async (callback) => callback({ execute: executor }),
    }),
  };
}

function identifier(dialect: "postgres" | "tidb", value: string): string {
  return dialect === "postgres" ? `"${value}"` : `\`${value}\``;
}
