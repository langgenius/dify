import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { describe, expect, it, vi } from "vitest";

import {
  SourceCredentialMutationError,
  SourceCredentialUnavailableError,
  createSourceCredentialService,
} from "./source-credential-service";
import { SourceVersionConflictError, createInMemorySourceRepository } from "./source-repository";
import {
  type SourceSecretLifecycleRepository,
  createInMemorySourceRetiredSecretCleanupRepository,
} from "./source-retired-secret-cleanup";
import { createSourceRetiredSecretCleanupRuntime } from "./source-retired-secret-cleanup-runtime";
import {
  type SourceSecretStore,
  createEncryptedObjectSourceSecretStore,
} from "./source-secret-store";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const credentialRefA = "source-secret:v1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c51";
const credentialRefB = "source-secret:v1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const operationIdA = "source-credential-operation-a";
const operationIdB = "source-credential-operation-b";
const fixedNow = "2026-01-01T00:00:00.000Z";

describe("SourceCredentialService", () => {
  it("extracts legacy input, persists only a ref, and hydrates a connector-only clone", async () => {
    const { service, sources, storage } = setup();
    const created = await service.create({
      id: sourceId,
      knowledgeSpaceId,
      metadata: {
        credentials: { apiKey: "database-must-not-see-this" },
        pluginId: "crawl-plugin",
        provider: "firecrawl",
      },
      name: "Website",
      tenantId: "tenant-1",
      type: "web",
      uri: "https://example.com",
    });

    expect(created.credentialRef).toMatch(/^source-secret:v1:/u);
    expect(created.metadata).toEqual({ pluginId: "crawl-plugin", provider: "firecrawl" });
    expect(JSON.stringify(await sources.get({ id: sourceId, knowledgeSpaceId }))).not.toContain(
      "database-must-not-see-this",
    );
    const storedObjects = await storage.listObjects({ limit: 10, prefix: "__knowledge-secrets/" });
    const encryptedBytes = await storage.getObject(storedObjects.objects[0]?.key ?? "");
    if (!encryptedBytes) {
      throw new Error("encrypted source secret missing");
    }
    expect(new TextDecoder().decode(encryptedBytes)).not.toContain("database-must-not-see-this");

    const hydrated = await service.resolve({ source: created, tenantId: "tenant-1" });
    expect(hydrated.metadata.credentials).toEqual({ apiKey: "database-must-not-see-this" });
    expect(created.metadata.credentials).toBeUndefined();
  });

  it("rotates with CAS, removes the retired object, and revokes idempotently", async () => {
    const { cleanupRuntime, service, sources, storage } = setup();
    const created = await service.create({
      credentials: { token: "old" },
      id: sourceId,
      knowledgeSpaceId,
      name: "Connector",
      tenantId: "tenant-1",
      type: "connector",
      uri: "connector://docs",
    });
    const firstRef = created.credentialRef;
    const rotated = await service.rotate({
      credentials: { token: "new" },
      expectedVersion: created.version,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    if (!rotated) {
      throw new Error("expected rotated source");
    }
    expect(rotated?.credentialRef).not.toBe(firstRef);
    expect(rotated?.version).toBe(created.version + 1);
    await cleanupRuntime.tick();
    const objectsAfterRotate = await storage.listObjects({
      limit: 10,
      prefix: "__knowledge-secrets/",
    });
    expect(objectsAfterRotate.objects).toHaveLength(1);
    await expect(service.resolve({ source: rotated, tenantId: "tenant-1" })).resolves.toMatchObject(
      {
        metadata: { credentials: { token: "new" } },
      },
    );

    const revoked = await service.revoke({
      expectedVersion: rotated?.version ?? 0,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    expect(revoked?.credentialRef).toBeUndefined();
    await cleanupRuntime.tick();
    expect(
      (await sources.get({ id: sourceId, knowledgeSpaceId }))?.metadata.credentials,
    ).toBeUndefined();
    expect(await storage.listObjects({ limit: 10, prefix: "__knowledge-secrets/" })).toMatchObject({
      objects: [],
    });
  });

  it("fails closed for a missing ref and keeps legacy dual-read isolated to a clone", async () => {
    const { service, sources } = setup();
    const legacy = await sources.create({
      id: sourceId,
      knowledgeSpaceId,
      metadata: { credentials: { token: "legacy" }, provider: "docs" },
      name: "Legacy",
      type: "connector",
      uri: "connector://legacy",
    });
    const hydrated = await service.resolve({ source: legacy, tenantId: "tenant-1" });
    expect(hydrated.metadata.credentials).toEqual({ token: "legacy" });
    expect(legacy.metadata.credentials).toEqual({ token: "legacy" });

    const missing = await sources.update({
      credentialRef: "source-secret:v1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      expectedVersion: legacy.version,
      id: sourceId,
      knowledgeSpaceId,
      metadata: { provider: "docs" },
    });
    if (!missing) {
      throw new Error("expected updated source");
    }
    await expect(service.resolve({ source: missing, tenantId: "tenant-1" })).rejects.toBeInstanceOf(
      SourceCredentialUnavailableError,
    );
  });

  it("durably queues retired refs without rolling the active ref back", async () => {
    const { cleanups, service, sources } = setup();
    const created = await service.create({
      credentials: { token: "old" },
      id: sourceId,
      knowledgeSpaceId,
      name: "Connector",
      tenantId: "tenant-1",
      type: "connector",
      uri: "connector://docs",
    });
    const oldRef = created.credentialRef;
    if (!oldRef) {
      throw new Error("expected credential ref");
    }
    await expect(
      service.rotate({
        credentials: { token: "new" },
        expectedVersion: created.version,
        knowledgeSpaceId,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect((await sources.get({ id: sourceId, knowledgeSpaceId }))?.credentialRef).not.toBe(oldRef);
    const [cleanup] = await cleanups.claim({
      leaseExpiresAt: "2026-01-01T00:01:00.000Z",
      limit: 1,
      now: "2026-01-01T00:00:00.000Z",
      workerId: "test-worker",
    });
    expect(cleanup?.retiredCredentialRef).toBe(oldRef);
  });

  it("reserves each ref before SecretStore.put and activates only after the put", async () => {
    const controlled = controlledSetup();
    const created = await controlled.service.create(createCredentialInput());
    expect(controlled.events).toEqual(["reserve:create", "put", "activate:create"]);
    expect(controlled.put).toHaveBeenLastCalledWith(
      expect.objectContaining({ ref: credentialRefA }),
    );

    controlled.events.length = 0;
    await controlled.service.rotate({
      credentials: { token: "new" },
      expectedVersion: created.version,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    expect(controlled.events).toEqual(["reserve:rotate", "put", "activate:rotate"]);
    expect(controlled.put).toHaveBeenLastCalledWith(
      expect.objectContaining({ ref: credentialRefB }),
    );
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("leaves create and rotate refs staged when SecretStore.put fails", async () => {
    const create = controlledSetup({
      credentialRefs: [credentialRefA],
      operationIds: [operationIdA],
    });
    create.put.mockImplementationOnce(async (value) => {
      await create.baseSecretStore.put(value);
      throw new Error("put acknowledgement unavailable");
    });
    await expect(create.service.create(createCredentialInput())).rejects.toBeInstanceOf(
      SourceCredentialMutationError,
    );
    await expect(
      create.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ operationId: operationIdA, state: "staged" });
    await expect(create.sources.get({ id: sourceId, knowledgeSpaceId })).resolves.toBeNull();
    await expect(
      create.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefA,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect(create.activateCreate).not.toHaveBeenCalled();
    expect(create.deleteSecret).not.toHaveBeenCalled();

    const rotate = controlledSetup();
    const created = await rotate.service.create(createCredentialInput());
    rotate.put.mockRejectedValueOnce(new Error("put acknowledgement unavailable"));
    await expect(
      rotate.service.rotate({
        credentials: { token: "new" },
        expectedVersion: created.version,
        knowledgeSpaceId,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(SourceCredentialMutationError);
    await expect(
      rotate.cleanups.getByRef({ credentialRef: credentialRefB }),
    ).resolves.toMatchObject({ operationId: operationIdB, state: "staged" });
    expect((await rotate.sources.get({ id: sourceId, knowledgeSpaceId }))?.credentialRef).toBe(
      credentialRefA,
    );
    expect(rotate.deleteSecret).not.toHaveBeenCalled();
  });

  it("does not activate a ref when SecretStore.put returns the wrong fingerprint", async () => {
    const controlled = controlledSetup({
      credentialRefs: [credentialRefA],
      operationIds: [operationIdA],
    });
    controlled.put.mockImplementationOnce(async (value) => ({
      ...(await controlled.baseSecretStore.put(value)),
      fingerprint: "0".repeat(64),
    }));

    await expect(controlled.service.create(createCredentialInput())).rejects.toMatchObject({
      code: "SOURCE_CREDENTIAL_MUTATION_FAILED",
      message: "Source credential persistence failed",
    });
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ operationId: operationIdA, state: "staged" });
    await expect(
      controlled.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefA,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect(controlled.activateCreate).not.toHaveBeenCalled();
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("keeps the staged object and returns a stable error when activation did not commit", async () => {
    const controlled = controlledSetup({
      credentialRefs: [credentialRefA],
      operationIds: [operationIdA],
    });
    controlled.activateCreate.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(controlled.service.create(createCredentialInput())).rejects.toMatchObject({
      code: "SOURCE_CREDENTIAL_MUTATION_FAILED",
      message: "Source credential activation failed",
    });
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ operationId: operationIdA, state: "staged" });
    await expect(
      controlled.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefA,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("recovers a committed create after an activation acknowledgement error without deleting", async () => {
    const controlled = controlledSetup({
      credentialRefs: [credentialRefA],
      operationIds: [operationIdA],
    });
    controlled.activateCreate.mockImplementationOnce(async (value) => {
      await controlled.cleanups.activateCreate(value);
      throw new Error("commit acknowledgement lost");
    });

    const created = await controlled.service.create(createCredentialInput());
    expect(created.credentialRef).toBe(credentialRefA);
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ operationId: operationIdA, state: "active" });
    await expect(
      controlled.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefA,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect(controlled.getByRef).toHaveBeenCalledWith({ credentialRef: credentialRefA });
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("recovers a committed rotation after an activation acknowledgement error without deleting", async () => {
    const controlled = controlledSetup();
    const created = await controlled.service.create(createCredentialInput());
    controlled.activateRotateAndRetire.mockImplementationOnce(async (value) => {
      await controlled.cleanups.activateRotateAndRetire(value);
      throw new Error("commit acknowledgement lost");
    });

    const rotated = await controlled.service.rotate({
      credentials: { token: "new" },
      expectedVersion: created.version,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    expect(rotated).toMatchObject({ credentialRef: credentialRefB, version: created.version + 1 });
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ state: "retired" });
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefB }),
    ).resolves.toMatchObject({ operationId: operationIdB, state: "active" });
    await expect(
      controlled.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefB,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeTruthy();
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("preserves CAS conflicts and leaves the losing rotation staged for reconciliation", async () => {
    const controlled = controlledSetup();
    const created = await controlled.service.create(createCredentialInput());
    controlled.reserveStaged.mockClear();
    controlled.put.mockClear();

    await expect(
      controlled.service.rotate({
        credentials: { token: "stale" },
        expectedVersion: created.version - 1,
        knowledgeSpaceId,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(SourceVersionConflictError);
    expect(controlled.reserveStaged).not.toHaveBeenCalled();
    expect(controlled.put).not.toHaveBeenCalled();

    controlled.activateRotateAndRetire.mockImplementationOnce(async (value) => {
      await controlled.sources.update({
        expectedVersion: created.version,
        id: sourceId,
        knowledgeSpaceId,
        name: "Concurrent winner",
      });
      return controlled.cleanups.activateRotateAndRetire(value);
    });
    await expect(
      controlled.service.rotate({
        credentials: { token: "loser" },
        expectedVersion: created.version,
        knowledgeSpaceId,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(SourceVersionConflictError);
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefB }),
    ).resolves.toMatchObject({ state: "staged" });
    expect(controlled.put).toHaveBeenCalledTimes(1);
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
  });

  it("revokes only through the atomic lifecycle transition and is idempotent once empty", async () => {
    const controlled = controlledSetup({
      credentialRefs: [credentialRefA],
      operationIds: [operationIdA],
    });
    const created = await controlled.service.create(createCredentialInput());
    controlled.activateRotateAndRetire.mockClear();
    controlled.reserveStaged.mockClear();
    controlled.put.mockClear();
    controlled.deleteSecret.mockClear();

    const revoked = await controlled.service.revoke({
      expectedVersion: created.version,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    expect(revoked?.credentialRef).toBeUndefined();
    expect(controlled.activateRotateAndRetire).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: created.version,
        newCredentialRef: null,
      }),
    );
    expect(controlled.reserveStaged).not.toHaveBeenCalled();
    expect(controlled.put).not.toHaveBeenCalled();
    expect(controlled.deleteSecret).not.toHaveBeenCalled();
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ state: "retired" });

    const replay = await controlled.service.revoke({
      expectedVersion: revoked?.version ?? 0,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    expect(replay?.version).toBe(revoked?.version);
    expect(controlled.activateRotateAndRetire).toHaveBeenCalledTimes(1);
  });

  it("returns an already-active same operation but never rewrites a deleted reservation", async () => {
    const controlled = controlledSetup({
      credentialRefs: [credentialRefA, credentialRefA, credentialRefA],
      operationIds: [operationIdA, operationIdA, operationIdA],
    });
    const created = await controlled.service.create(createCredentialInput());
    controlled.put.mockClear();
    controlled.activateCreate.mockClear();

    const replay = await controlled.service.create(createCredentialInput());
    expect(replay).toEqual(created);
    expect(controlled.put).not.toHaveBeenCalled();
    expect(controlled.activateCreate).not.toHaveBeenCalled();

    const revoked = await controlled.service.revoke({
      expectedVersion: created.version,
      knowledgeSpaceId,
      sourceId,
      tenantId: "tenant-1",
    });
    if (!revoked) {
      throw new Error("expected revoked source");
    }
    await controlled.cleanupRuntime.tick();
    await expect(
      controlled.cleanups.getByRef({ credentialRef: credentialRefA }),
    ).resolves.toMatchObject({ state: "deleted" });
    controlled.put.mockClear();

    await expect(controlled.service.create(createCredentialInput())).rejects.toMatchObject({
      code: "SOURCE_CREDENTIAL_MUTATION_FAILED",
    });
    expect(controlled.put).not.toHaveBeenCalled();
    await expect(
      controlled.secretStore.get({
        knowledgeSpaceId,
        ref: credentialRefA,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });
});

function setup() {
  let refSequence = 0;
  const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
  const secretStore = createEncryptedObjectSourceSecretStore({
    encryptionKey: new Uint8Array(32).fill(17),
    generateRef: () => {
      refSequence += 1;
      return `source-secret:v1:018f0d60-7a49-7cc2-9c1b-${String(refSequence).padStart(12, "0")}`;
    },
    storage,
  });
  const sources = createInMemorySourceRepository({ maxSources: 10 });
  const cleanups = createInMemorySourceRetiredSecretCleanupRepository({
    maxClaimBatchSize: 10,
    maxJobs: 100,
    now: () => "2026-01-01T00:00:00.000Z",
    sources,
  });
  const cleanupRuntime = createSourceRetiredSecretCleanupRuntime({
    intervalMs: 60_000,
    leaseMs: 30_000,
    maxClaimBatchSize: 10,
    maxRetryCount: 3,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    repository: cleanups,
    secretStore,
    workerId: "test-worker",
  });
  return {
    cleanupRuntime,
    cleanups,
    secretStore,
    service: createSourceCredentialService({ retiredSecrets: cleanups, secretStore, sources }),
    sources,
    storage,
  };
}

function controlledSetup({
  credentialRefs = [credentialRefA, credentialRefB],
  operationIds = [operationIdA, operationIdB],
}: {
  readonly credentialRefs?: readonly string[];
  readonly operationIds?: readonly string[];
} = {}) {
  const events: string[] = [];
  const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
  const baseSecretStore = createEncryptedObjectSourceSecretStore({
    encryptionKey: new Uint8Array(32).fill(23),
    storage,
  });
  const sources = createInMemorySourceRepository({ maxSources: 10, now: () => fixedNow });
  const cleanups = createInMemorySourceRetiredSecretCleanupRepository({
    maxClaimBatchSize: 10,
    maxJobs: 100,
    now: () => fixedNow,
    sources,
  });
  const reserveStaged = vi.fn(
    async (value: Parameters<SourceSecretLifecycleRepository["reserveStaged"]>[0]) => {
      events.push(`reserve:${value.purpose}`);
      return cleanups.reserveStaged(value);
    },
  );
  const activateCreate = vi.fn(
    async (value: Parameters<SourceSecretLifecycleRepository["activateCreate"]>[0]) => {
      events.push("activate:create");
      return cleanups.activateCreate(value);
    },
  );
  const activateRotateAndRetire = vi.fn(
    async (value: Parameters<SourceSecretLifecycleRepository["activateRotateAndRetire"]>[0]) => {
      events.push(value.newCredentialRef ? "activate:rotate" : "activate:revoke");
      return cleanups.activateRotateAndRetire(value);
    },
  );
  const getByRef = vi.fn(
    async (value: Parameters<SourceSecretLifecycleRepository["getByRef"]>[0]) =>
      cleanups.getByRef(value),
  );
  const withWriteAdmission: SourceSecretLifecycleRepository["withWriteAdmission"] = (
    value,
    mutation,
  ) => cleanups.withWriteAdmission(value, mutation);
  const put = vi.fn(async (value: Parameters<SourceSecretStore["put"]>[0]) => {
    events.push("put");
    return baseSecretStore.put(value);
  });
  const deleteSecret = vi.fn(async (value: Parameters<SourceSecretStore["delete"]>[0]) =>
    baseSecretStore.delete(value),
  );
  const secretStore: SourceSecretStore = {
    delete: deleteSecret,
    fingerprint: baseSecretStore.fingerprint,
    get: (value) => baseSecretStore.get(value),
    put,
  };
  let credentialRefIndex = 0;
  let operationIdIndex = 0;
  const service = createSourceCredentialService({
    generateCredentialRef: () => requiredSequenceValue(credentialRefs, credentialRefIndex++),
    generateOperationId: () => requiredSequenceValue(operationIds, operationIdIndex++),
    now: () => fixedNow,
    retiredSecrets: {
      activateCreate,
      activateRotateAndRetire,
      getByRef,
      reserveStaged,
      withWriteAdmission,
    },
    secretStore,
    sources,
  });
  const cleanupRuntime = createSourceRetiredSecretCleanupRuntime({
    intervalMs: 60_000,
    leaseMs: 30_000,
    maxClaimBatchSize: 10,
    maxRetryCount: 3,
    now: () => Date.parse(fixedNow),
    repository: cleanups,
    secretStore,
    workerId: "controlled-test-worker",
  });
  return {
    activateCreate,
    activateRotateAndRetire,
    baseSecretStore,
    cleanupRuntime,
    cleanups,
    deleteSecret,
    events,
    getByRef,
    put,
    reserveStaged,
    secretStore,
    service,
    sources,
    storage,
  };
}

function requiredSequenceValue(values: readonly string[], index: number): string {
  const value = values[index];
  if (!value) {
    throw new Error("Test generator sequence exhausted");
  }
  return value;
}

function createCredentialInput() {
  return {
    credentials: { token: "old" },
    id: sourceId,
    knowledgeSpaceId,
    name: "Connector",
    tenantId: "tenant-1",
    type: "connector" as const,
    uri: "connector://docs",
  };
}
