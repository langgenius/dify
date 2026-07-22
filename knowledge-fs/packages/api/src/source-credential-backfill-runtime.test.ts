import type { Source } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  SourceCredentialBackfillJob,
  SourceCredentialBackfillRepository,
} from "./source-credential-backfill";
import { SourceCredentialBackfillTransitionError } from "./source-credential-backfill";
import {
  type SourceCredentialBackfillRuntimeOptions,
  createSourceCredentialBackfillRuntime,
} from "./source-credential-backfill-runtime";
import {
  type SourceSecretStore,
  SourceSecretStoreConflictError,
  type StoredSourceSecret,
  createSourceCredentialFingerprinter,
} from "./source-secret-store";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "40000000-0000-4000-8000-000000000001";
const candidateRef = "source-secret:v1:50000000-0000-4000-8000-000000000001";
const credentials = { apiKey: "legacy-key", region: "us-east-1" };
const credentialFingerprinter = createSourceCredentialFingerprinter(new Uint8Array(32).fill(42));
const fingerprintCredentials = (value: Readonly<Record<string, unknown>>) =>
  credentialFingerprinter({
    credentials: value,
    knowledgeSpaceId: spaceId,
    sourceId,
    tenantId,
  });

type RuntimeRepository = SourceCredentialBackfillRuntimeOptions["repository"];

describe("source credential backfill runtime", () => {
  it("claims one, renews first, puts only at the durable candidate, then activates atomically", async () => {
    const events: string[] = [];
    const secretStore = memorySecretStore(events);
    const { repository } = runtimeRepository(job(), {
      activateCandidate: vi.fn(async (input) => {
        events.push("activate");
        return transition("activated", job({ rowVersion: input.expectedRowVersion + 1 }));
      }),
      heartbeat: vi.fn(async () => {
        events.push("heartbeat");
        return job({ rowVersion: 2 });
      }),
      withWriteAdmission: async (_input, mutation) => {
        events.push("write.admission");
        return mutation();
      },
    });
    const sources = {
      get: vi.fn(async () => {
        events.push("source.get");
        return source();
      }),
    };

    await expect(createRuntime({ repository, secretStore, sources }).tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      discovered: 0,
      failed: 0,
      migrated: 1,
      refreshed: 0,
      released: 0,
      retried: 0,
    });
    expect(repository.claim).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(events).toEqual([
      "heartbeat",
      "source.get",
      "write.admission",
      "secret.put",
      "activate",
    ]);
    expect(secretStore.put).toHaveBeenCalledWith({
      credentials,
      knowledgeSpaceId: spaceId,
      ref: candidateRef,
      sourceId,
      tenantId,
    });
    expect(repository.activateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCredentialRef: candidateRef,
        expectedRowVersion: 2,
        jobId,
        leaseToken,
      }),
    );
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("restarts after put/commit uncertainty by idempotently writing the same candidate ref", async () => {
    const secretStore = memorySecretStore();
    const first = runtimeRepository(job(), {
      activateCandidate: vi.fn(async () => {
        throw new Error("database acknowledgement unavailable");
      }),
    });

    await expect(
      createRuntime({
        repository: first.repository,
        secretStore,
        sources: sourceReader(source()),
      }).tick(),
    ).resolves.toMatchObject({ completed: 0, retried: 1 });
    expect(first.repository.retryableFailure).toHaveBeenCalledOnce();

    const restarted = runtimeRepository(job({ rowVersion: 4 }));
    await expect(
      createRuntime({
        repository: restarted.repository,
        secretStore,
        sources: sourceReader(source()),
      }).tick(),
    ).resolves.toMatchObject({ completed: 1, migrated: 1 });

    expect(secretStore.put).toHaveBeenCalledTimes(2);
    expect(vi.mocked(secretStore.put).mock.calls.map(([input]) => input.ref)).toEqual([
      candidateRef,
      candidateRef,
    ]);
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("treats an active lifecycle as recovery-only and never rewrites its object", async () => {
    const secretStore = memorySecretStore();
    await secretStore.put({
      credentials,
      knowledgeSpaceId: spaceId,
      ref: candidateRef,
      sourceId,
      tenantId,
    });
    vi.mocked(secretStore.put).mockClear();
    const { repository } = runtimeRepository(job({ candidateLifecycleState: "active" }), {
      activateCandidate: vi.fn(async () => transition("already_active", terminalJob())),
    });

    await expect(
      createRuntime({
        repository,
        secretStore,
        sources: sourceReader(
          source({ credentialRef: candidateRef, metadata: { provider: "example" } }),
        ),
      }).tick(),
    ).resolves.toMatchObject({ completed: 1, migrated: 0 });
    expect(secretStore.get).toHaveBeenCalledWith({
      knowledgeSpaceId: spaceId,
      ref: candidateRef,
      sourceId,
      tenantId,
    });
    expect(secretStore.put).not.toHaveBeenCalled();
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("terminally abandons an active recovery whose object is missing", async () => {
    const secretStore = memorySecretStore();
    const { repository } = runtimeRepository(job({ candidateLifecycleState: "active" }));

    await expect(
      createRuntime({
        repository,
        secretStore,
        sources: sourceReader(source({ credentialRef: candidateRef, metadata: {} })),
      }).tick(),
    ).resolves.toMatchObject({ failed: 1, migrated: 0 });
    expect(repository.abandonCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "SOURCE_CREDENTIAL_BACKFILL_TRANSITION_CONFLICT",
        terminalState: "failed",
      }),
    );
    expect(secretStore.put).not.toHaveBeenCalled();
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("refreshes a changed legacy snapshot without writing or deleting the old candidate", async () => {
    const rotated = { apiKey: "rotated" };
    const secretStore = memorySecretStore();
    const { repository } = runtimeRepository(job());

    await expect(
      createRuntime({
        repository,
        secretStore,
        sources: sourceReader(source({ metadata: { credentials: rotated }, version: 2 })),
      }).tick(),
    ).resolves.toMatchObject({ completed: 0, refreshed: 1 });
    expect(repository.refreshCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCredentialRef: candidateRef,
        secretFingerprint: fingerprintCredentials(rotated),
        sourceVersion: 2,
      }),
    );
    expect(secretStore.put).not.toHaveBeenCalled();
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["missing source", null],
    ["another active ref", source({ credentialRef: "source-secret:v1:other", metadata: {} })],
    ["legacy credentials removed", source({ metadata: {} })],
  ])("atomically abandons when %s", async (_label, value) => {
    const secretStore = memorySecretStore();
    const { repository } = runtimeRepository(job());

    await expect(
      createRuntime({ repository, secretStore, sources: sourceReader(value) }).tick(),
    ).resolves.toMatchObject({ completed: 1, migrated: 0 });
    expect(repository.abandonCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCredentialRef: candidateRef, terminalState: "succeeded" }),
    );
    expect(secretStore.put).not.toHaveBeenCalled();
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("does no external work after the initial lease renewal is lost", async () => {
    const onError = vi.fn();
    const secretStore = memorySecretStore();
    const { repository } = runtimeRepository(job(), {
      abandonCandidate: vi.fn(async () => {
        throw new SourceCredentialBackfillTransitionError("stale lease");
      }),
      heartbeat: vi.fn(async () => {
        throw new SourceCredentialBackfillTransitionError("lease replaced");
      }),
    });
    const sources = sourceReader(source());

    await expect(
      createRuntime({ onError, repository, secretStore, sources }).tick(),
    ).resolves.toMatchObject({ claimed: 1, completed: 0, failed: 0 });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(sources.get).not.toHaveBeenCalled();
    expect(secretStore.put).not.toHaveBeenCalled();
    expect(secretStore.delete).not.toHaveBeenCalled();
  });

  it("terminally abandons conflicts and redacts arbitrary storage failures at retry exhaustion", async () => {
    for (const failure of [
      new SourceSecretStoreConflictError(),
      new Error(`provider echoed ${credentials.apiKey}`),
    ]) {
      const secretStore = memorySecretStore();
      vi.mocked(secretStore.put).mockRejectedValueOnce(failure);
      const { repository } = runtimeRepository(
        job({ retryCount: failure instanceof SourceSecretStoreConflictError ? 0 : 5 }),
      );

      await expect(
        createRuntime({ repository, secretStore, sources: sourceReader(source()) }).tick(),
      ).resolves.toMatchObject({ failed: 1 });
      expect(repository.abandonCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: "Source credential backfill operation failed",
          terminalState: "failed",
        }),
      );
      expect(JSON.stringify(vi.mocked(repository.abandonCandidate).mock.calls)).not.toContain(
        credentials.apiKey,
      );
      expect(secretStore.delete).not.toHaveBeenCalled();
    }
  });
});

function createRuntime(input: {
  readonly onError?: SourceCredentialBackfillRuntimeOptions["onError"];
  readonly repository: RuntimeRepository;
  readonly secretStore: SourceSecretStore;
  readonly sources: SourceCredentialBackfillRuntimeOptions["sources"];
}) {
  const ticks = Array.from(
    { length: 20 },
    (_, index) => Date.parse("2026-07-14T00:00:00.000Z") + index * 100,
  );
  return createSourceCredentialBackfillRuntime({
    discoveryBatchSize: 5,
    intervalMs: 1_000,
    leaseMs: 30_000,
    maxClaimBatchSize: 2,
    maxRetryCount: 5,
    now: () => ticks.shift() ?? Date.parse("2026-07-14T00:00:10.000Z"),
    ...input,
    workerId: "worker-1",
  });
}

function runtimeRepository(
  initial: SourceCredentialBackfillJob,
  overrides: Partial<RuntimeRepository> = {},
) {
  let current = initial;
  const repository: RuntimeRepository = {
    abandonCandidate: vi.fn(async (input) =>
      transition("abandoned", {
        ...terminalJob(current, input.terminalState),
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
      }),
    ),
    activateCandidate: vi.fn(async () => transition("activated", terminalJob(current))),
    claim: vi.fn(async () => [current]),
    discover: vi.fn(async () => ({ created: 0, scanned: 0 })),
    heartbeat: vi.fn(async () => {
      current = { ...current, rowVersion: current.rowVersion + 1 };
      return current;
    }),
    refreshCandidate: vi.fn(async () =>
      transition("refreshed", { ...current, runState: "queued" }),
    ),
    retryableFailure: vi.fn(async () => ({ ...current, runState: "queued" as const })),
    withWriteAdmission: (_input, mutation) => mutation(),
    ...overrides,
  };
  return { repository };
}

function transition(
  outcome: "abandoned" | "activated" | "already_active" | "refreshed",
  value: SourceCredentialBackfillJob,
): Awaited<ReturnType<SourceCredentialBackfillRepository["activateCandidate"]>> {
  return { job: value, outcome };
}

function job(overrides: Partial<SourceCredentialBackfillJob> = {}): SourceCredentialBackfillJob {
  return {
    candidateCredentialRef: candidateRef,
    candidateLifecycleState: "candidate",
    createdAt: "2026-07-14T00:00:00.000Z",
    heartbeatAt: "2026-07-14T00:00:00.000Z",
    id: jobId,
    knowledgeSpaceId: spaceId,
    leaseExpiresAt: "2026-07-14T00:01:00.000Z",
    leaseToken,
    retryCount: 0,
    rowVersion: 1,
    runState: "running",
    secretFingerprint: fingerprintCredentials(credentials),
    sourceId,
    sourceVersion: 1,
    tenantId,
    updatedAt: "2026-07-14T00:00:00.000Z",
    workerId: "worker-1",
    ...overrides,
  };
}

function terminalJob(
  value: SourceCredentialBackfillJob = job(),
  runState: "failed" | "succeeded" = "succeeded",
): SourceCredentialBackfillJob {
  return {
    ...value,
    completedAt: "2026-07-14T00:00:03.000Z",
    runState,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    id: sourceId,
    knowledgeSpaceId: spaceId,
    metadata: { credentials, provider: "example" },
    name: "legacy",
    permissionScope: [],
    status: "active",
    type: "connector",
    updatedAt: "2026-07-14T00:00:00.000Z",
    uri: "connector://legacy",
    version: 1,
    ...overrides,
  };
}

function sourceReader(value: Source | null) {
  return { get: vi.fn(async () => value) };
}

function memorySecretStore(events?: string[]): SourceSecretStore {
  const values = new Map<string, StoredSourceSecret>();
  return {
    delete: vi.fn(async ({ ref }) => {
      events?.push("secret.delete");
      values.delete(ref);
    }),
    fingerprint: credentialFingerprinter,
    get: vi.fn(async ({ ref }) => values.get(ref) ?? null),
    put: vi.fn(async ({ credentials: value, ref = candidateRef }) => {
      events?.push("secret.put");
      const existing = values.get(ref);
      if (existing) return existing;
      const stored = {
        credentials: JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
        fingerprint: credentialFingerprinter({
          credentials: value,
          knowledgeSpaceId: spaceId,
          sourceId,
          tenantId,
        }),
        ref,
      };
      values.set(ref, stored);
      return stored;
    }),
  };
}
