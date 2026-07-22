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
      expect(script.calls[1]?.sql).toContain("FOR UPDATE");
      expect(script.calls[1]?.params).toEqual([tenantId, knowledgeSpaceId]);
      script.expectDone();
    });

    it("acquires with database-clock TTL only after the locked deletion admission", async () => {
      const acquired = leaseRow();
      const steps = [
        step("knowledge_spaces", "select", [activeSpaceRow()]),
        step("deletion_jobs", "select", []),
        step("retrieval_execution_leases", "insert", dialect === "postgres" ? [acquired] : [], 1),
        ...(dialect === "tidb" ? [step("retrieval_execution_leases", "select", [acquired])] : []),
      ];
      const script = scriptedDatabase(dialect, steps);
      const repository = createDatabaseRetrievalExecutionLeaseRepository({
        database: script.database,
      });

      await expect(repository.acquire(acquireInput())).resolves.toEqual(lease());
      const insert = script.calls[2];
      expect(insert?.params.slice(0, 6)).toEqual([
        leaseId,
        tenantId,
        knowledgeSpaceId,
        "subject-a",
        traceId,
        leaseToken,
      ]);
      expect(insert?.params[6]).toBe(dialect === "postgres" ? 30_000 : 30_000_000);
      expect(insert?.sql).toContain(
        dialect === "postgres" ? "INTERVAL '1 millisecond'" : "DATE_ADD(CURRENT_TIMESTAMP(3)",
      );
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
      expect(script.calls[0]?.sql).toContain("> CURRENT_TIMESTAMP");
      expect(script.calls[0]?.sql).toContain("NOT EXISTS");
      expect(script.calls[0]?.sql).toContain(identifier(dialect, "active_slot"));
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
        repository.drainExpiredForSpace({ knowledgeSpaceId, limit: 25, tenantId }),
      ).resolves.toEqual({ expired: 1, hasExpiredRemaining: true, hasLive: true });
      expect(script.calls[0]?.params).toEqual([tenantId, knowledgeSpaceId, 25]);
      expect(script.calls[0]?.sql).toContain("FOR UPDATE");
      expect(script.calls[1]?.params).toEqual([tenantId, leaseId, leaseToken, 0]);
      expect(script.calls[1]?.sql).toContain("<= CURRENT_TIMESTAMP");
      expect(script.calls[2]?.sql).toContain("<= CURRENT_TIMESTAMP");
      expect(script.calls[3]?.sql).toContain("> CURRENT_TIMESTAMP");
      script.expectDone();
    });
  },
);

describe("retrieval execution lease coordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("heartbeats in the background, aborts on loss, and rejects further output assertions", async () => {
    vi.useFakeTimers();
    const initial = lease();
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

function identifier(dialect: "postgres" | "tidb", value: string): string {
  return dialect === "postgres" ? `"${value}"` : `\`${value}\``;
}
