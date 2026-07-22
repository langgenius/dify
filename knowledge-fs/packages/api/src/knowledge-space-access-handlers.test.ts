import { randomUUID } from "node:crypto";
import type { AuthSubject } from "@knowledge/core";
import { beforeEach, describe, expect, it } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import {
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { registerKnowledgeSpaceAccessHandlers } from "./knowledge-space-access-handlers";
import { createKnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const ownerSubjectId = "owner-1";
const viewerSubjectId = "viewer-1";
const timestamp = "2026-07-14T12:00:00.000Z";

describe("knowledge space access HTTP contract", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(async () => {
    harness = createHarness();
    await harness.access.initialize({ knowledgeSpaceId, ownerSubjectId, tenantId });
  });

  it("keeps interactive settings available while external API access is off", async () => {
    const response = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/access-policy`,
      { headers: interactiveHeaders(ownerSubjectId) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: expect.any(String),
      ownerSubjectId,
      partialMemberSubjectIds: [],
      revision: 1,
      visibility: "only_me",
    });
  });

  it("supports member CRUD with role enforcement and CAS", async () => {
    const added = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/members`, {
      body: JSON.stringify({ role: "viewer", subjectId: viewerSubjectId }),
      headers: interactiveHeaders(ownerSubjectId, true),
      method: "POST",
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({
      revision: 1,
      role: "viewer",
      subjectId: viewerSubjectId,
    });
    await harness.access.updatePolicy({
      actorSubjectId: ownerSubjectId,
      expectedRevision: 1,
      knowledgeSpaceId,
      partialMemberSubjectIds: [],
      tenantId,
      visibility: "all_members",
    });

    const viewerList = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/members`, {
      headers: interactiveHeaders(viewerSubjectId, true),
    });
    expect(viewerList.status).toBe(403);
    await expect(viewerList.json()).resolves.toMatchObject({ code: "KNOWLEDGE_SPACE_ROLE_DENIED" });

    const updated = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/members/${viewerSubjectId}`,
      {
        body: JSON.stringify({ expectedRevision: 1, role: "editor" }),
        headers: interactiveHeaders(ownerSubjectId, true),
        method: "PATCH",
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ revision: 2, role: "editor" });

    const stale = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/members/${viewerSubjectId}`,
      {
        body: JSON.stringify({ expectedRevision: 1, role: "viewer" }),
        headers: interactiveHeaders(ownerSubjectId, true),
        method: "PATCH",
      },
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "space_access_revision_conflict" });

    const removed = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/members/${viewerSubjectId}?expectedRevision=2`,
      { headers: interactiveHeaders(ownerSubjectId), method: "DELETE" },
    );
    expect(removed.status).toBe(204);

    const lastOwner = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/members/${ownerSubjectId}?expectedRevision=1`,
      { headers: interactiveHeaders(ownerSubjectId), method: "DELETE" },
    );
    expect(lastOwner.status).toBe(409);
    await expect(lastOwner.json()).resolves.toMatchObject({ code: "space_access_last_owner" });
  });

  it("enforces a nonempty selected-member set for partial visibility", async () => {
    const response = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/access-policy`,
      {
        body: JSON.stringify({
          expectedRevision: 1,
          partialMemberSubjectIds: [],
          visibility: "partial_members",
        }),
        headers: interactiveHeaders(ownerSubjectId, true),
        method: "PATCH",
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "space_access_partial_members_required",
    });
  });

  it("updates API access with CAS and rejects cross-tenant management", async () => {
    const updated = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/api-access`, {
      body: JSON.stringify({ enabled: true, expectedRevision: 1 }),
      headers: interactiveHeaders(ownerSubjectId, true),
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ enabled: true, revision: 2 });

    const stale = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/api-access`, {
      body: JSON.stringify({ enabled: false, expectedRevision: 1 }),
      headers: interactiveHeaders(ownerSubjectId, true),
      method: "PATCH",
    });
    expect(stale.status).toBe(409);

    const crossTenant = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/api-access`,
      { headers: { ...interactiveHeaders(ownerSubjectId), "x-tenant-id": "tenant-2" } },
    );
    expect(crossTenant.status).toBe(403);
    await expect(crossTenant.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
    });
  });

  it("returns API key plaintext once and never exposes the stored hash", async () => {
    await addViewerAndEnableApiAccess(harness);
    const expired = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/api-keys`, {
      body: JSON.stringify({
        expiresAt: "2020-01-01T00:00:00.000Z",
        name: "Already expired",
        principalSubjectId: viewerSubjectId,
      }),
      headers: interactiveHeaders(ownerSubjectId, true),
      method: "POST",
    });
    expect(expired.status).toBe(400);

    const issued = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/api-keys`, {
      body: JSON.stringify({ name: "CI agent", principalSubjectId: viewerSubjectId }),
      headers: interactiveHeaders(ownerSubjectId, true),
      method: "POST",
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as {
      apiKey: { id: string; prefix: string; revision: number };
      token: string;
    };
    expect(issuedBody.token).toMatch(/^kfs_[0-9a-f-]{36}_[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(issuedBody)).not.toContain("keyHash");

    const listed = await harness.app.request(`/knowledge-spaces/${knowledgeSpaceId}/api-keys`, {
      headers: interactiveHeaders(ownerSubjectId),
    });
    expect(listed.status).toBe(200);
    const listText = await listed.text();
    expect(listText).not.toContain("keyHash");
    expect(listText).not.toContain(issuedBody.token);
    expect(JSON.parse(listText)).toMatchObject({
      items: [{ id: issuedBody.apiKey.id, prefix: issuedBody.apiKey.prefix }],
    });

    const revoked = await harness.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/api-keys/${issuedBody.apiKey.id}?expectedRevision=${issuedBody.apiKey.revision}`,
      { headers: interactiveHeaders(ownerSubjectId), method: "DELETE" },
    );
    expect(revoked.status).toBe(200);
    const revokeText = await revoked.text();
    expect(revokeText).not.toContain("keyHash");
    expect(revokeText).not.toContain(issuedBody.token);
  });

  it.each([
    [
      "bootstrap",
      `/knowledge-spaces/${knowledgeSpaceId}/access-bootstrap`,
      { body: JSON.stringify({ ownerSubjectId }), method: "POST" },
    ],
    [
      "visibility",
      `/knowledge-spaces/${knowledgeSpaceId}/access-policy`,
      {
        body: JSON.stringify({
          expectedRevision: 1,
          partialMemberSubjectIds: [],
          visibility: "only_me",
        }),
        method: "PATCH",
      },
    ],
    [
      "member create",
      `/knowledge-spaces/${knowledgeSpaceId}/members`,
      { body: JSON.stringify({ role: "viewer", subjectId: viewerSubjectId }), method: "POST" },
    ],
    [
      "member update",
      `/knowledge-spaces/${knowledgeSpaceId}/members/${viewerSubjectId}`,
      { body: JSON.stringify({ expectedRevision: 1, role: "editor" }), method: "PATCH" },
    ],
    [
      "member delete",
      `/knowledge-spaces/${knowledgeSpaceId}/members/${viewerSubjectId}?expectedRevision=1`,
      { method: "DELETE" },
    ],
    [
      "API access",
      `/knowledge-spaces/${knowledgeSpaceId}/api-access`,
      { body: JSON.stringify({ enabled: true, expectedRevision: 1 }), method: "PATCH" },
    ],
    [
      "API key issue",
      `/knowledge-spaces/${knowledgeSpaceId}/api-keys`,
      {
        body: JSON.stringify({ name: "blocked", principalSubjectId: ownerSubjectId }),
        method: "POST",
      },
    ],
    [
      "API key revoke",
      `/knowledge-spaces/${knowledgeSpaceId}/api-keys/00000000-0000-4000-8000-000000000001?expectedRevision=1`,
      { method: "DELETE" },
    ],
  ] as const)("freezes legacy %s mutations in integrated mode", async (_name, path, init) => {
    const readOnlyHarness = createHarness(true);
    await readOnlyHarness.access.initialize({ knowledgeSpaceId, ownerSubjectId, tenantId });

    const response = await readOnlyHarness.app.request(path, {
      ...init,
      headers: interactiveHeaders(ownerSubjectId, true),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_INTEGRATED_AUTHZ_READ_ONLY",
    });
  });
});

function createHarness(legacyMutationsReadOnly = false) {
  const repository = createInMemoryKnowledgeSpaceAccessRepository({
    generateId: randomUUID,
    maxApiKeysPerSpace: 10,
    maxListLimit: 100,
    maxMembersPerSpace: 100,
    now: () => timestamp,
  });
  const access = createKnowledgeSpaceAccessService({
    generateApiKeySecret: () => "abcdefghijklmnopqrstuvwxyz012345",
    generateId: randomUUID,
    repository,
  });
  const authorization = createKnowledgeSpaceAuthorizationGuard({
    access,
    now: () => timestamp,
  });
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    const subjectId = context.req.header("x-subject-id") ?? ownerSubjectId;
    const subject: AuthSubject = {
      scopes: context.req.header("x-forged-admin") === "true" ? ["knowledge-spaces:*"] : [],
      subjectId,
      tenantId: context.req.header("x-tenant-id") ?? tenantId,
    };
    context.set("subject", subject);
    await next();
  });
  registerKnowledgeSpaceAccessHandlers({
    access,
    app,
    authorization,
    legacyMutationsReadOnly,
    spaces: createInMemoryKnowledgeSpaceRepository({ maxListLimit: 10, maxSpaces: 10 }),
  });
  return { access, app };
}

function interactiveHeaders(subjectId: string, forgedAdmin = false): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(forgedAdmin ? { "x-forged-admin": "true" } : {}),
    "x-subject-id": subjectId,
    "x-tenant-id": tenantId,
  };
}

async function addViewerAndEnableApiAccess(harness: ReturnType<typeof createHarness>) {
  await harness.access.setMemberRole({
    actorSubjectId: ownerSubjectId,
    expectedRevision: 0,
    knowledgeSpaceId,
    role: "viewer",
    subjectId: viewerSubjectId,
    tenantId,
  });
  await harness.access.updatePolicy({
    actorSubjectId: ownerSubjectId,
    expectedRevision: 1,
    knowledgeSpaceId,
    partialMemberSubjectIds: [],
    tenantId,
    visibility: "all_members",
  });
  await harness.access.updateApiAccess({
    actorSubjectId: ownerSubjectId,
    enabled: true,
    expectedRevision: 1,
    knowledgeSpaceId,
    tenantId,
  });
}
