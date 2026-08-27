import { createNodePlatformAdapter } from "@knowledge/adapters";
import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DurableDeletionRepository,
  KnowledgeGatewayOptions,
  SourceSecretStore,
} from "@knowledge/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertApiDurableDeletionDataReadiness,
  createApiDurableDeletionAssembly,
  resolveApiDurableDeletionRuntimeTiming,
  writeDurableDeletionErrorLog,
} from "./durable-deletion-options";

type DatabaseExecuteInput = Parameters<
  KnowledgeGatewayOptions["adapter"]["database"]["execute"]
>[0];

describe("API durable deletion assembly", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a deletion-step budget that covers normal quiescing transactions", () => {
    expect(resolveApiDurableDeletionRuntimeTiming({})).toEqual({
      heartbeatIntervalMs: 35_000,
      leaseMs: 105_000,
      stepTimeoutMs: 30_000,
    });
    expect(
      resolveApiDurableDeletionRuntimeTiming({
        DURABLE_DELETION_STEP_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      heartbeatIntervalMs: 50_000,
      leaseMs: 150_000,
      stepTimeoutMs: 45_000,
    });
  });

  it.each(["", "4999", "120001", "1.5", "not-a-number"])(
    "rejects invalid durable deletion step timeout %j",
    (value) => {
      expect(() =>
        resolveApiDurableDeletionRuntimeTiming({
          DURABLE_DELETION_STEP_TIMEOUT_MS: value,
        }),
      ).toThrow("DURABLE_DELETION_STEP_TIMEOUT_MS");
    },
  );

  it("keeps every destructive worker absent while the rollout gate is off", () => {
    expect(
      createApiDurableDeletionAssembly({
        adapter: createNodePlatformAdapter({ env: {} }),
        enabled: false,
        production: true,
        usesDatabaseRepositories: false,
      }),
    ).toBeUndefined();
  });

  it("fails production startup when any durable boundary is absent", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const repository = repositoryStub();
    const secretStore = secretStoreStub();

    expect(() =>
      createApiDurableDeletionAssembly({
        adapter,
        enabled: true,
        production: true,
        repository,
        secretStore,
        usesDatabaseRepositories: false,
      }),
    ).toThrow("requires database repositories");
    expect(() =>
      createApiDurableDeletionAssembly({
        adapter,
        enabled: true,
        production: true,
        secretStore,
        usesDatabaseRepositories: true,
      }),
    ).toThrow("requires DURABLE_DELETION_HMAC_KEY_BASE64");
    expect(() =>
      createApiDurableDeletionAssembly({
        adapter,
        enabled: true,
        production: true,
        repository,
        usesDatabaseRepositories: true,
      }),
    ).toThrow("requires SourceSecretStore cleanup capability");
  });

  it("does not install a development-only in-memory deletion repository", () => {
    expect(
      createApiDurableDeletionAssembly({
        adapter: createNodePlatformAdapter({ env: {} }),
        enabled: true,
        production: false,
        secretStore: secretStoreStub(),
        usesDatabaseRepositories: false,
      }),
    ).toBeUndefined();
  });

  it("checks no evidence data while rollout is off and accepts a fully scoped rollout", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      kind: "postgres",
    });

    await expect(
      assertApiDurableDeletionDataReadiness({ database, enabled: false }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    await expect(
      assertApiDurableDeletionDataReadiness({ database, enabled: true }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tableName).toBe("evidence_bundles");
  });

  it("fails startup before assembly when an unscoped EvidenceBundle remains", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({ rows: [{ id: "legacy-unscoped" }], rowsAffected: 0 }),
      kind: "postgres",
    });

    await expect(
      assertApiDurableDeletionDataReadiness({ database, enabled: true }),
    ).rejects.toThrow("every evidence bundle to have an unambiguous tenant/space scope");
  });

  it("starts and stops both durable polling loops idempotently", async () => {
    vi.useFakeTimers();
    const repository = repositoryStub();
    const assembly = createApiDurableDeletionAssembly({
      adapter: createNodePlatformAdapter({ env: {} }),
      credentialMode: "dify-managed",
      enabled: true,
      production: true,
      repository,
      usesDatabaseRepositories: true,
    });

    expect(assembly).toBeDefined();
    assembly?.start();
    assembly?.start();
    await Promise.resolve();

    expect(repository.claimJobs).toHaveBeenCalledTimes(1);
    expect(repository.claimOutbox).toHaveBeenCalledTimes(1);

    assembly?.stop();
    assembly?.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repository.claimJobs).toHaveBeenCalledTimes(1);
    expect(repository.claimOutbox).toHaveBeenCalledTimes(1);
  });

  it("logs durable deletion failures with job correlation and the original error", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    writeDurableDeletionErrorLog({
      error: new Error("derived data cleanup failed"),
      job: {
        checkpoint: "deleting_derived_data",
        executionAttempts: 10,
        id: "deletion-job-1",
        knowledgeSpaceId: "knowledge-space-1",
        runState: "failed",
        targetId: "source-1",
        targetType: "source",
      } as never,
    });

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toContain('"event":"knowledge_fs.durable_deletion.failed"');
    expect(write.mock.calls[0]?.[0]).toContain('"jobId":"deletion-job-1"');
    expect(write.mock.calls[0]?.[0]).toContain('"checkpoint":"deleting_derived_data"');
    expect(write.mock.calls[0]?.[0]).toContain('"errorMessage":"derived data cleanup failed"');
  });
});

function secretStoreStub(): Pick<SourceSecretStore, "delete"> {
  return { delete: vi.fn(async () => undefined) };
}

function repositoryStub(): DurableDeletionRepository {
  return {
    advanceCheckpoint: vi.fn(),
    appendInventory: vi.fn(),
    claimItems: vi.fn(async () => []),
    claimJobs: vi.fn(async () => []),
    claimOutbox: vi.fn(async () => []),
    completeItem: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    getJob: vi.fn(async () => null),
    getJobByIdempotency: vi.fn(async () => null),
    getTombstone: vi.fn(async () => null),
    heartbeatJob: vi.fn(),
    markOutboxDispatched: vi.fn(),
    releaseOutbox: vi.fn(),
    requestDocumentDeletion: vi.fn(),
    requestKnowledgeSpaceDeletion: vi.fn(),
    requestSourceDeletion: vi.fn(),
    retryFailedJob: vi.fn(),
    scheduleItemRetry: vi.fn(),
    scheduleJobRetry: vi.fn(),
  } as unknown as DurableDeletionRepository;
}
