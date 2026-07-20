import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createInMemoryAgentWorkspaceSnapshotRepository } from "./agent-workspace-snapshot";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import { createStaticAuthVerifier } from "./auth";
import { createInMemoryBulkOperationRepository } from "./bulk-operation";
import {
  createDocumentCompilationJobStateMachine,
  createInMemoryDocumentCompilationJobRepository,
} from "./document-compilation-job";
import type { QueryGenerationInput } from "./gateway-sse-responses";
import { createKnowledgeGateway } from "./index";
import {
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { createInMemoryKnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import { createInMemoryKnowledgeSpaceProfileRepository } from "./knowledge-space-profile-memory-repository";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import { createTestUnpublishedProfileActivations } from "./knowledge-space-unpublished-profile-activation-test-utils";
import {
  createInMemoryResearchTaskJobRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";

const owner = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const editor = { scopes: ["knowledge-spaces:*"], subjectId: "editor-1", tenantId: "tenant-1" };
const viewer = { scopes: ["knowledge-spaces:*"], subjectId: "viewer-1", tenantId: "tenant-1" };
const outsider = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "outsider-1",
  tenantId: "tenant-1",
};

describe("gateway knowledge-space authorization", () => {
  it("keeps model catalog readable but restricts model settings and preflights to owners", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({ subjectsByToken: { editor, owner, viewer } }),
      knowledgeSpaceAccess: access,
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: createTestUnpublishedProfileActivations(
        manifests,
        profiles,
      ),
      modelCapabilityCatalog: {
        list: async () => ({ items: [] }),
        resolve: async () => null,
      },
      modelCapabilityPreflight: {
        verify: async (input) => ({
          capabilityDigest: `sha256:${"a".repeat(64)}`,
          checkedAt: "2026-07-14T12:00:00.000Z",
          ...(input.kind === "embedding"
            ? { dimension: 384, distanceMetric: "cosine" as const }
            : {}),
          kind: input.kind,
          pluginUniqueIdentifier: `plugin-${input.kind}:1@sha256:installed`,
          schemaFingerprint: `sha256:${"b".repeat(64)}`,
          selection: input.selection,
        }),
      },
    });
    const createdResponse = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Model settings" }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { readonly id: string };

    for (const member of [editor, viewer] as const) {
      expect(
        (
          await app.request(`/knowledge-spaces/${created.id}/members`, {
            body: JSON.stringify({
              role: member === editor ? "editor" : "viewer",
              subjectId: member.subjectId,
            }),
            headers: jsonBearer("owner"),
            method: "POST",
          })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/access-policy`, {
          body: JSON.stringify({
            expectedRevision: 1,
            partialMemberSubjectIds: [],
            visibility: "all_members",
          }),
          headers: jsonBearer("owner"),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);

    for (const token of ["owner", "editor", "viewer"] as const) {
      expect(
        (
          await app.request(`/knowledge-spaces/${created.id}/model-catalog`, {
            headers: bearer(token),
          })
        ).status,
        token,
      ).toBe(200);
    }

    const embeddingSelection = {
      model: "embed-384",
      pluginId: "plugin-embedding",
      provider: "provider-a",
    };
    const mutations = [
      {
        body: { kind: "embedding", selection: embeddingSelection },
        expectedStatus: 200,
        method: "POST",
        path: `/knowledge-spaces/${created.id}/model-preflights`,
      },
      {
        body: embeddingSelection,
        expectedStatus: 202,
        method: "PUT",
        path: `/knowledge-spaces/${created.id}/embedding-profile`,
      },
      {
        body: {
          expectedRevision: 0,
          profile: {
            defaultMode: "fast",
            reasoningModel: {
              model: "reasoning-a",
              pluginId: "plugin-reasoning",
              provider: "provider-a",
            },
            rerank: { enabled: false },
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 3,
          },
        },
        expectedStatus: 202,
        method: "PUT",
        path: `/knowledge-spaces/${created.id}/retrieval-profile`,
      },
    ] as const;

    for (const token of ["editor", "viewer"] as const) {
      for (const mutation of mutations) {
        expect(
          (
            await app.request(mutation.path, {
              body: JSON.stringify(mutation.body),
              headers: jsonBearer(token),
              method: mutation.method,
            })
          ).status,
          `${token} ${mutation.path}`,
        ).toBe(403);
      }
    }

    for (const mutation of mutations) {
      expect(
        (
          await app.request(mutation.path, {
            body: JSON.stringify(mutation.body),
            headers: jsonBearer("owner"),
            method: mutation.method,
          })
        ).status,
        mutation.path,
      ).toBe(mutation.expectedStatus);
    }
  });

  it("rechecks admin access before persisting pending model settings", async () => {
    const baseAccess = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    let simulateDemotion = false;
    let authorizationReads = 0;
    const access = {
      ...baseAccess,
      getAccessContext: async (input: Parameters<typeof baseAccess.getAccessContext>[0]) => {
        const context = await baseAccess.getAccessContext(input);
        authorizationReads += 1;
        if (!simulateDemotion || authorizationReads === 1 || !context) {
          return context;
        }
        return { ...context, member: { ...context.member, role: "editor" as const } };
      },
    };
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { owner } }),
      knowledgeSpaceAccess: access,
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: createTestUnpublishedProfileActivations(
        manifests,
        profiles,
      ),
      modelCapabilityPreflight: {
        verify: async (input) => ({
          capabilityDigest: `sha256:${"a".repeat(64)}`,
          checkedAt: "2026-07-14T12:00:00.000Z",
          dimension: 384,
          distanceMetric: "cosine",
          kind: input.kind,
          pluginUniqueIdentifier: "plugin-embedding:1@sha256:installed",
          schemaFingerprint: `sha256:${"b".repeat(64)}`,
          selection: input.selection,
        }),
      },
    });
    const pendingMutations = [
      {
        body: {
          model: "embed-384",
          pluginId: "plugin-embedding",
          provider: "provider-a",
        },
        kind: "embedding",
        path: "embedding-profile",
      },
      {
        body: {
          expectedRevision: 0,
          profile: {
            defaultMode: "research",
            reasoningModel: {
              model: "reasoning-a",
              pluginId: "plugin-reasoning",
              provider: "provider-a",
            },
            rerank: { enabled: false },
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 3,
          },
        },
        kind: "retrieval",
        path: "retrieval-profile",
      },
    ] as const;

    for (const mutation of pendingMutations) {
      simulateDemotion = false;
      authorizationReads = 0;
      const createdResponse = await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: `Settings race ${mutation.kind}` }),
        headers: jsonBearer("owner"),
        method: "POST",
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { readonly id: string };
      simulateDemotion = true;
      authorizationReads = 0;

      const response = await app.request(`/knowledge-spaces/${created.id}/${mutation.path}`, {
        body: JSON.stringify(mutation.body),
        headers: jsonBearer("owner"),
        method: "PUT",
      });

      expect(response.status, mutation.kind).toBe(403);
      await expect(response.json()).resolves.toEqual({
        code: "KNOWLEDGE_SPACE_ROLE_DENIED",
        error: "Knowledge space access denied",
      });
      const manifest = await manifests.get({
        knowledgeSpaceId: created.id,
        tenantId: owner.tenantId,
      });
      expect(manifest?.embeddingProfile).toBeUndefined();
      expect(manifest?.retrievalProfile).toBeUndefined();
      expect(manifest?.pendingModelConfiguration).toBeUndefined();
      await expect(
        profiles.getHead({
          kind: mutation.kind,
          knowledgeSpaceId: created.id,
          tenantId: owner.tenantId,
        }),
      ).resolves.toBeNull();
    }
  });

  it("enforces member roles and immediately observes API Access/key revocation", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 10, maxTraces: 10 });
    const queryInputs: QueryGenerationInput[] = [];
    const app = createKnowledgeGateway({
      adapter,
      answerTraces,
      auth: createStaticAuthVerifier({
        subjectsByToken: { outsider, owner, viewer },
      }),
      knowledgeSpaceAccess: access,
      queryGenerator: {
        stream: async function* (input) {
          queryInputs.push(input);
          yield { finishReason: "stop", type: "done" };
        },
      },
    });

    const createdResponse = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Camera", slug: "camera" }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { readonly id: string };

    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/members`, {
          body: JSON.stringify({ role: "viewer", subjectId: viewer.subjectId }),
          headers: jsonBearer("owner"),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/access-policy`, {
          body: JSON.stringify({
            expectedRevision: 1,
            partialMemberSubjectIds: [],
            visibility: "all_members",
          }),
          headers: jsonBearer("owner"),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);

    expect(
      (await app.request(`/knowledge-spaces/${created.id}`, { headers: bearer("viewer") })).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}`, {
          body: JSON.stringify({ expectedRevision: 1, name: "Forbidden rename" }),
          headers: jsonBearer("viewer"),
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request(`/knowledge-spaces/${created.id}`, { headers: bearer("outsider") }))
        .status,
    ).toBe(403);
    for (const path of [
      `/knowledge-spaces/${created.id}/failed-queries?limit=10`,
      `/knowledge-spaces/${created.id}/status`,
      `/knowledge-spaces/${created.id}/leases/active?limit=10`,
      `/knowledge-spaces/${created.id}/staged-commits?limit=10`,
    ]) {
      expect((await app.request(path, { headers: bearer("viewer") })).status, path).toBe(403);
    }
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/production-bad-cases`, {
          body: JSON.stringify({ traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8aff" }),
          headers: jsonBearer("viewer"),
          method: "POST",
        })
      ).status,
    ).toBe(403);
    const tracePermission = await access.createPermissionSnapshot({
      accessChannel: "interactive",
      expiresAt: "2099-01-01T00:00:00.000Z",
      knowledgeSpaceId: created.id,
      subjectId: viewer.subjectId,
      tenantId: viewer.tenantId,
    });
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
    await answerTraces.create({
      createdAt: "2026-07-14T12:00:00.000Z",
      id: traceId,
      knowledgeSpaceId: created.id,
      mode: "fast",
      permissionSnapshot: {
        accessChannel: tracePermission.accessChannel,
        id: tracePermission.id,
        revision: tracePermission.revision,
      },
      query: "camera",
      subjectId: viewer.subjectId,
      steps: [],
    });
    expect((await app.request(`/queries/${traceId}`, { headers: bearer("viewer") })).status).toBe(
      200,
    );
    expect((await app.request(`/queries/${traceId}`, { headers: bearer("outsider") })).status).toBe(
      404,
    );
    for (const mode of ["fast", "research", "deep"] as const) {
      const response = await app.request("/queries", {
        body: JSON.stringify({ knowledgeSpaceId: created.id, mode, query: `${mode} camera` }),
        headers: jsonBearer("viewer"),
        method: "POST",
      });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(queryInputs.map((input) => input.mode)).toEqual(["fast", "research", "deep"]);
    for (const input of queryInputs) {
      expect(input.permissionScope).toContain(
        `knowledge-space:${created.id}:member:${viewer.subjectId}`,
      );
      expect(input.permissionScope).not.toContain("knowledge-spaces:*");
    }
    await expect(
      (await app.request("/knowledge-spaces?limit=10", { headers: bearer("viewer") })).json(),
    ).resolves.toMatchObject({ items: [{ id: created.id }] });

    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/api-access`, {
          body: JSON.stringify({ enabled: true, expectedRevision: 1 }),
          headers: jsonBearer("owner"),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    const issuedResponse = await app.request(`/knowledge-spaces/${created.id}/api-keys`, {
      body: JSON.stringify({ name: "reader key", principalSubjectId: viewer.subjectId }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(issuedResponse.status).toBe(201);
    const issued = (await issuedResponse.json()) as { readonly token: string };
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}`, {
          headers: { authorization: `Bearer ${issued.token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/retention-policy", {
          headers: { authorization: `Bearer ${issued.token}` },
        })
      ).status,
    ).toBe(403);
    for (const path of [
      `/knowledge-spaces/${created.id}/failed-queries?limit=10`,
      `/knowledge-spaces/${created.id}/status`,
      `/knowledge-spaces/${created.id}/leases/active?limit=10`,
      `/knowledge-spaces/${created.id}/staged-commits?limit=10`,
    ]) {
      expect(
        (
          await app.request(path, {
            headers: { authorization: `Bearer ${issued.token}` },
          })
        ).status,
        path,
      ).toBe(403);
    }

    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}/api-access`, {
          body: JSON.stringify({ enabled: false, expectedRevision: 2 }),
          headers: jsonBearer("owner"),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${created.id}`, {
          headers: { authorization: `Bearer ${issued.token}` },
        })
      ).status,
    ).toBe(403);
  });

  it("fails legacy spaces closed until an explicit deployment admin bootstraps an owner", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const legacy = await spaces.create({
      name: "Legacy",
      slug: "legacy",
      tenantId: owner.tenantId,
    });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    const deploymentAdmin = {
      scopes: ["knowledge-spaces:*", "knowledge-spaces:admin"],
      subjectId: "deployment-admin-1",
      tenantId: owner.tenantId,
    };
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({
        subjectsByToken: { deploymentAdmin, owner },
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
    });

    expect(
      (await app.request(`/knowledge-spaces/${legacy.id}`, { headers: bearer("owner") })).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/knowledge-spaces/${legacy.id}/access-bootstrap`, {
          body: JSON.stringify({ ownerSubjectId: owner.subjectId }),
          headers: jsonBearer("owner"),
          method: "POST",
        })
      ).status,
    ).toBe(403);

    const bootstrapped = await app.request(`/knowledge-spaces/${legacy.id}/access-bootstrap`, {
      body: JSON.stringify({ ownerSubjectId: owner.subjectId }),
      headers: jsonBearer("deploymentAdmin"),
      method: "POST",
    });
    expect(bootstrapped.status).toBe(201);
    await expect(bootstrapped.json()).resolves.toMatchObject({
      ownerSubjectId: owner.subjectId,
      revision: 1,
      visibility: "only_me",
    });
    expect(
      (await app.request(`/knowledge-spaces/${legacy.id}`, { headers: bearer("owner") })).status,
    ).toBe(200);

    expect(
      (
        await app.request(`/knowledge-spaces/${legacy.id}/access-bootstrap`, {
          body: JSON.stringify({ ownerSubjectId: owner.subjectId }),
          headers: jsonBearer("deploymentAdmin"),
          method: "POST",
        })
      ).status,
    ).toBe(409);
  });

  it("enforces the default in-memory access service instead of disabling ACL", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 10, maxSpaces: 10 });
    const legacy = await spaces.create({
      name: "Uninitialized legacy space",
      slug: "uninitialized-legacy",
      tenantId: owner.tenantId,
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({ subjectsByToken: { owner } }),
      knowledgeSpaces: spaces,
    });

    expect(
      (await app.request(`/knowledge-spaces/${legacy.id}`, { headers: bearer("owner") })).status,
    ).toBe(403);
    await expect(
      (await app.request("/knowledge-spaces?limit=10", { headers: bearer("owner") })).json(),
    ).resolves.toEqual({ items: [] });

    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Owned", slug: "owned" }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { readonly id: string };
    expect(
      (await app.request(`/knowledge-spaces/${createdBody.id}`, { headers: bearer("owner") }))
        .status,
    ).toBe(200);
  });

  it("never lets a key for one space reach identifier resources owned by another space", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 10, maxTraces: 10 });
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-space-b",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-space-b",
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const snapshots = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 10,
      maxEvidenceBundles: 10,
      maxMounts: 10,
      maxSnapshots: 10,
      maxSourceVersions: 10,
    });
    const app = createKnowledgeGateway({
      adapter,
      agentWorkspaceSnapshots: snapshots,
      answerTraces,
      auth: createStaticAuthVerifier({ subjectsByToken: { owner } }),
      bulkOperations,
      documentCompilationJobs: compilationJobs,
      knowledgeSpaceAccess: access,
      researchTasks,
    });

    const createSpace = async (slug: string) => {
      const response = await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: slug, slug }),
        headers: jsonBearer("owner"),
        method: "POST",
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { readonly id: string };
    };
    const spaceA = await createSpace("space-a");
    const spaceB = await createSpace("space-b");
    for (const space of [spaceA, spaceB]) {
      expect(
        (
          await app.request(`/knowledge-spaces/${space.id}/api-access`, {
            body: JSON.stringify({ enabled: true, expectedRevision: 1 }),
            headers: jsonBearer("owner"),
            method: "PATCH",
          })
        ).status,
      ).toBe(200);
    }
    const issuedResponse = await app.request(`/knowledge-spaces/${spaceA.id}/api-keys`, {
      body: JSON.stringify({ name: "space A only", principalSubjectId: owner.subjectId }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(issuedResponse.status).toBe(201);
    const { token } = (await issuedResponse.json()) as { readonly token: string };

    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01";
    await answerTraces.create({
      createdAt: "2026-07-14T12:00:00.000Z",
      id: traceId,
      knowledgeSpaceId: spaceB.id,
      mode: "fast",
      query: "space B",
      subjectId: owner.subjectId,
      steps: [],
    });
    await compilationJobs.start({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b02",
      knowledgeSpaceId: spaceB.id,
      tenantId: owner.tenantId,
      version: 1,
    });
    await researchTasks.start({
      knowledgeSpaceId: spaceB.id,
      permissionSnapshot: { accessChannel: "interactive", id: "snapshot-ref-b", revision: 1 },
      query: "space B research",
      subjectId: owner.subjectId,
      tenantId: owner.tenantId,
    });
    await snapshots.create({
      commandLog: [],
      evidenceBundles: [],
      id: "agent-workspace-snapshot-space-b",
      indexProjection: { fingerprint: "projection-space-b", projectionIds: [] },
      knowledgeSpaceId: spaceB.id,
      mounts: [],
      permissionSnapshot: {
        scopes: [`knowledge-space:${spaceB.id}:read`],
        subjectId: owner.subjectId,
        tenantId: owner.tenantId,
      },
      sourceVersions: [],
      tenantId: owner.tenantId,
      traceIds: [],
    });
    await bulkOperations.create({
      id: "bulk-operation-space-b",
      items: [],
      knowledgeSpaceId: spaceB.id,
      tenantId: owner.tenantId,
      type: "document_reindex",
    });

    const headers = { authorization: `Bearer ${token}` };
    for (const path of [
      `/queries/${traceId}`,
      "/jobs/document-compilation-job-space-b",
      "/research-tasks/research-task-job-space-b",
      "/agent-workspace-snapshots/agent-workspace-snapshot-space-b",
      "/bulk-jobs/bulk-operation-space-b",
    ]) {
      expect((await app.request(path, { headers })).status, path).toBe(403);
    }
  });
});

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonBearer(token: string): Record<string, string> {
  return { ...bearer(token), "content-type": "application/json" };
}
