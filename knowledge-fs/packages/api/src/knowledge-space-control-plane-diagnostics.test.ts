import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import {
  IndexProjectionSchema,
  KnowledgeFsLeaseSchema,
  KnowledgeFsSessionSchema,
  KnowledgeSpaceStagedCommitSchema,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createInMemoryDocumentAssetRepository,
  createInMemoryIndexProjectionRepository,
  createInMemoryKnowledgeFsLeaseRepository,
  createInMemoryKnowledgeFsSessionRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryStagedCommitRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const writeOnlyToken = "write-only-token";
const readSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "reader",
  tenantId: "tenant-1",
};
const writeOnlySubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "writer-only",
  tenantId: "tenant-1",
};
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "writer",
  tenantId: "tenant-1",
};
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createDiagnosticsAccess() {
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
    }),
  });
  await access.initialize({
    knowledgeSpaceId: SPACE_ID,
    ownerSubjectId: writeSubject.subjectId,
    tenantId: writeSubject.tenantId,
  });
  await access.setMemberRole({
    actorSubjectId: writeSubject.subjectId,
    expectedRevision: 0,
    knowledgeSpaceId: SPACE_ID,
    role: "owner",
    subjectId: readSubject.subjectId,
    tenantId: readSubject.tenantId,
  });
  await access.updatePolicy({
    actorSubjectId: writeSubject.subjectId,
    expectedRevision: 1,
    knowledgeSpaceId: SPACE_ID,
    partialMemberSubjectIds: [],
    visibility: "all_members",
    tenantId: writeSubject.tenantId,
  });
  return access;
}

describe("KnowledgeSpace control-plane diagnostics", () => {
  it("returns a lazily bootstrapped manifest without exposing write operations", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });

    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: { [readToken]: readSubject, [writeToken]: writeSubject },
      }),
      generateKnowledgeSpaceManifestId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a10",
      knowledgeSpaceManifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/manifest`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      consistencyPolicy: { defaultClass: "path-consistent" },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a10",
      knowledgeSpaceId: SPACE_ID,
      objectKeyPrefix: `tenant-1/spaces/${SPACE_ID}`,
      tenantId: "tenant-1",
    });

    const unsupportedMutation = await app.request(`/knowledge-spaces/${SPACE_ID}/manifest`, {
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(unsupportedMutation.status).toBe(404);
  });

  it("lists staged commit diagnostics with tenant scope, status filter, and explicit bounds", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });

    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 2,
    });
    await stagedCommits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T11:00:00.000Z",
        errorCode: "parser_timeout",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b10",
        idempotencyKey: "upload:doc-a",
        knowledgeSpaceId: SPACE_ID,
        operationType: "document-upload",
        rawObjectKey: `tenant-1/spaces/${SPACE_ID}/staging/doc-a.md`,
        status: "failed-retryable",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:01:00.000Z",
      }),
    );
    await stagedCommits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T11:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b11",
        idempotencyKey: "upload:doc-b",
        knowledgeSpaceId: SPACE_ID,
        operationType: "document-upload",
        rawObjectKey: `tenant-1/spaces/${SPACE_ID}/staging/doc-b.md`,
        status: "object-staged",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:02:00.000Z",
      }),
    );

    const response = await appRequestWithStagedCommits({
      spaces,
      stagedCommits,
      url: `/knowledge-spaces/${SPACE_ID}/staged-commits?limit=1&status=failed-retryable`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          errorCode: "parser_timeout",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b10",
          status: "failed-retryable",
        }),
      ],
    });

    const unbounded = await appRequestWithStagedCommits({
      spaces,
      stagedCommits,
      url: `/knowledge-spaces/${SPACE_ID}/staged-commits?limit=3`,
    });
    expect(unbounded.status).toBe(400);
  });

  it("returns a bounded KnowledgeSpace status summary for operator diagnostics", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const sessions = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 10,
      maxSessions: 10,
    });
    await sessions.create(
      KnowledgeFsSessionSchema.parse({
        clientKind: "mcp",
        clientVersion: "1.2.3",
        consistencyClass: "snapshot-consistent",
        createdAt: "2026-05-27T11:00:00.000Z",
        expiresAt: "2026-05-27T12:00:00.000Z",
        heartbeatAt: "2026-05-27T11:04:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c10",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        permissionSnapshot: ["knowledge-spaces:read"],
        subject: readSubject,
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:04:00.000Z",
      }),
    );
    await sessions.create(
      KnowledgeFsSessionSchema.parse({
        clientKind: "api",
        clientVersion: "1.2.3",
        consistencyClass: "path-consistent",
        createdAt: "2026-05-27T10:00:00.000Z",
        expiresAt: "2026-05-27T10:30:00.000Z",
        heartbeatAt: "2026-05-27T10:10:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c11",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        permissionSnapshot: ["knowledge-spaces:read"],
        subject: readSubject,
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T10:10:00.000Z",
      }),
    );
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    await leases.acquire(
      KnowledgeFsLeaseSchema.parse({
        acquiredAt: "2026-05-27T11:00:00.000Z",
        expiresAt: "2026-05-27T11:30:00.000Z",
        heartbeatAt: "2026-05-27T11:05:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d10",
        knowledgeSpaceId: SPACE_ID,
        leaseType: "publish",
        metadata: {},
        sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c10",
        status: "active",
        targetId: "tenant-1/staged/doc.md",
        targetType: "staged-commit",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:05:00.000Z",
        virtualPath: "/sources/staged/tenant-1%2Fstaged%2Fdoc.md",
      }),
    );
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    await stagedCommits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T10:59:00.000Z",
        errorCode: "parser_timeout",
        expiresAt: "2026-06-10T11:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9e10",
        idempotencyKey: "upload:failed",
        knowledgeSpaceId: SPACE_ID,
        operationType: "document-upload",
        status: "failed-retryable",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:01:00.000Z",
      }),
    );
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    await projections.createMany([
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9f10",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9f20",
        projectionVersion: 1,
        status: "ready",
        type: "dense-vector",
        updatedAt: "2026-05-27T11:02:00.000Z",
      }),
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9f11",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9f21",
        projectionVersion: 1,
        status: "failed",
        type: "fts",
        updatedAt: "2026-05-27T11:03:00.000Z",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: { [readToken]: readSubject },
      }),
      knowledgeFsLeases: leases,
      knowledgeFsSessions: sessions,
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
      parser: {
        kind: "native-markdown",
        parse: async () => {
          throw new Error("status test parser must not parse");
        },
      },
      projections,
      stagedCommits,
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeLeases: {
        count: 1,
        items: [
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d10",
            leaseType: "publish",
            targetType: "staged-commit",
          },
        ],
        truncated: false,
      },
      activeSessions: {
        count: 1,
        items: [
          {
            clientKind: "mcp",
            consistencyClass: "snapshot-consistent",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c10",
            subjectId: "reader",
          },
        ],
        truncated: false,
      },
      configuration: {
        activeProfiles: {},
        availableModes: [],
        status: "setup-required",
      },
      failedCommits: {
        count: 1,
        items: [
          {
            errorCode: "parser_timeout",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9e10",
            status: "failed-retryable",
          },
        ],
        truncated: false,
      },
      generatedAt: "2026-05-27T11:05:00.000Z",
      index: {
        nodeSchemaVersion: 1,
        projectionSetVersion: "default-v1",
        projectionVersion: 1,
        summaries: {
          denseVector: { ready: 1, total: 1 },
          fts: { failed: 1, total: 1 },
        },
      },
      knowledgeSpaceId: SPACE_ID,
      manifest: {
        consistencyClass: "path-consistent",
        manifestVersion: 1,
        objectKeyPrefix: `tenant-1/spaces/${SPACE_ID}`,
        storageProvider: "memory-dev",
      },
      parser: {
        kind: "native-markdown",
        policyVersion: "default-v1",
      },
      storage: {
        healthy: true,
        objectStorageKind: "memory",
        provider: "memory-dev",
      },
      tenantId: "tenant-1",
    });

    const activeLeases = await app.request(`/knowledge-spaces/${SPACE_ID}/leases/active?limit=1`, {
      headers: bearer(readToken),
    });
    expect(activeLeases.status).toBe(200);
    await expect(activeLeases.json()).resolves.toMatchObject({
      items: [
        {
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d10",
          leaseType: "publish",
          status: "active",
          targetType: "staged-commit",
        },
      ],
    });

    const unboundedLeases = await app.request(
      `/knowledge-spaces/${SPACE_ID}/leases/active?limit=11`,
      {
        headers: bearer(readToken),
      },
    );
    expect(unboundedLeases.status).toBe(400);
  });

  it("reports a pending model configuration without exposing its model selections", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-05-27T11:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a10",
        knowledgeSpaceId: SPACE_ID,
        pendingModelConfiguration: {
          digest: "a".repeat(64),
          embeddingSelection: {
            model: "private-pending-embedding-model",
            pluginId: "private-pending-plugin",
            provider: "private-pending-provider",
          },
          revision: 1,
          state: "pending-validation",
        },
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:00:00.000Z",
      }),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [readToken]: readSubject } }),
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      configuration: {
        activeProfiles: {},
        availableModes: [],
        pendingModelConfiguration: {
          digest: "a".repeat(64),
          revision: 1,
          state: "pending-validation",
        },
        status: "pending-validation",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-pending");

    await expect(
      manifests.update({
        expectedManifestVersion: 1,
        knowledgeSpaceId: SPACE_ID,
        patch: {
          manifestVersion: 2,
          pendingModelConfiguration: {
            digest: "b".repeat(64),
            embeddingSelection: {
              model: "private-failed-embedding-model",
              pluginId: "private-failed-plugin",
              provider: "private-failed-provider",
            },
            failure: {
              code: "MODEL_PROBE_FAILED",
              failedAt: "2026-05-27T11:06:00.000Z",
              retryable: true,
            },
            revision: 2,
            state: "validation-failed",
          },
          updatedAt: "2026-05-27T11:06:00.000Z",
        },
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ manifestVersion: 2 });
    const failedResponse = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: bearer(readToken),
    });
    expect(failedResponse.status).toBe(200);
    const failedBody = await failedResponse.json();
    expect(failedBody).toMatchObject({
      configuration: {
        activeProfiles: {},
        availableModes: [],
        pendingModelConfiguration: {
          digest: "b".repeat(64),
          failure: {
            code: "MODEL_PROBE_FAILED",
            failedAt: "2026-05-27T11:06:00.000Z",
            retryable: true,
          },
          revision: 2,
          state: "validation-failed",
        },
        status: "validation-failed",
      },
    });
    expect(JSON.stringify(failedBody)).not.toContain("private-failed");
  });

  it("keeps an active Research profile ready when a replacement validation fails", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-05-27T11:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a10",
        knowledgeSpaceId: SPACE_ID,
        pendingModelConfiguration: {
          digest: "b".repeat(64),
          failure: {
            code: "MODEL_CAPABILITY_MISMATCH",
            failedAt: "2026-05-27T11:04:00.000Z",
            retryable: false,
          },
          retrievalProfile: {
            defaultMode: "research",
            reasoningModel: {
              model: "private-replacement-reasoning-model",
              pluginId: "private-replacement-plugin",
              provider: "private-replacement-provider",
            },
            rerank: { enabled: false },
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 8,
          },
          revision: 2,
          state: "validation-failed",
        },
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:04:00.000Z",
      }),
    );
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    await profiles.createCandidate({
      capabilitySnapshot: { verification: "verified" },
      createdBySubjectId: "writer",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: "2026-05-27T11:01:00.000Z",
      snapshot: createKnowledgeSpaceRetrievalProfile({
        defaultMode: "research",
        reasoningModel: {
          model: "active-reasoning-model",
          pluginId: "active-reasoning-plugin",
          provider: "active-reasoning-provider",
        },
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 5,
      }),
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: "2026-05-27T11:02:00.000Z",
      revision: 1,
      tenantId: "tenant-1",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [readToken]: readSubject } }),
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      configuration: {
        activeProfiles: { retrievalRevision: 1 },
        availableModes: ["research"],
        pendingModelConfiguration: {
          digest: "b".repeat(64),
          failure: {
            code: "MODEL_CAPABILITY_MISMATCH",
            failedAt: "2026-05-27T11:04:00.000Z",
            retryable: false,
          },
          revision: 2,
          state: "validation-failed",
        },
        status: "ready",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-replacement");
  });

  it("reports object storage as unhealthy instead of failing the status endpoint", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const adapter = createNodePlatformAdapter({ env: {} });
    const app = createKnowledgeGateway({
      adapter: {
        ...adapter,
        objectStorage: {
          ...adapter.objectStorage,
          health: async () => {
            throw new Error("object storage health unavailable");
          },
        },
      },
      auth: createStaticAuthVerifier({
        subjectsByToken: { [readToken]: readSubject },
      }),
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      storage: {
        healthy: false,
        objectStorageKind: "memory",
      },
    });
  });

  it("returns low-cardinality KnowledgeSpace stats bounded by a time window", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const assets = createInMemoryDocumentAssetRepository({
      generateId: (() => {
        let next = 1;
        return () => `018f0d60-7a49-7cc2-9c1b-5b36f18faa0${next++}`;
      })(),
      maxAssets: 10,
      now: () => "2026-05-27T11:01:00.000Z",
    });
    await assets.create({
      filename: "A.md",
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${SPACE_ID}/documents/a.md`,
      sha256: "a".repeat(64),
      sizeBytes: 20,
    });
    await assets.create({
      filename: "B.md",
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${SPACE_ID}/documents/b.md`,
      sha256: "b".repeat(64),
      sizeBytes: 30,
    });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    await stagedCommits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T10:59:00.000Z",
        errorCode: "inside-window",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fab10",
        idempotencyKey: "upload:inside-window",
        knowledgeSpaceId: SPACE_ID,
        operationType: "document-upload",
        status: "failed-retryable",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:04:00.000Z",
      }),
    );
    await stagedCommits.create(
      KnowledgeSpaceStagedCommitSchema.parse({
        createdAt: "2026-05-27T09:00:00.000Z",
        errorCode: "outside-window",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fab11",
        idempotencyKey: "upload:outside-window",
        knowledgeSpaceId: SPACE_ID,
        operationType: "document-upload",
        status: "failed-terminal",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T10:00:00.000Z",
      }),
    );
    const sessions = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 10,
      maxSessions: 10,
    });
    await sessions.create(
      KnowledgeFsSessionSchema.parse({
        clientKind: "admin",
        clientVersion: "1.2.3",
        consistencyClass: "path-consistent",
        createdAt: "2026-05-27T11:00:00.000Z",
        expiresAt: "2026-05-27T11:30:00.000Z",
        heartbeatAt: "2026-05-27T11:04:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fac10",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        permissionSnapshot: ["knowledge-spaces:read"],
        subject: readSubject,
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T11:04:00.000Z",
      }),
    );
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    await projections.createMany([
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fad10",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18fad20",
        projectionVersion: 1,
        status: "ready",
        type: "metadata",
        updatedAt: "2026-05-27T11:03:00.000Z",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: { [readToken]: readSubject },
      }),
      documentAssets: assets,
      knowledgeFsLeases: leases,
      knowledgeFsSessions: sessions,
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
      projections,
      stagedCommits,
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/stats?windowMinutes=30`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cache: {
        available: true,
      },
      commits: {
        failedRetryable: 1,
        failedTerminal: 0,
        sampled: 2,
        truncated: false,
      },
      generatedAt: "2026-05-27T11:05:00.000Z",
      metrics: {
        available: false,
        reason: "metrics-backend-not-configured",
      },
      projections: {
        metadata: { ready: 1, total: 1 },
        projectionVersion: 1,
      },
      runtime: {
        activeLeaseSampleCount: 0,
        activeSessionSampleCount: 1,
        truncated: false,
      },
      storage: {
        documentCount: 2,
        rawDocumentBytes: 50,
      },
      window: {
        end: "2026-05-27T11:05:00.000Z",
        minutes: 30,
        start: "2026-05-27T10:35:00.000Z",
      },
    });
  });

  it("exposes fsck diagnostics, staged-object GC dry-run, mutation, auth, and OpenAPI paths", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T11:00:00.000Z",
    });
    await spaces.create({ name: "Engineering", slug: "engineering", tenantId: "tenant-1" });
    const assets = createInMemoryDocumentAssetRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18fae10",
      maxAssets: 10,
      now: () => "2026-05-27T11:01:00.000Z",
    });
    await assets.create({
      filename: "Missing.md",
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${SPACE_ID}/documents/missing.md`,
      sha256: "c".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("orphan"),
      key: `tenant-1/spaces/${SPACE_ID}/staging/orphan.md`,
      metadata: {},
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [readToken]: readSubject,
          [writeOnlyToken]: writeOnlySubject,
          [writeToken]: writeSubject,
        },
      }),
      documentAssets: assets,
      generateKnowledgeFsGcDryRunId: () => "gc-dry-run-route-1",
      knowledgeSpaceAccess: await createDiagnosticsAccess(),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T11:05:00.000Z",
    });

    const openapi = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining([
        "/knowledge-spaces/{id}/fsck",
        "/knowledge-spaces/{id}/gc/staged-objects",
        "/knowledge-spaces/{id}/gc/staged-objects/execute",
        "/knowledge-spaces/{id}/leases/active",
        "/knowledge-spaces/{id}/status",
        "/knowledge-spaces/{id}/stats",
      ]),
    );

    const unauthorized = await app.request(`/knowledge-spaces/${SPACE_ID}/fsck`);
    expect(unauthorized.status).toBe(401);
    const writeOnlyRead = await app.request(`/knowledge-spaces/${SPACE_ID}/fsck`, {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyRead.status).toBe(403);

    const fsck = await app.request(`/knowledge-spaces/${SPACE_ID}/fsck?check=raw-objects`, {
      headers: bearer(readToken),
    });
    expect(fsck.status).toBe(200);
    await expect(fsck.json()).resolves.toMatchObject({
      issues: [
        {
          target: {
            objectKey: `tenant-1/spaces/${SPACE_ID}/documents/missing.md`,
            type: "raw-object",
          },
          type: "missing-raw-object",
        },
      ],
      summary: {
        error: 1,
        scanned: 1,
      },
    });

    const otherTenant = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/fsck",
      {
        headers: bearer(readToken),
      },
    );
    expect(otherTenant.status).toBe(404);

    const dryRun = await app.request(`/knowledge-spaces/${SPACE_ID}/gc/staged-objects`, {
      headers: bearer(readToken),
    });
    expect(dryRun.status).toBe(200);
    const dryRunBody = (await dryRun.json()) as {
      candidates: {
        candidateType: string;
        idempotencyKey: string;
        target: { objectKey?: string; type: string };
      }[];
      dryRunId: string;
    };
    expect(dryRunBody).toMatchObject({
      candidates: [
        {
          candidateType: "staged-object",
          target: {
            objectKey: `tenant-1/spaces/${SPACE_ID}/staging/orphan.md`,
            type: "staged-commit",
          },
        },
      ],
      dryRunId: "gc-dry-run-route-1",
    });

    const readOnlyExecute = await app.request(
      `/knowledge-spaces/${SPACE_ID}/gc/staged-objects/execute`,
      {
        body: JSON.stringify({ candidates: dryRunBody.candidates }),
        headers: { ...bearer(readToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(readOnlyExecute.status).toBe(403);

    const execute = await app.request(`/knowledge-spaces/${SPACE_ID}/gc/staged-objects/execute`, {
      body: JSON.stringify({ candidates: dryRunBody.candidates }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(execute.status).toBe(200);
    await expect(execute.json()).resolves.toMatchObject({
      deleted: 1,
      items: [
        {
          objectKey: `tenant-1/spaces/${SPACE_ID}/staging/orphan.md`,
          status: "deleted",
        },
      ],
      skipped: 0,
      tenantId: "tenant-1",
    });
    await expect(
      adapter.objectStorage.headObject(`tenant-1/spaces/${SPACE_ID}/staging/orphan.md`),
    ).resolves.toBeNull();
  });
});

async function appRequestWithStagedCommits({
  spaces,
  stagedCommits,
  url,
}: {
  readonly spaces: ReturnType<typeof createInMemoryKnowledgeSpaceRepository>;
  readonly stagedCommits: ReturnType<typeof createInMemoryStagedCommitRepository>;
  readonly url: string;
}) {
  const app = createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: { [readToken]: readSubject, [writeToken]: writeSubject },
    }),
    knowledgeSpaceAccess: await createDiagnosticsAccess(),
    knowledgeSpaces: spaces,
    stagedCommits,
  });

  return app.request(url, { headers: bearer(readToken) });
}
