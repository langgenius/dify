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
  KnowledgeSpaceAttentionIssue,
  KnowledgeSpaceOverviewRepository,
} from "./knowledge-space-overview";

const TENANT_ID = "tenant-overview";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const EVENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const NOW = "2026-07-14T14:00:00.000Z";
const ISSUE_KEY = `failed-document:document:${DOCUMENT_ID}`;

describe("knowledge-space Overview HTTP API", () => {
  it("allows viewer reads, strips internal ACL scope, and passes the authorization snapshot", async () => {
    const fixture = await createFixture();

    const response = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/overview/activity?limit=5`,
      { headers: { authorization: "Bearer viewer-token" } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual([
      expect.objectContaining({ action: "document.failed", id: EVENT_ID }),
    ]);
    expect(body.items[0]).not.toHaveProperty("tenantId");
    expect(body.items[0]).not.toHaveProperty("knowledgeSpaceId");
    expect(body.items[0]).not.toHaveProperty("requiredPermissionScope");
    expect(fixture.listActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateGrants: expect.any(Array),
        knowledgeSpaceId: SPACE_ID,
        tenantId: TENANT_ID,
      }),
    );
    expect(fixture.listActivity.mock.calls[0]?.[0].candidateGrants.length).toBeGreaterThan(0);
  });

  it("requires write access for attention CAS transitions", async () => {
    const fixture = await createFixture();
    const url = `/knowledge-spaces/${SPACE_ID}/overview/attention/${encodeURIComponent(ISSUE_KEY)}`;

    const viewer = await fixture.app.request(url, {
      body: JSON.stringify({ expectedRevision: 1, status: "resolved" }),
      headers: { authorization: "Bearer viewer-token", "content-type": "application/json" },
      method: "PATCH",
    });
    expect(viewer.status).toBe(403);
    expect(fixture.transitionAttention).not.toHaveBeenCalled();

    const editor = await fixture.app.request(url, {
      body: JSON.stringify({ expectedRevision: 1, status: "resolved" }),
      headers: { authorization: "Bearer editor-token", "content-type": "application/json" },
      method: "PATCH",
    });
    expect(editor.status).toBe(200);
    const body = (await editor.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ issueKey: ISSUE_KEY, revision: 2, status: "resolved" });
    expect(body).not.toHaveProperty("requiredPermissionScope");
    expect(fixture.transitionAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        issueKey: ISSUE_KEY,
        permission: expect.objectContaining({
          accessChannel: "interactive",
          candidateGrants: expect.arrayContaining([`tenant:${TENANT_ID}`]),
          permissionSnapshotId: expect.any(String),
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "editor-1",
        }),
        tenantId: TENANT_ID,
      }),
    );
    const transition = fixture.transitionAttention.mock.calls[0]?.[0];
    expect(transition?.permission.candidateGrants).toEqual(transition?.candidateGrants);
  });

  it("publishes all Overview product routes in OpenAPI", async () => {
    const fixture = await createFixture();
    const spec = (await (await fixture.app.request("/openapi.json")).json()) as {
      paths?: Record<string, unknown>;
    };
    expect(spec.paths).toEqual(
      expect.objectContaining({
        "/knowledge-spaces/{id}/overview/activity": expect.any(Object),
        "/knowledge-spaces/{id}/overview/attention": expect.any(Object),
        "/knowledge-spaces/{id}/overview/attention/{issueKey}": expect.any(Object),
        "/knowledge-spaces/{id}/overview/health": expect.any(Object),
        "/knowledge-spaces/{id}/overview/inventory": expect.any(Object),
        "/knowledge-spaces/{id}/overview/query-outcomes": expect.any(Object),
        "/knowledge-spaces/{id}/overview/stats": expect.any(Object),
      }),
    );
  });
});

async function createFixture() {
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => SPACE_ID,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({ name: "Overview", slug: "overview", tenantId: TENANT_ID });
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
      now: () => NOW,
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
    role: "viewer",
    subjectId: "viewer-1",
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

  const issue = attentionIssue();
  const listActivity = vi.fn<KnowledgeSpaceOverviewRepository["listActivity"]>(async () => ({
    items: [
      {
        action: "document.failed",
        actor: { type: "system" },
        details: { documentType: "application/pdf" },
        id: EVENT_ID,
        knowledgeSpaceId: SPACE_ID,
        occurredAt: NOW,
        requiredPermissionScope: ["subject:viewer-1"],
        resource: { id: DOCUMENT_ID, type: "document" },
        result: "failure",
        tenantId: TENANT_ID,
      },
    ],
  }));
  const transitionAttention = vi.fn<KnowledgeSpaceOverviewRepository["transitionAttention"]>(
    async () => ({ ...issue, revision: 2, status: "resolved" }),
  );
  const overview: KnowledgeSpaceOverviewRepository = {
    appendActivity: async () => {
      throw new Error("not used");
    },
    getHealth: async () => ({
      components: {
        index: { codes: [], state: "healthy" },
        ingestion: { codes: [], state: "healthy" },
        profilePublication: { codes: [], state: "healthy" },
        queryAvailability: { codes: [], state: "healthy" },
        sourceFreshness: { codes: [], state: "healthy" },
        workerReadiness: { codes: [], state: "healthy" },
      },
      generatedAt: NOW,
      knowledgeSpaceId: SPACE_ID,
      state: "healthy",
    }),
    getInventory: async () => ({
      generatedAt: NOW,
      graphEntities: { addedLast7d: 0, total: 0 },
      graphRelations: { addedLast7d: 0, total: 0 },
      indexCoverage: { indexed: 0, percentage: 0, total: 0 },
      knowledgeSpaceId: SPACE_ID,
      sourceCategories: { crawl: 0, onlineDocuments: 0, onlineDrives: 0, uploads: 0 },
    }),
    getQueryOutcomes: async (input) => ({
      buckets: [],
      current: {
        answerRate: 0,
        answered: 0,
        lowConfidence: 0,
        noEvidence: 0,
        queryCount: 0,
      },
      generatedAt: NOW,
      knowledgeSpaceId: SPACE_ID,
      previous: {
        answerRate: 0,
        answered: 0,
        lowConfidence: 0,
        noEvidence: 0,
        queryCount: 0,
      },
      previousSince: NOW,
      since: NOW,
      window: input.window,
    }),
    getStats: async () => ({
      current: {
        freshSourceCount: 0,
        knowledgeCount: 0,
        linkedAppCount: 0,
        sourceCount: 0,
        staleSourceCount: 0,
      },
      generatedAt: NOW,
      knowledgeSpaceId: SPACE_ID,
      windows: {
        "24h": { answerRate: 0, answeredQueryCount: 0, queryCount: 0, since: NOW },
        "30d": { answerRate: 0, answeredQueryCount: 0, queryCount: 0, since: NOW },
        "7d": { answerRate: 0, answeredQueryCount: 0, queryCount: 0, since: NOW },
      },
    }),
    listActivity,
    listAttention: async () => [issue],
    transitionAttention,
  };
  const app = createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        "editor-token": {
          scopes: ["knowledge-spaces:*"],
          subjectId: "editor-1",
          tenantId: TENANT_ID,
        },
        "viewer-token": {
          scopes: ["knowledge-spaces:read"],
          subjectId: "viewer-1",
          tenantId: TENANT_ID,
        },
      },
    }),
    knowledgeSpaceAccess: access,
    knowledgeSpaceOverview: overview,
    knowledgeSpaces: spaces,
    now: () => NOW,
  });
  return { app, listActivity, transitionAttention };
}

function attentionIssue(): KnowledgeSpaceAttentionIssue {
  return {
    action: { kind: "open-resource", resourceId: DOCUMENT_ID, resourceType: "document" },
    evidence: [{ code: "DOCUMENT_PROCESSING_FAILED", observedAt: NOW }],
    issueKey: ISSUE_KEY,
    knowledgeSpaceId: SPACE_ID,
    requiredPermissionScope: ["subject:viewer-1"],
    resource: { id: DOCUMENT_ID, type: "document" },
    revision: 1,
    ruleId: "failed-document",
    severity: "critical",
    status: "active",
    title: "Document processing failed",
    updatedAt: NOW,
  };
}
