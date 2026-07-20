import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createInMemoryKnowledgeFsLeaseRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryStagedCommitRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const unknownSpaceId = "00000000-0000-4000-8000-00000000dead";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

function createAuth() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [readToken]: { scopes: ["knowledge-spaces:read"], subjectId: "u1", tenantId: "tenant-1" },
      [writeToken]: { scopes: ["knowledge-spaces:*"], subjectId: "u1", tenantId: "tenant-1" },
    },
  });
}

type GatewayOptions = Omit<Parameters<typeof createKnowledgeGateway>[0], "adapter" | "auth"> & {
  adapter?: Parameters<typeof createKnowledgeGateway>[0]["adapter"];
};

function createApp(options: GatewayOptions = {}) {
  const { adapter, ...rest } = options;
  return createKnowledgeGateway({
    adapter: adapter ?? createNodePlatformAdapter({ env: {} }),
    auth: createAuth(),
    ...rest,
  });
}

async function createSpace(app: ReturnType<typeof createApp>, slug = "space"): Promise<string> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: `Space ${slug}`, slug }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

describe("knowledge space operator handlers coverage", () => {
  it("returns 404 for operator diagnostics on unknown spaces", async () => {
    const app = createApp();
    await createSpace(app);

    const notFoundRequests: [string, RequestInit | undefined][] = [
      [`/knowledge-spaces/${unknownSpaceId}/manifest`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/status`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/stats`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/gc/staged-objects`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/leases/active`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/staged-commits`, undefined],
      [
        `/knowledge-spaces/${unknownSpaceId}/gc/staged-objects/execute`,
        {
          body: JSON.stringify({ candidates: [] }),
          headers: json(writeToken),
          method: "POST",
        },
      ],
    ];

    for (const [path, init] of notFoundRequests) {
      const response = await app.request(path, init ?? { headers: bearer(writeToken) });
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Knowledge space not found" });
    }
  });

  it("rejects diagnostic list limits beyond the repository bounds", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const spaceList = await app.request("/knowledge-spaces?limit=101", {
      headers: bearer(readToken),
    });
    expect(spaceList.status).toBe(400);
    await expect(spaceList.json()).resolves.toEqual({
      error: "Knowledge space list limit exceeds maxListLimit=100",
    });

    const leaseList = await app.request(`/knowledge-spaces/${spaceId}/leases/active?limit=101`, {
      headers: bearer(readToken),
    });
    expect(leaseList.status).toBe(400);

    const commitList = await app.request(`/knowledge-spaces/${spaceId}/staged-commits?limit=101`, {
      headers: bearer(readToken),
    });
    expect(commitList.status).toBe(400);
  });

  it("rejects slug updates that collide with another space", async () => {
    const app = createApp();
    await createSpace(app, "space-a");
    const spaceBId = await createSpace(app, "space-b");

    const response = await app.request(`/knowledge-spaces/${spaceBId}`, {
      body: JSON.stringify({ expectedRevision: 1, slug: "space-a" }),
      headers: json(writeToken),
      method: "PATCH",
    });

    expect(response.status).toBe(409);
  });

  it("surfaces failed staged commits with optional error codes and expirations", async () => {
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 100,
      maxListLimit: 100,
    });
    const app = createApp({ stagedCommits });
    const spaceId = await createSpace(app);
    const recentIso = new Date().toISOString();
    const commitBase = {
      createdAt: recentIso,
      idempotencyKey: "commit-key",
      knowledgeSpaceId: spaceId,
      operationType: "document-upload" as const,
      tenantId: "tenant-1",
    };
    await stagedCommits.create({
      ...commitBase,
      errorCode: "E_RETRY",
      expiresAt: "2030-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000101",
      idempotencyKey: "commit-key-1",
      status: "failed-retryable",
      updatedAt: recentIso,
    });
    await stagedCommits.create({
      ...commitBase,
      id: "00000000-0000-4000-8000-000000000102",
      idempotencyKey: "commit-key-2",
      status: "failed-terminal",
      updatedAt: recentIso,
    });
    await stagedCommits.create({
      ...commitBase,
      createdAt: "2020-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000103",
      idempotencyKey: "commit-key-3",
      status: "failed-terminal",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    const statusResponse = await app.request(`/knowledge-spaces/${spaceId}/status`, {
      headers: bearer(readToken),
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.failedCommits.count).toBe(3);
    expect(status.failedCommits.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: "E_RETRY",
          expiresAt: "2030-01-01T00:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000101",
          status: "failed-retryable",
        }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000102",
          status: "failed-terminal",
        }),
      ]),
    );
    const terminalItem = status.failedCommits.items.find(
      (item: { id: string }) => item.id === "00000000-0000-4000-8000-000000000102",
    );
    expect(terminalItem).not.toHaveProperty("errorCode");
    expect(terminalItem).not.toHaveProperty("expiresAt");

    const statsResponse = await app.request(`/knowledge-spaces/${spaceId}/stats`, {
      headers: bearer(readToken),
    });
    expect(statsResponse.status).toBe(200);
    const stats = await statsResponse.json();
    expect(stats.commits).toMatchObject({
      failedRetryable: 1,
      failedTerminal: 1,
      sampled: 3,
    });
  });

  it("falls back to projection version 1 for manifests without a numeric set version", async () => {
    const knowledgeSpaceManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const app = createApp({ knowledgeSpaceManifests });
    const spaceId = await createSpace(app);

    const manifestResponse = await app.request(`/knowledge-spaces/${spaceId}/manifest`, {
      headers: bearer(readToken),
    });
    expect(manifestResponse.status).toBe(200);
    await knowledgeSpaceManifests.update({
      knowledgeSpaceId: spaceId,
      patch: { projectionSetVersion: "legacy" },
      tenantId: "tenant-1",
    });

    const statusResponse = await app.request(`/knowledge-spaces/${spaceId}/status`, {
      headers: bearer(readToken),
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.index).toMatchObject({
      projectionSetVersion: "legacy",
      projectionVersion: 1,
    });
  });

  it("runs every fsck checker variant including cursored raw object scans", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const segments = await app.request(
      `/knowledge-spaces/${spaceId}/fsck?check=artifact-segments`,
      { headers: bearer(readToken) },
    );
    expect(segments.status).toBe(200);
    await expect(segments.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });

    const references = await app.request(`/knowledge-spaces/${spaceId}/fsck?check=references`, {
      headers: bearer(readToken),
    });
    expect(references.status).toBe(200);
    await expect(references.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });

    const cursor = Buffer.from(JSON.stringify({ id: "0" })).toString("base64url");
    const rawObjects = await app.request(`/knowledge-spaces/${spaceId}/fsck?cursor=${cursor}`, {
      headers: bearer(readToken),
    });
    expect(rawObjects.status).toBe(200);
    await expect(rawObjects.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });
  });

  it("accepts staged object GC dry-run cursors", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const cursor = Buffer.from(JSON.stringify({})).toString("base64url");

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/gc/staged-objects?cursor=${cursor}`,
      { headers: bearer(readToken) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });
  });

  it("reports the cache as unavailable when cache stats fail", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const adapter = {
      ...baseAdapter,
      cache: {
        ...baseAdapter.cache,
        stats: async (): Promise<{ entries: number; totalBytes: number }> => {
          throw new Error("cache offline");
        },
      },
    };
    const app = createApp({ adapter });
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/stats`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cache: { available: false, entries: 0, totalBytes: 0 },
    });
  });

  it("lets unexpected repository failures escape to the gateway error handler", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 100 });
    const knowledgeFsLeases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 100,
      maxListLimit: 100,
    });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 100,
      maxListLimit: 100,
    });
    const app = createApp({
      knowledgeFsLeases: {
        ...knowledgeFsLeases,
        listActive: async () => {
          throw new Error("lease backend down");
        },
      },
      knowledgeSpaces: {
        ...spaces,
        list: async () => {
          throw new Error("space list backend down");
        },
        update: async () => {
          throw new Error("space update backend down");
        },
      },
      stagedCommits: {
        ...stagedCommits,
        list: async () => {
          throw new Error("staged commit backend down");
        },
      },
    });
    const spaceId = await createSpace(app);

    const list = await app.request("/knowledge-spaces", { headers: bearer(readToken) });
    expect(list.status).toBe(500);

    const update = await app.request(`/knowledge-spaces/${spaceId}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Renamed" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(update.status).toBe(500);

    const leases = await app.request(`/knowledge-spaces/${spaceId}/leases/active`, {
      headers: bearer(readToken),
    });
    expect(leases.status).toBe(500);

    const commits = await app.request(`/knowledge-spaces/${spaceId}/staged-commits`, {
      headers: bearer(readToken),
    });
    expect(commits.status).toBe(500);
  });

  it("lets unexpected staged object GC delete failures escape to the gateway error handler", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        deleteObject: async () => {
          throw new Error("object storage delete outage");
        },
      },
    };
    const app = createApp({ adapter });
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/gc/staged-objects/execute`, {
      body: JSON.stringify({
        candidates: [
          {
            candidateType: "staged-object",
            count: 1,
            estimatedBytes: 8,
            idempotencyKey: `gc:tenant-1:${spaceId}:staged-object:doomed`,
            reason: "staged object is under the configured cleanup prefix",
            target: {
              objectKey: `tenant-1/spaces/${spaceId}/staging/doomed.bin`,
              type: "staged-commit",
            },
          },
        ],
      }),
      headers: json(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });

  it("paginates active lease diagnostics", async () => {
    const knowledgeFsLeases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 100,
      maxListLimit: 100,
    });
    const app = createApp({ knowledgeFsLeases });
    const spaceId = await createSpace(app);
    const nowIso = new Date().toISOString();
    const leaseBase = {
      acquiredAt: nowIso,
      expiresAt: "2030-01-01T00:00:00.000Z",
      heartbeatAt: nowIso,
      knowledgeSpaceId: spaceId,
      leaseType: "read" as const,
      metadata: {},
      sessionId: "00000000-0000-4000-8000-000000000201",
      status: "active" as const,
      targetType: "document-asset" as const,
      tenantId: "tenant-1",
      updatedAt: nowIso,
    };
    await knowledgeFsLeases.acquire({
      ...leaseBase,
      id: "00000000-0000-4000-8000-000000000301",
      targetId: "asset-1",
      virtualPath: "/knowledge/docs/a",
    });
    await knowledgeFsLeases.acquire({
      ...leaseBase,
      id: "00000000-0000-4000-8000-000000000302",
      targetId: "asset-2",
      virtualPath: "/knowledge/docs/b",
    });

    const response = await app.request(`/knowledge-spaces/${spaceId}/leases/active?limit=1`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(typeof body.nextCursor).toBe("string");
  });
});
