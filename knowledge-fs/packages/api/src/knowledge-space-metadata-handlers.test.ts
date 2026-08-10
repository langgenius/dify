import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
} from "./index";
import type {
  KnowledgeSpaceMetadataField,
  KnowledgeSpaceMetadataRepository,
} from "./knowledge-space-metadata-repository";

const tenantId = "tenant-metadata-http";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const fieldId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
const now = "2026-08-10T12:00:00.000Z";

describe("knowledge-space metadata HTTP API", () => {
  it("allows viewers to list fields but requires write access for creation", async () => {
    const fixture = await createFixture();

    const listed = await fixture.app.request(
      `/knowledge-spaces/${spaceId}/metadata-fields?limit=20`,
      {
        headers: { authorization: "Bearer viewer-token" },
      },
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ items: [publicField()] });
    expect(fixture.list).toHaveBeenCalledWith({
      knowledgeSpaceId: spaceId,
      limit: 20,
      tenantId,
    });

    const denied = await fixture.app.request(`/knowledge-spaces/${spaceId}/metadata-fields`, {
      body: JSON.stringify({ name: "priority", type: "number" }),
      headers: {
        authorization: "Bearer viewer-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect(fixture.create).not.toHaveBeenCalled();

    const created = await fixture.app.request(`/knowledge-spaces/${spaceId}/metadata-fields`, {
      body: JSON.stringify({ name: "priority", type: "number" }),
      headers: {
        authorization: "Bearer editor-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(fixture.create).toHaveBeenCalledWith({
      knowledgeSpaceId: spaceId,
      name: "priority",
      now,
      subjectId: "editor-1",
      tenantId,
      type: "number",
    });
  });

  it("forwards row-version CAS on rename and deletion", async () => {
    const fixture = await createFixture();

    const renamed = await fixture.app.request(
      `/knowledge-spaces/${spaceId}/metadata-fields/${fieldId}`,
      {
        body: JSON.stringify({ expectedRowVersion: 3, name: "topic" }),
        headers: {
          authorization: "Bearer editor-token",
          "content-type": "application/json",
        },
        method: "PATCH",
      },
    );
    expect(renamed.status).toBe(200);
    expect(fixture.updateName).toHaveBeenCalledWith({
      expectedRowVersion: 3,
      fieldId,
      knowledgeSpaceId: spaceId,
      name: "topic",
      now,
      subjectId: "editor-1",
      tenantId,
    });

    const deleted = await fixture.app.request(
      `/knowledge-spaces/${spaceId}/metadata-fields/${fieldId}?expectedRowVersion=4`,
      { headers: { authorization: "Bearer editor-token" }, method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
    expect(fixture.deleteField).toHaveBeenCalledWith({
      expectedRowVersion: 4,
      fieldId,
      knowledgeSpaceId: spaceId,
      now,
      tenantId,
    });
  });

  it("publishes the field catalog routes in OpenAPI", async () => {
    const fixture = await createFixture();
    const spec = (await (await fixture.app.request("/openapi.json")).json()) as {
      paths?: Record<string, unknown>;
    };

    expect(spec.paths).toEqual(
      expect.objectContaining({
        "/knowledge-spaces/{id}/metadata-fields": expect.any(Object),
        "/knowledge-spaces/{id}/metadata-fields/{fieldId}": expect.any(Object),
      }),
    );
  });
});

async function createFixture() {
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => spaceId,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({ name: "Metadata", slug: "metadata", tenantId });
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
      now: () => now,
    }),
  });
  await access.initialize({
    knowledgeSpaceId: spaceId,
    ownerSubjectId: "owner-1",
    tenantId,
  });
  await access.setMemberRole({
    actorSubjectId: "owner-1",
    expectedRevision: 0,
    knowledgeSpaceId: spaceId,
    role: "viewer",
    subjectId: "viewer-1",
    tenantId,
  });
  await access.setMemberRole({
    actorSubjectId: "owner-1",
    expectedRevision: 0,
    knowledgeSpaceId: spaceId,
    role: "editor",
    subjectId: "editor-1",
    tenantId,
  });
  await access.updatePolicy({
    actorSubjectId: "owner-1",
    expectedRevision: 1,
    knowledgeSpaceId: spaceId,
    partialMemberSubjectIds: [],
    tenantId,
    visibility: "all_members",
  });

  const create = vi.fn<KnowledgeSpaceMetadataRepository["create"]>(async (input) =>
    field({ name: input.name, type: input.type }),
  );
  const deleteField = vi.fn<KnowledgeSpaceMetadataRepository["delete"]>(async () => undefined);
  const list = vi.fn<KnowledgeSpaceMetadataRepository["list"]>(async () => ({ items: [field()] }));
  const updateName = vi.fn<KnowledgeSpaceMetadataRepository["updateName"]>(async (input) =>
    field({ name: input.name, rowVersion: input.expectedRowVersion + 1 }),
  );
  const metadataFields: KnowledgeSpaceMetadataRepository = {
    create,
    delete: deleteField,
    list,
    reconcileDocument: async () => undefined,
    updateName,
    validatePatch: async () => undefined,
  };
  const app = createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        "editor-token": {
          scopes: ["knowledge-spaces:*"],
          subjectId: "editor-1",
          tenantId,
        },
        "viewer-token": {
          scopes: ["knowledge-spaces:read"],
          subjectId: "viewer-1",
          tenantId,
        },
      },
    }),
    knowledgeSpaceAccess: access,
    knowledgeSpaces: spaces,
    metadataFields,
    now: () => now,
  });
  return { app, create, deleteField, list, updateName };
}

function field(overrides: Partial<KnowledgeSpaceMetadataField> = {}): KnowledgeSpaceMetadataField {
  return {
    count: 2,
    createdAt: now,
    id: fieldId,
    knowledgeSpaceId: spaceId,
    name: "category",
    rowVersion: 3,
    tenantId,
    type: "string",
    updatedAt: now,
    ...overrides,
  };
}

function publicField() {
  const value = field();
  return {
    count: value.count,
    createdAt: value.createdAt,
    id: value.id,
    name: value.name,
    rowVersion: value.rowVersion,
    type: value.type,
    updatedAt: value.updatedAt,
  };
}
