import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
} from "./index";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const TENANT_ID = "tenant-1";
const PROFILE_PATH = `/knowledge-spaces/${SPACE_ID}/profiles/embedding/revisions`;

describe("knowledge-space profile revision audit API", () => {
  it("returns a bounded, paginated, admin-only audit DTO without raw capability data", async () => {
    const fixture = await createFixture();
    await seedEmbeddingHistory(fixture.profiles);

    const forbidden = await fixture.app.request(`${PROFILE_PATH}?limit=2`, {
      headers: { authorization: "Bearer editor-token" },
    });
    expect(forbidden.status).toBe(403);

    const first = await fixture.app.request(`${PROFILE_PATH}?limit=2`, {
      headers: { authorization: "Bearer owner-token" },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      activeRevision: number | null;
      items: Array<Record<string, unknown>>;
      nextRevision?: number;
    };
    expect(firstBody).toMatchObject({
      activeRevision: 3,
      items: [
        {
          createdBySubjectId: "owner-1",
          dimension: 768,
          kind: "embedding",
          model: "embed-v1",
          pluginId: "plugin-embedding",
          provider: "provider-a",
          revision: 1,
          state: "superseded",
        },
        {
          createdBySubjectId: "operator-2",
          failureCode: "MODEL_PROBE_FAILED",
          model: "embed-v2",
          revision: 2,
          state: "failed",
        },
      ],
      nextRevision: 2,
    });
    for (const item of firstBody.items) {
      expect(item.capabilitySnapshotDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(item.snapshotDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(item).not.toHaveProperty("capabilitySnapshot");
      expect(item).not.toHaveProperty("snapshot");
      expect(item).not.toHaveProperty("failureMessage");
      expect(item).not.toHaveProperty("tenantId");
    }
    const serialized = JSON.stringify(firstBody);
    expect(serialized).not.toContain("sk-profile-secret");
    expect(serialized).not.toContain("provider credential rejected: secret detail");

    const second = await fixture.app.request(`${PROFILE_PATH}?afterRevision=2&limit=2`, {
      headers: { authorization: "Bearer owner-token" },
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      activeRevision: 3,
      items: [{ model: "embed-v3", revision: 3, state: "active" }],
    });

    const emptyKind = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/profiles/retrieval/revisions?limit=1`,
      { headers: { authorization: "Bearer owner-token" } },
    );
    expect(emptyKind.status).toBe(200);
    await expect(emptyKind.json()).resolves.toEqual({ activeRevision: null, items: [] });
  });

  it("strictly rejects invalid kind, cursor, limit, and unknown query fields", async () => {
    const fixture = await createFixture();
    for (const path of [
      `${PROFILE_PATH}?limit=0`,
      `${PROFILE_PATH}?limit=101`,
      `${PROFILE_PATH}?limit=1.5`,
      `${PROFILE_PATH}?afterRevision=0`,
      `${PROFILE_PATH}?afterRevision=not-a-number`,
      `${PROFILE_PATH}?limit=1&unexpected=true`,
      `/knowledge-spaces/${SPACE_ID}/profiles/unknown/revisions`,
    ]) {
      const response = await fixture.app.request(path, {
        headers: { authorization: "Bearer owner-token" },
      });
      expect(response.status, path).toBe(400);
    }
  });

  it("returns a stable 503 contract when the profile repository is not configured", async () => {
    const fixture = await createFixture();
    const app = createKnowledgeGateway({
      adapter: fixture.adapter,
      auth: authVerifier(),
      knowledgeSpaceAccess: fixture.access,
      knowledgeSpaces: fixture.spaces,
    });

    const response = await app.request(PROFILE_PATH, {
      headers: { authorization: "Bearer owner-token" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "KNOWLEDGE_SPACE_PROFILE_AUDIT_UNAVAILABLE",
      error: "Knowledge-space profile audit is unavailable",
      retryable: true,
    });
  });

  it("publishes the bounded redacted response and 503 contract in OpenAPI", async () => {
    const fixture = await createFixture();
    const spec = (await (await fixture.app.request("/openapi.json")).json()) as {
      components?: {
        schemas?: Record<string, { properties?: Record<string, unknown> }>;
      };
      paths?: Record<string, { get?: { responses?: Record<string, { description?: string }> } }>;
    };
    const operation = spec.paths?.["/knowledge-spaces/{id}/profiles/{kind}/revisions"]?.get;
    expect(operation?.responses).toMatchObject({
      "200": {
        description: "Bounded immutable knowledge-space profile revision audit history",
      },
      "400": { description: "Invalid profile kind, revision cursor, or list limit" },
      "503": {
        description: "Profile audit repository is unavailable or returned invalid data",
      },
    });
    const properties = spec.components?.schemas?.KnowledgeSpaceProfileAuditRevision?.properties;
    expect(properties).toHaveProperty("capabilitySnapshotDigest");
    expect(properties).toHaveProperty("snapshotDigest");
    expect(properties).not.toHaveProperty("capabilitySnapshot");
    expect(properties).not.toHaveProperty("snapshot");
    expect(properties).not.toHaveProperty("failureMessage");
  });
});

async function createFixture() {
  const adapter = createNodePlatformAdapter({ env: {} });
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => SPACE_ID,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({ name: "Profile audit", slug: "profile-audit", tenantId: TENANT_ID });
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
    }),
  });
  await access.initialize({
    knowledgeSpaceId: SPACE_ID,
    ownerSubjectId: "owner-1",
    tenantId: TENANT_ID,
  });
  await access.setMemberRole({
    actorSubjectId: "owner-1",
    expectedRevision: 0,
    knowledgeSpaceId: SPACE_ID,
    role: "editor",
    subjectId: "editor-1",
    tenantId: TENANT_ID,
  });
  await access.updatePolicy({
    actorSubjectId: "owner-1",
    expectedRevision: 1,
    knowledgeSpaceId: SPACE_ID,
    partialMemberSubjectIds: [],
    tenantId: TENANT_ID,
    visibility: "all_members",
  });
  const profiles = createInMemoryKnowledgeSpaceProfileRepository({
    maxListLimit: 100,
    maxRevisions: 100,
  });
  return {
    access,
    adapter,
    app: createKnowledgeGateway({
      adapter,
      auth: authVerifier(),
      knowledgeSpaceAccess: access,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaces: spaces,
    }),
    profiles,
    spaces,
  };
}

function authVerifier() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      "editor-token": {
        scopes: ["knowledge-spaces:*"],
        subjectId: "editor-1",
        tenantId: TENANT_ID,
      },
      "owner-token": {
        scopes: ["knowledge-spaces:*"],
        subjectId: "owner-1",
        tenantId: TENANT_ID,
      },
    },
  });
}

async function seedEmbeddingHistory(
  profiles: ReturnType<typeof createInMemoryKnowledgeSpaceProfileRepository>,
) {
  await profiles.createCandidate({
    capabilitySnapshot: { apiKey: "sk-profile-secret", install: "embedding-v1" },
    createdBySubjectId: "owner-1",
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:00:00.000Z",
    snapshot: embeddingProfile(1, "embed-v1", 768, "a"),
    tenantId: TENANT_ID,
  });
  await profiles.activateCandidate({
    expectedActiveRevision: null,
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:01:00.000Z",
    revision: 1,
    tenantId: TENANT_ID,
  });
  await profiles.createCandidate({
    capabilitySnapshot: { apiKey: "sk-profile-secret-v2", install: "embedding-v2" },
    createdBySubjectId: "operator-2",
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:02:00.000Z",
    snapshot: embeddingProfile(2, "embed-v2", 1_536, "b"),
    tenantId: TENANT_ID,
  });
  await profiles.failCandidate({
    errorCode: "MODEL_PROBE_FAILED",
    errorMessage: "provider credential rejected: secret detail",
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:03:00.000Z",
    revision: 2,
    tenantId: TENANT_ID,
  });
  await profiles.createCandidate({
    capabilitySnapshot: { apiKey: "sk-profile-secret-v3", install: "embedding-v3" },
    createdBySubjectId: "owner-1",
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:04:00.000Z",
    snapshot: embeddingProfile(3, "embed-v3", 3_072, "c"),
    tenantId: TENANT_ID,
  });
  await profiles.activateCandidate({
    expectedActiveRevision: 1,
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: "2026-07-14T10:05:00.000Z",
    revision: 3,
    tenantId: TENANT_ID,
  });
}

function embeddingProfile(revision: number, model: string, dimension: number, hash: string) {
  return {
    dimension,
    model,
    pluginId: "plugin-embedding",
    provider: "provider-a",
    revision,
    vectorSpaceId: `embedding-space-sha256:${hash.repeat(64)}`,
  };
}
