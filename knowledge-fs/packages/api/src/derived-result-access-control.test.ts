import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createInMemoryAgentWorkspaceSnapshotRepository } from "./agent-workspace-snapshot";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import {
  createAgentWorkspaceReplayService,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import {
  type KnowledgeSpaceAccessService,
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";
import { createInMemoryResearchTaskProgressRepository } from "./research-task-progress";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OWNER = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "owner-1",
  tenantId: "tenant-1",
};
const MEMBER = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "member-2",
  tenantId: "tenant-1",
};

describe("durable derived-result access control", () => {
  it("isolates Research, AnswerTrace/evidence, Workspace/replay, and bad-case capture", async () => {
    const fixture = await createFixture();
    const derived = await createDerivedResults(fixture, "owner", {
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a11",
    });

    expect(
      (
        await fixture.app.request(`/research-tasks/${derived.researchTaskId}`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(`/research-tasks/${derived.researchTaskId}/partials?limit=10`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(`/queries/${derived.traceId}`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(`/queries/${derived.traceId}/evidence?limit=10`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(`/agent-workspace-snapshots/${derived.workspaceSnapshotId}`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(
          `/agent-workspace-snapshots/${derived.workspaceSnapshotId}/replay`,
          { headers: bearer("owner"), method: "POST" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/production-bad-cases`, {
          body: JSON.stringify({ traceId: derived.traceId }),
          headers: jsonBearer("owner"),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/production-bad-cases`, {
          body: JSON.stringify({ traceId: derived.traceId }),
          headers: jsonBearer("member"),
          method: "POST",
        })
      ).status,
    ).toBe(404);

    for (const path of [
      `/research-tasks/${derived.researchTaskId}`,
      `/research-tasks/${derived.researchTaskId}/partials?limit=10`,
      `/research-tasks/${derived.researchTaskId}/events?limit=10`,
    ]) {
      expect((await fixture.app.request(path, { headers: bearer("member") })).status, path).toBe(
        403,
      );
    }
    for (const path of [
      `/queries/${derived.traceId}`,
      `/queries/${derived.traceId}/evidence?limit=10`,
      `/agent-workspace-snapshots/${derived.workspaceSnapshotId}`,
    ]) {
      expect((await fixture.app.request(path, { headers: bearer("member") })).status, path).toBe(
        404,
      );
    }
    expect(
      (
        await fixture.app.request(
          `/agent-workspace-snapshots/${derived.workspaceSnapshotId}/replay`,
          { headers: bearer("member"), method: "POST" },
        )
      ).status,
    ).toBe(404);

    await fixture.access.updatePolicy({
      actorSubjectId: OWNER.subjectId,
      expectedRevision: 2,
      knowledgeSpaceId: SPACE_ID,
      partialMemberSubjectIds: [],
      tenantId: OWNER.tenantId,
      visibility: "only_me",
    });
    await expectCredentialRejectedForAllDerived(fixture, "owner", derived, 403);
  });

  it("rejects every API-key-derived result after key revocation", async () => {
    const fixture = await createFixture();
    await enableApiAccess(fixture.access);
    const issued = await fixture.access.issueApiKey({
      actorSubjectId: OWNER.subjectId,
      knowledgeSpaceId: SPACE_ID,
      name: "derived result key",
      principalSubjectId: OWNER.subjectId,
      tenantId: OWNER.tenantId,
    });
    const derived = await createDerivedResults(fixture, issued.token, {
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a12",
    });

    await expectKeyCanReadDerived(fixture, issued.token, derived);
    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/production-bad-cases`, {
          body: JSON.stringify({ traceId: derived.traceId }),
          headers: jsonBearer(issued.token),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    await fixture.access.revokeApiKey({
      actorSubjectId: OWNER.subjectId,
      expectedRevision: issued.apiKey.revision,
      id: issued.apiKey.id,
      knowledgeSpaceId: SPACE_ID,
      tenantId: OWNER.tenantId,
    });

    await expectCredentialRejectedForAllDerived(fixture, issued.token, derived, 401);
    await expectCredentialRejectedForAllDerived(fixture, "owner", derived, 403);
    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/production-bad-cases`, {
          body: JSON.stringify({ traceId: derived.traceId }),
          headers: jsonBearer(issued.token),
          method: "POST",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/production-bad-cases`, {
          body: JSON.stringify({ traceId: derived.traceId }),
          headers: jsonBearer("owner"),
          method: "POST",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects every API-key-derived result after key expiry", async () => {
    const fixture = await createFixture();
    await enableApiAccess(fixture.access);
    const expiresAt = new Date(Date.parse(fixture.clock.value) + 60_000).toISOString();
    const issued = await fixture.access.issueApiKey({
      actorSubjectId: OWNER.subjectId,
      expiresAt,
      knowledgeSpaceId: SPACE_ID,
      name: "short-lived derived result key",
      principalSubjectId: OWNER.subjectId,
      tenantId: OWNER.tenantId,
    });
    const derived = await createDerivedResults(fixture, issued.token, {
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a13",
    });

    await expectKeyCanReadDerived(fixture, issued.token, derived);
    fixture.clock.value = new Date(Date.parse(expiresAt) + 1).toISOString();

    await expectCredentialRejectedForAllDerived(fixture, issued.token, derived, 401);
    await expectCredentialRejectedForAllDerived(fixture, "owner", derived, 403);
  });

  it("uses the durable snapshot grants minted after an owner-to-viewer TOCTOU downgrade", async () => {
    const clock = { value: "2026-07-14T12:00:00.000Z" };
    const baseAccess = createAccess(clock);
    await baseAccess.initialize({
      knowledgeSpaceId: SPACE_ID,
      ownerSubjectId: "owner-2",
      tenantId: OWNER.tenantId,
    });
    await baseAccess.setMemberRole({
      actorSubjectId: "owner-2",
      expectedRevision: 0,
      knowledgeSpaceId: SPACE_ID,
      role: "owner",
      subjectId: OWNER.subjectId,
      tenantId: OWNER.tenantId,
    });
    await baseAccess.updatePolicy({
      actorSubjectId: "owner-2",
      expectedRevision: 1,
      knowledgeSpaceId: SPACE_ID,
      partialMemberSubjectIds: [],
      tenantId: OWNER.tenantId,
      visibility: "all_members",
    });
    let raced = false;
    const access: KnowledgeSpaceAccessService = {
      ...baseAccess,
      createPermissionSnapshot: async (input) => {
        if (!raced) {
          raced = true;
          await baseAccess.setMemberRole({
            actorSubjectId: "owner-2",
            expectedRevision: 1,
            knowledgeSpaceId: SPACE_ID,
            role: "viewer",
            subjectId: OWNER.subjectId,
            tenantId: OWNER.tenantId,
          });
        }
        return baseAccess.createPermissionSnapshot(input);
      },
    };
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({
      name: "TOCTOU",
      slug: "toctou",
      tenantId: OWNER.tenantId,
    });
    const receivedPermissionScopes: string[][] = [];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { owner: OWNER } }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
      now: () => clock.value,
      queryGenerator: {
        stream: async function* (input) {
          receivedPermissionScopes.push([...input.permissionScope]);
          yield { finishReason: "stop", type: "done" };
        },
      },
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId: SPACE_ID, mode: "fast", query: "race" }),
      headers: jsonBearer("owner"),
      method: "POST",
    });
    expect(response.status).toBe(200);
    await response.text();

    expect(receivedPermissionScopes).toHaveLength(1);
    expect(receivedPermissionScopes[0]).toContain(`knowledge-space:${SPACE_ID}:role:viewer`);
    expect(receivedPermissionScopes[0]).not.toContain(`knowledge-space:${SPACE_ID}:role:owner`);
  });
});

interface DerivedResultIds {
  readonly researchTaskId: string;
  readonly traceId: string;
  readonly workspaceSnapshotId: string;
}

async function createFixture() {
  const clock = { value: "2026-07-14T12:00:00.000Z" };
  const access = createAccess(clock);
  await access.initialize({
    knowledgeSpaceId: SPACE_ID,
    ownerSubjectId: OWNER.subjectId,
    tenantId: OWNER.tenantId,
  });
  await access.setMemberRole({
    actorSubjectId: OWNER.subjectId,
    expectedRevision: 0,
    knowledgeSpaceId: SPACE_ID,
    role: "editor",
    subjectId: MEMBER.subjectId,
    tenantId: OWNER.tenantId,
  });
  await access.updatePolicy({
    actorSubjectId: OWNER.subjectId,
    expectedRevision: 1,
    knowledgeSpaceId: SPACE_ID,
    partialMemberSubjectIds: [],
    tenantId: OWNER.tenantId,
    visibility: "all_members",
  });
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => SPACE_ID,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({
    name: "Derived Results",
    slug: "derived-results",
    tenantId: OWNER.tenantId,
  });
  const adapter = createNodePlatformAdapter({ env: {} });
  let nextResearchTaskId = 0;
  const researchTasks = createResearchTaskJobStateMachine({
    generateId: () => `research-task-${++nextResearchTaskId}`,
    jobs: adapter.jobs,
    repository: createInMemoryResearchTaskJobRepository({ maxJobs: 20 }),
  });
  const researchTaskPartials = createInMemoryResearchTaskPartialResultRepository({
    maxListLimit: 20,
    maxResults: 20,
  });
  const researchTaskProgress = createInMemoryResearchTaskProgressRepository({
    maxEvents: 20,
    maxListLimit: 20,
    maxSubscribers: 20,
  });
  const workspaceSnapshots = createInMemoryAgentWorkspaceSnapshotRepository({
    maxCommandLogEntries: 20,
    maxEvidenceBundles: 20,
    maxMounts: 20,
    maxSnapshots: 20,
    maxSourceVersions: 20,
    now: () => clock.value,
  });
  let nextWorkspaceSnapshotId = 0;
  const app = createKnowledgeGateway({
    adapter,
    allowLegacyResearchTaskProfileFallback: true,
    agentWorkspaceReplay: createAgentWorkspaceReplayService({
      generateId: () => crypto.randomUUID(),
      maxCommands: 20,
      maxOutputSummaryBytes: 1_000,
      now: () => clock.value,
      runner: {
        run: async ({ command }) => ({ outputSummary: command.outputSummary }),
      },
      snapshots: workspaceSnapshots,
    }),
    agentWorkspaceSnapshots: workspaceSnapshots,
    answerTraces: createInMemoryAnswerTraceRepository({ maxSteps: 20, maxTraces: 20 }),
    auth: createStaticAuthVerifier({ subjectsByToken: { member: MEMBER, owner: OWNER } }),
    generateAgentWorkspaceSnapshotId: () => `workspace-snapshot-${++nextWorkspaceSnapshotId}`,
    knowledgeSpaceAccess: access,
    knowledgeSpaces: spaces,
    now: () => clock.value,
    queryGenerator: {
      stream: async function* () {
        yield { finishReason: "stop", type: "done" };
      },
    },
    researchTaskPartials,
    researchTaskProgress,
    researchTasks,
  });
  return { access, app, clock };
}

function createAccess(clock: { readonly value: string }): KnowledgeSpaceAccessService {
  return createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 20,
      maxListLimit: 20,
      maxMembersPerSpace: 20,
      now: () => clock.value,
    }),
  });
}

async function createDerivedResults(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  token: string,
  input: { readonly traceId: string },
): Promise<DerivedResultIds> {
  const research = await fixture.app.request("/research-tasks", {
    body: JSON.stringify({ knowledgeSpaceId: SPACE_ID, query: "durable research" }),
    headers: jsonBearer(token),
    method: "POST",
  });
  expect(research.status).toBe(201);
  const researchBody = (await research.json()) as { readonly id: string };

  const query = await fixture.app.request("/queries", {
    body: JSON.stringify({ knowledgeSpaceId: SPACE_ID, mode: "fast", query: "durable trace" }),
    headers: { ...jsonBearer(token), "x-trace-id": input.traceId },
    method: "POST",
  });
  expect(query.status).toBe(200);
  expect(query.headers.get("x-trace-id")).toBe(input.traceId);
  const queryRunId = query.headers.get("x-query-run-id");
  expect(queryRunId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(queryRunId).not.toBe(input.traceId);
  if (!queryRunId) throw new Error("Query run id header missing");
  await query.text();

  const workspace = await fixture.app.request("/agent-workspace-snapshots", {
    body: JSON.stringify({
      indexProjection: { fingerprint: "projection-v1", projectionIds: [] },
      knowledgeSpaceId: SPACE_ID,
    }),
    headers: jsonBearer(token),
    method: "POST",
  });
  expect(workspace.status).toBe(201);
  const workspaceBody = (await workspace.json()) as { readonly id: string };

  return {
    researchTaskId: researchBody.id,
    traceId: queryRunId,
    workspaceSnapshotId: workspaceBody.id,
  };
}

async function enableApiAccess(access: KnowledgeSpaceAccessService): Promise<void> {
  await access.updateApiAccess({
    actorSubjectId: OWNER.subjectId,
    enabled: true,
    expectedRevision: 1,
    knowledgeSpaceId: SPACE_ID,
    tenantId: OWNER.tenantId,
  });
}

async function expectKeyCanReadDerived(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  token: string,
  derived: DerivedResultIds,
): Promise<void> {
  for (const path of [
    `/research-tasks/${derived.researchTaskId}`,
    `/queries/${derived.traceId}`,
    `/agent-workspace-snapshots/${derived.workspaceSnapshotId}`,
  ]) {
    expect((await fixture.app.request(path, { headers: bearer(token) })).status, path).toBe(200);
  }
}

async function expectCredentialRejectedForAllDerived(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  token: string,
  derived: DerivedResultIds,
  expectedStatus: number,
): Promise<void> {
  for (const path of [
    `/research-tasks/${derived.researchTaskId}`,
    `/research-tasks/${derived.researchTaskId}/partials?limit=10`,
    `/research-tasks/${derived.researchTaskId}/events?limit=10`,
    `/queries/${derived.traceId}`,
    `/queries/${derived.traceId}/evidence?limit=10`,
    `/agent-workspace-snapshots/${derived.workspaceSnapshotId}`,
  ]) {
    expect((await fixture.app.request(path, { headers: bearer(token) })).status, path).toBe(
      expectedStatus,
    );
  }
  expect(
    (
      await fixture.app.request(
        `/agent-workspace-snapshots/${derived.workspaceSnapshotId}/replay`,
        { headers: bearer(token), method: "POST" },
      )
    ).status,
  ).toBe(expectedStatus);
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonBearer(token: string): Record<string, string> {
  return { ...bearer(token), "content-type": "application/json" };
}
