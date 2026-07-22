import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import {
  type DifyCapabilityV2GatewayAuthenticator,
  type DifyCapabilityV2SanitizedGrant,
  createInMemoryCapabilityGrantProvenanceRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskProgressRepository,
  createKnowledgeGateway,
  createResearchTaskJobStateMachine,
} from "./index";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const researchTaskJobId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";

describe("Research task direct stream", () => {
  it("lists jobs created by an earlier Capability for the same principal", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const grants = createInMemoryCapabilityGrantProvenanceRepository();
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => knowledgeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({ name: "Research", slug: "research", tenantId: "tenant-1" });
    await grants.admit(researchGrantAdmission({ grantId: "create-grant" }));
    await grants.admit(
      researchGrantAdmission({ grantId: "other-grant", subjectId: "dify-account:user-2" }),
    );
    let nextTaskId = 0;
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => `research-list-${++nextTaskId}`,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({
        capabilityGrants: grants,
        maxJobs: 10,
      }),
    });
    await researchTasks.start({
      capabilityGrantId: "create-grant",
      knowledgeSpaceId,
      query: "Visible task",
      tenantId: "tenant-1",
    });
    await researchTasks.start({
      capabilityGrantId: "other-grant",
      knowledgeSpaceId,
      query: "Hidden task",
      tenantId: "tenant-1",
    });
    let activeGrant = listGrant();
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () =>
      principal(activeGrant),
    );
    const app = createKnowledgeGateway({
      adapter,
      capabilityGrantProvenance: grants,
      difyCapabilityV2Auth: { authenticate },
      knowledgeSpaces: spaces,
      researchTasks,
    });

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "research-list-1", query: "Visible task" }],
    });

    activeGrant = listGrant({ grantId: "rotated-list-grant" });
    const otherGrant = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });
    expect(otherGrant.status).toBe(200);
    await expect(otherGrant.json()).resolves.toMatchObject({
      items: [{ id: "research-list-1", query: "Visible task" }],
    });

    activeGrant = listGrant({
      grantId: "other-subject-list-grant",
      subject: "dify-account:user-2",
    });
    const otherSubject = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });
    expect(otherSubject.status).toBe(200);
    await expect(otherSubject.json()).resolves.toMatchObject({
      items: [{ id: "research-list-2", query: "Hidden task" }],
    });

    activeGrant = listGrant({ action: "research_tasks.create" });
    const wrongAction = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });
    expect(wrongAction.status).toBe(403);

    for (const grant of [
      {
        ...listGrant(),
        resource: { id: knowledgeSpaceId, parent_id: null, type: "research_task" },
      },
      {
        ...listGrant(),
        resource: { id: researchTaskJobId, parent_id: null, type: "knowledge_space" },
      },
      {
        ...listGrant(),
        resource: { id: knowledgeSpaceId, parent_id: "parent", type: "knowledge_space" },
      },
    ] satisfies readonly DifyCapabilityV2SanitizedGrant[]) {
      activeGrant = grant;
      const forbidden = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
        headers: { authorization: "Bearer list-token" },
      });
      expect(forbidden.status).toBe(403);
    }

    activeGrant = listGrant();
    const invalidCursor = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/research-tasks?cursor=not-a-cursor`,
      { headers: { authorization: "Bearer list-token" } },
    );
    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toEqual({
      error: "Research task list cursor is invalid",
    });

    const listBySpace = vi.spyOn(researchTasks, "listBySpace");
    listBySpace.mockRejectedValueOnce(new Error("database unavailable"));
    const unavailable = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "Research task listing is unavailable",
    });

    await researchTasks.start({
      capabilityGrantId: "create-grant",
      knowledgeSpaceId,
      query: "Second visible task",
      tenantId: "tenant-1",
    });
    const firstPage = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/research-tasks?limit=1`,
      { headers: { authorization: "Bearer list-token" } },
    );
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as {
      items: readonly unknown[];
      nextCursor?: string;
    };
    expect(firstPageBody.items).toHaveLength(1);
    expect(firstPageBody.nextCursor).toBeTypeOf("string");
    const secondPage = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/research-tasks?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? "")}`,
      { headers: { authorization: "Bearer list-token" } },
    );
    expect(secondPage.status).toBe(200);
    await expect(secondPage.json()).resolves.toMatchObject({
      items: [{ id: "research-list-1", query: "Visible task" }],
    });

    const missingSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";
    activeGrant = {
      ...listGrant(),
      resource: { id: missingSpaceId, parent_id: null, type: "knowledge_space" },
    };
    const missingSpace = await app.request(`/knowledge-spaces/${missingSpaceId}/research-tasks`, {
      headers: { authorization: "Bearer list-token" },
    });
    expect(missingSpace.status).toBe(404);
  });

  it("binds CORS, cursor resume, terminal closure, and the exact Capability grant", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const grants = createInMemoryCapabilityGrantProvenanceRepository();
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => researchTaskJobId,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 2 }),
    });
    await researchTasks.start({
      capabilityGrantId: "admission-grant",
      knowledgeSpaceId,
      query: "Stream durable progress",
      tenantId: "tenant-1",
    });
    await progress.append({
      knowledgeSpaceId,
      researchTaskJobId,
      stage: "planning",
      tenantId: "tenant-1",
      type: "research_task.started",
    });
    await progress.append({
      knowledgeSpaceId,
      researchTaskJobId,
      stage: "completed",
      tenantId: "tenant-1",
      type: "research_task.stage_changed",
    });

    let activeGrant = streamGrant();
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () =>
      principal(activeGrant),
    );
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const app = createKnowledgeGateway({
      adapter,
      capabilityGrantProvenance: grants,
      difyCapabilityV2Auth: { authenticate },
      researchTaskDirectStream: {
        allowedOrigins: ["https://dify.example.com"],
        maxConnectionMs: 60_000,
        observer: { onClose, onOpen },
      },
      researchTaskProgress: progress,
      researchTasks,
    });
    const streamUrl = `/research-tasks/${researchTaskJobId}/events?knowledgeSpaceId=${knowledgeSpaceId}&limit=10`;

    const preflight = await app.request(streamUrl, {
      headers: {
        origin: "https://dify.example.com",
        "access-control-request-headers": "authorization,last-event-id",
        "access-control-request-method": "GET",
      },
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://dify.example.com");
    expect(preflight.headers.has("access-control-allow-credentials")).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();

    const deniedOrigin = await app.request(streamUrl, {
      headers: { authorization: "Bearer stream-token", origin: "https://evil.example.com" },
    });
    expect(deniedOrigin.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();

    const resumed = await app.request(streamUrl, {
      headers: {
        authorization: "Bearer stream-token",
        "last-event-id": "1",
        origin: "https://dify.example.com",
      },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get("access-control-allow-origin")).toBe("https://dify.example.com");
    expect(resumed.headers.has("access-control-allow-credentials")).toBe(false);
    const body = await resumed.text();
    expect(body).toContain("id: 2\nevent: completed");
    expect(body).not.toContain("id: 1\n");
    expect(body.match(/event: completed/gu)).toHaveLength(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({
      reconnected: true,
      researchTaskJobId,
      tenantId: "tenant-1",
    });
    expect(onClose).toHaveBeenCalledWith({
      reason: "terminal",
      researchTaskJobId,
      tenantId: "tenant-1",
    });

    const ambiguousCursor = await app.request(`${streamUrl}&cursor=2`, {
      headers: { authorization: "Bearer stream-token", "last-event-id": "1" },
    });
    expect(ambiguousCursor.status).toBe(400);

    activeGrant = streamGrant({ parentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99" });
    const wrongParent = await app.request(streamUrl, {
      headers: { authorization: "Bearer stream-token" },
    });
    expect(wrongParent.status).toBe(403);

    activeGrant = streamGrant({ action: "research_tasks.read" });
    const wrongAction = await app.request(streamUrl, {
      headers: { authorization: "Bearer stream-token" },
    });
    expect(wrongAction.status).toBe(403);
  });

  it("authorizes status, partials, and cancellation from the exact child Capability", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => researchTaskJobId,
      jobs: adapter.jobs,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 2 }),
    });
    await researchTasks.start({
      capabilityGrantId: "admission-grant",
      knowledgeSpaceId,
      query: "Inspect a capability-bound task",
      tenantId: "tenant-1",
    });

    let activeGrant = streamGrant({ action: "research_tasks.read" });
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () =>
      principal(activeGrant),
    );
    const app = createKnowledgeGateway({
      adapter,
      difyCapabilityV2Auth: { authenticate },
      researchTasks,
    });
    const taskUrl = `/research-tasks/${researchTaskJobId}?knowledgeSpaceId=${knowledgeSpaceId}`;

    const status = await app.request(taskUrl, {
      headers: { authorization: "Bearer task-token" },
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      id: researchTaskJobId,
      knowledgeSpaceId,
      query: "Inspect a capability-bound task",
    });

    activeGrant = streamGrant({ action: "research_tasks.partials.list" });
    const partials = await app.request(
      `/research-tasks/${researchTaskJobId}/partials?knowledgeSpaceId=${knowledgeSpaceId}`,
      { headers: { authorization: "Bearer task-token" } },
    );
    expect(partials.status).toBe(200);
    await expect(partials.json()).resolves.toEqual({ items: [] });

    activeGrant = streamGrant({ action: "research_tasks.cancel" });
    const canceled = await app.request(taskUrl, {
      headers: { authorization: "Bearer task-token" },
      method: "DELETE",
    });
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({
      id: researchTaskJobId,
      stage: "canceled",
    });
  });
});

function streamGrant({
  action = "research_tasks.stream",
  parentId = knowledgeSpaceId,
}: {
  readonly action?: string;
  readonly parentId?: string;
} = {}): DifyCapabilityV2SanitizedGrant {
  return {
    action,
    actor: "dify-account:user-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: [],
    controlSpaceId: "control-space-1",
    expiresAt: 2_000_000_060,
    grantId: `stream-grant:${action}:${parentId}`,
    issuedAt: 2_000_000_000,
    jtiHash: `sha256:${"0".repeat(64)}`,
    namespaceId: "tenant-1",
    notBefore: 2_000_000_000,
    resource: { id: researchTaskJobId, parent_id: parentId, type: "research_task" },
    subject: "dify-account:user-1",
    traceId: "trace-1",
  };
}

function listGrant({
  action = "research_tasks.list",
  grantId = "list-grant",
  subject = "dify-account:user-1",
}: {
  readonly action?: string;
  readonly grantId?: string;
  readonly subject?: string;
} = {}): DifyCapabilityV2SanitizedGrant {
  return {
    ...streamGrant({ action }),
    actor: subject,
    grantId,
    resource: { id: knowledgeSpaceId, parent_id: null, type: "knowledge_space" },
    subject,
  };
}

function researchGrantAdmission({
  grantId,
  subjectId = "dify-account:user-1",
}: {
  readonly grantId: string;
  readonly subjectId?: string;
}) {
  return {
    action: "research_tasks.create",
    actorId: subjectId,
    authzRevision: {
      credentialRevision: null,
      externalAccessEpoch: 1,
      membershipEpoch: 1,
      spaceAclEpoch: 1,
    },
    callerKind: "interactive" as const,
    contentPolicyRevision: 1,
    contentScopeIds: [],
    expiresAt: "2033-05-18T03:34:20.000Z",
    grantId,
    issuedAt: "2033-05-18T03:33:20.000Z",
    jtiHash: `sha256:${subjectId.endsWith("2") ? "2".repeat(64) : "1".repeat(64)}`,
    knowledgeSpaceId,
    resource: { id: knowledgeSpaceId, parentId: null, type: "knowledge_space" },
    subjectId,
    tenantId: "tenant-1",
    traceId: `trace:${grantId}`,
  };
}

function principal(grant: DifyCapabilityV2SanitizedGrant) {
  return {
    callerKind: grant.callerKind,
    claims: {
      action: grant.action,
      actor: grant.actor,
      aud: "knowledge-fs",
      authz_revision: grant.authzRevision,
      azp: grant.azp,
      caller_kind: grant.callerKind,
      cap_ver: grant.capVersion,
      content_policy_revision: grant.contentPolicyRevision,
      content_scope_ids: [...grant.contentScopeIds],
      control_space_id: grant.controlSpaceId,
      exp: grant.expiresAt,
      grant_id: grant.grantId,
      iat: grant.issuedAt,
      iss: "dify-control-plane",
      jti: "test-jti",
      namespace_id: grant.namespaceId,
      nbf: grant.notBefore,
      resource: grant.resource,
      sub: grant.subject,
      trace_id: grant.traceId,
    },
    grant,
    subject: {
      scopes: ["knowledge-spaces:read"],
      subjectId: grant.subject,
      tenantId: grant.namespaceId,
    },
  };
}
