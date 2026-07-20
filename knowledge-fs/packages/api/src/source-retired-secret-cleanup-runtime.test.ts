import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { describe, expect, it } from "vitest";

import { createInMemorySourceRepository } from "./source-repository";
import {
  type SourceSecretLifecycleRepository,
  createInMemorySourceRetiredSecretCleanupRepository,
} from "./source-retired-secret-cleanup";
import { createSourceRetiredSecretCleanupRuntime } from "./source-retired-secret-cleanup-runtime";
import {
  type SourceSecretStore,
  createEncryptedObjectSourceSecretStore,
} from "./source-secret-store";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const oldRef = "source-secret:v1:10000000-0000-4000-8000-000000000001";
const middleRef = "source-secret:v1:10000000-0000-4000-8000-000000000002";
const activeRef = "source-secret:v1:10000000-0000-4000-8000-000000000003";
const candidateRef = "source-secret:v1:10000000-0000-4000-8000-000000000004";
const stagedRef = "source-secret:v1:10000000-0000-4000-8000-000000000005";
const baseTime = Date.parse("2026-07-14T00:00:00.000Z");
const intervalMs = 60_000;
const leaseMs = 30_000;

describe("SourceRetiredSecretCleanupRuntime", () => {
  it("reconciles and deletes a staged partial put in the same tick", async () => {
    const setup = lifecycleSetup();
    await putSecret(setup.secretStore, stagedRef, "partial");
    await setup.repository.reserveStaged({
      credentialRef: stagedRef,
      knowledgeSpaceId,
      operationId: "partial-create-request",
      purpose: "create",
      recoverAfter: iso(setup.clock.value),
      sourceId,
      tenantId,
    });

    await expect(runtime(setup, "partial-put-worker").tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });
    await expect(setup.repository.getByRef({ credentialRef: stagedRef })).resolves.toMatchObject({
      state: "deleted",
    });
    await expect(readSecret(setup.secretStore, stagedRef)).resolves.toBeNull();
  });

  it("does not claim active or live candidate references", async () => {
    let candidateInUse = false;
    const setup = lifecycleSetup((ref) => Promise.resolve(candidateInUse && ref === candidateRef));
    await createActiveSource(setup, activeRef);
    await putSecret(setup.secretStore, candidateRef, "candidate");
    await setup.repository.reserveCandidate({
      credentialRef: candidateRef,
      knowledgeSpaceId,
      operationId: "30000000-0000-4000-8000-000000000099",
      recoverAfter: iso(setup.clock.value),
      sourceId,
      tenantId,
    });
    candidateInUse = true;
    let deleteCalls = 0;
    const secretStore: SourceSecretStore = {
      ...setup.secretStore,
      delete: async (input) => {
        deleteCalls += 1;
        return setup.secretStore.delete(input);
      },
    };

    await expect(runtime(setup, "reference-guard-worker", { secretStore }).tick()).resolves.toEqual(
      {
        claimed: 0,
        completed: 0,
        failed: 0,
        retried: 0,
      },
    );
    expect(deleteCalls).toBe(0);
    await expect(setup.repository.getByRef({ credentialRef: activeRef })).resolves.toMatchObject({
      state: "active",
    });
    await expect(setup.repository.getByRef({ credentialRef: candidateRef })).resolves.toMatchObject(
      { state: "candidate" },
    );
    await expect(readSecret(setup.secretStore, activeRef)).resolves.not.toBeNull();
    await expect(readSecret(setup.secretStore, candidateRef)).resolves.not.toBeNull();
  });

  it("claims one reference and synchronously renews its fence before deletion", async () => {
    const setup = lifecycleSetup();
    const created = await createActiveSource(setup, oldRef);
    const onceRotated = await rotateActiveSource(setup, created.version, middleRef);
    await rotateActiveSource(setup, onceRotated.version, activeRef);
    const events: string[] = [];
    const repository = instrumentRepository(setup.repository, events);
    const secretStore: SourceSecretStore = {
      ...setup.secretStore,
      delete: async (input) => {
        events.push("delete");
        return setup.secretStore.delete(input);
      },
    };

    await expect(
      runtime(setup, "claim-one-worker", { repository, secretStore }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0 });
    expect(events).toEqual(["reconcile", "begin", "renew", "delete", "complete"]);

    const retiredStates = await Promise.all(
      [oldRef, middleRef].map((credentialRef) =>
        setup.repository.getByRef({ credentialRef }).then((row) => row?.state),
      ),
    );
    expect(retiredStates.sort()).toEqual(["deleted", "retired"]);
  });

  it("does not delete when the synchronous renewal fence is stale", async () => {
    const setup = await rotatedLifecycle();
    let deleteCalls = 0;
    let invalidateFence = true;
    const repository: RuntimeRepository = {
      ...setup.repository,
      renewDelete: async (input) => {
        if (invalidateFence) {
          invalidateFence = false;
          await setup.repository.renewDelete(input);
        }
        return setup.repository.renewDelete(input);
      },
    };
    const secretStore: SourceSecretStore = {
      ...setup.secretStore,
      delete: async (input) => {
        deleteCalls += 1;
        return setup.secretStore.delete(input);
      },
    };

    await expect(
      runtime(setup, "stale-fence-worker", { repository, secretStore }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 0, failed: 1, retried: 0 });
    expect(deleteCalls).toBe(0);
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "deleting",
    });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.not.toBeNull();
  });

  it("persists generalized failures with exponential backoff and resumes after restart", async () => {
    const setup = await rotatedLifecycle();
    let remainingFailures = 2;
    const failingStore: SourceSecretStore = {
      ...setup.secretStore,
      delete: async (input) => {
        if (input.ref === oldRef && remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error("vault signed-url=https://secret.invalid?token=must-not-persist");
        }
        return setup.secretStore.delete(input);
      },
    };

    await expect(
      runtime(setup, "worker-before-restart", { secretStore: failingStore }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 0, failed: 0, retried: 1 });
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      deleteAttempts: 1,
      lastErrorCode: "SOURCE_SECRET_DELETE_FAILED",
      lastErrorMessage: "Source secret deletion failed",
      nextDeleteAt: iso(baseTime + intervalMs),
      state: "retired",
    });

    setup.clock.value = baseTime + intervalMs;
    await expect(
      runtime(setup, "worker-after-first-restart", { secretStore: failingStore }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 0, failed: 0, retried: 1 });
    const afterSecondFailure = await setup.repository.getByRef({ credentialRef: oldRef });
    expect(afterSecondFailure).toMatchObject({
      deleteAttempts: 2,
      lastErrorCode: "SOURCE_SECRET_DELETE_FAILED",
      lastErrorMessage: "Source secret deletion failed",
      nextDeleteAt: iso(baseTime + intervalMs + intervalMs * 2),
      state: "retired",
    });
    expect(JSON.stringify(afterSecondFailure)).not.toContain("must-not-persist");

    setup.clock.value = baseTime + intervalMs + intervalMs * 2 - 1;
    await expect(
      runtime(setup, "worker-too-early", { secretStore: failingStore }).tick(),
    ).resolves.toMatchObject({ claimed: 0, completed: 0 });

    setup.clock.value += 1;
    await expect(
      runtime(setup, "worker-after-second-restart", { secretStore: failingStore }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0 });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.toBeNull();
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "deleted",
    });
  });

  it("replays an already-missing object after a crash before completeDelete", async () => {
    const setup = await rotatedLifecycle();
    let simulateCrash = true;
    const crashRepository: RuntimeRepository = {
      ...setup.repository,
      completeDelete: async (input) => {
        if (simulateCrash) {
          simulateCrash = false;
          throw new Error("process stopped before lifecycle completion");
        }
        return setup.repository.completeDelete(input);
      },
    };

    await expect(
      runtime(setup, "worker-before-crash", { repository: crashRepository }).tick(),
    ).resolves.toEqual({ claimed: 1, completed: 0, failed: 1, retried: 0 });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.toBeNull();
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "deleting",
    });

    setup.clock.value += leaseMs + 1;
    await expect(runtime(setup, "worker-after-crash").tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "deleted",
    });
  });

  it("periodically scrubs a deleted tombstone after a stale worker writes the ref late", async () => {
    const setup = await rotatedLifecycle();

    await expect(runtime(setup, "worker-before-late-write").tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      nextDeleteAt: iso(baseTime + intervalMs),
      state: "deleted",
    });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.toBeNull();

    // Models a put that began under an old lease, completed after refresh/retire/delete, and then
    // crashed before the stale worker could perform any compensating transition.
    await putSecret(setup.secretStore, oldRef, "stale-worker-late-write");
    setup.clock.value = baseTime + intervalMs - 1;
    await expect(runtime(setup, "worker-before-tombstone-scrub").tick()).resolves.toMatchObject({
      claimed: 0,
    });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.not.toBeNull();

    setup.clock.value += 1;
    await expect(runtime(setup, "worker-after-tombstone-scrub").tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });
    await expect(readSecret(setup.secretStore, oldRef)).resolves.toBeNull();
    await expect(setup.repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      nextDeleteAt: iso(baseTime + intervalMs * 2),
      state: "deleted",
    });
  });
});

type RuntimeRepository = Parameters<
  typeof createSourceRetiredSecretCleanupRuntime
>[0]["repository"];

interface LifecycleSetup {
  readonly clock: { value: number };
  readonly repository: ReturnType<typeof createInMemorySourceRetiredSecretCleanupRepository>;
  readonly secretStore: SourceSecretStore;
  readonly sources: ReturnType<typeof createInMemorySourceRepository>;
}

function lifecycleSetup(
  candidateReferenceInUse?: (ref: string) => Promise<boolean>,
): LifecycleSetup {
  const clock = { value: baseTime };
  let lifecycleSequence = 0;
  let leaseSequence = 0;
  const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
  const secretStore = createEncryptedObjectSourceSecretStore({
    encryptionKey: new Uint8Array(32).fill(19),
    storage,
  });
  const sources = createInMemorySourceRepository({ maxSources: 10 });
  const repository = createInMemorySourceRetiredSecretCleanupRepository({
    ...(candidateReferenceInUse ? { candidateReferenceInUse } : {}),
    generateId: () => sequenceUuid("30000000", ++lifecycleSequence),
    generateLeaseToken: () => sequenceUuid("40000000", ++leaseSequence),
    maxClaimBatchSize: 10,
    maxJobs: 100,
    now: () => iso(clock.value),
    sources,
  });
  return { clock, repository, secretStore, sources };
}

async function rotatedLifecycle(): Promise<LifecycleSetup> {
  const setup = lifecycleSetup();
  const created = await createActiveSource(setup, oldRef);
  await rotateActiveSource(setup, created.version, activeRef);
  return setup;
}

async function createActiveSource(setup: LifecycleSetup, credentialRef: string) {
  await putSecret(setup.secretStore, credentialRef, "active");
  const operationId = `create:${credentialRef}`;
  await setup.repository.reserveStaged({
    credentialRef,
    knowledgeSpaceId,
    operationId,
    purpose: "create",
    recoverAfter: iso(setup.clock.value + intervalMs),
    sourceId,
    tenantId,
  });
  return setup.repository.activateCreate({
    operationId,
    reservedCredentialRef: credentialRef,
    source: {
      id: sourceId,
      knowledgeSpaceId,
      name: "Connector",
      type: "connector",
      uri: "connector://docs",
    },
    tenantId,
  });
}

async function rotateActiveSource(
  setup: LifecycleSetup,
  expectedVersion: number,
  credentialRef: string,
) {
  await putSecret(setup.secretStore, credentialRef, `rotated-${expectedVersion}`);
  const operationId = `rotate:${credentialRef}`;
  await setup.repository.reserveStaged({
    credentialRef,
    knowledgeSpaceId,
    operationId,
    purpose: "rotate",
    recoverAfter: iso(setup.clock.value + intervalMs),
    sourceId,
    tenantId,
  });
  const updated = await setup.repository.activateRotateAndRetire({
    expectedVersion,
    knowledgeSpaceId,
    metadata: {},
    newCredentialRef: credentialRef,
    operationId,
    sourceId,
    tenantId,
  });
  if (!updated) {
    throw new Error("expected rotated source");
  }
  return updated;
}

function runtime(
  setup: LifecycleSetup,
  workerId: string,
  overrides: {
    readonly repository?: RuntimeRepository | undefined;
    readonly secretStore?: SourceSecretStore | undefined;
  } = {},
) {
  return createSourceRetiredSecretCleanupRuntime({
    heartbeatIntervalMs: 10_000,
    intervalMs,
    leaseMs,
    maxClaimBatchSize: 10,
    maxRetryCount: 3,
    now: () => setup.clock.value,
    repository: overrides.repository ?? setup.repository,
    secretStore: overrides.secretStore ?? setup.secretStore,
    workerId,
  });
}

function instrumentRepository(
  repository: SourceSecretLifecycleRepository,
  events: string[],
): RuntimeRepository {
  return {
    beginDelete: async (input) => {
      events.push("begin");
      return repository.beginDelete(input);
    },
    completeDelete: async (input) => {
      events.push("complete");
      return repository.completeDelete(input);
    },
    reconcileExpiredStaged: async (input) => {
      events.push("reconcile");
      return repository.reconcileExpiredStaged(input);
    },
    renewDelete: async (input) => {
      events.push("renew");
      return repository.renewDelete(input);
    },
    retryDelete: async (input) => {
      events.push("retry");
      return repository.retryDelete(input);
    },
  };
}

function putSecret(secretStore: SourceSecretStore, ref: string, token: string) {
  return secretStore.put({
    credentials: { token },
    knowledgeSpaceId,
    ref,
    sourceId,
    tenantId,
  });
}

function readSecret(secretStore: SourceSecretStore, ref: string) {
  return secretStore.get({ knowledgeSpaceId, ref, sourceId, tenantId });
}

function sequenceUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
