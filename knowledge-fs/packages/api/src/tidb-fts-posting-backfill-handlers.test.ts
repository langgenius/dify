import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  type TidbFtsPostingBackfill,
  TidbFtsPostingBackfillTransitionError,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const token = "operator-token";
const spaceId = "10000000-0000-4000-8000-000000000001";

describe("TiDB FTS posting backfill operator routes", () => {
  it("returns tenant-scoped status without the worker fence and maps conflicts to 409", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => spaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({ name: "Tenant docs", slug: "tenant-docs", tenantId: "tenant-1" });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [token]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "operator-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: spaceId, ownerSubjectId: "operator-1" },
      ]),
      knowledgeSpaces: spaces,
      tidbFtsPostingBackfillService: {
        get: async () => job(),
        retry: async () => {
          throw new TidbFtsPostingBackfillTransitionError("retry conflict");
        },
        start: async () => job(),
      },
    });

    const status = await app.request(`/knowledge-spaces/${spaceId}/tidb-fts-posting-backfill`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(200);
    const statusCopy = status.clone();
    await expect(status.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      runState: "failed",
      tokenizerVersion: "mixed-nfkc-v1",
    });
    expect(await statusCopy.text()).not.toContain("40000000-0000-4000-8000-000000000001");

    const retry = await app.request(
      `/knowledge-spaces/${spaceId}/tidb-fts-posting-backfill/retry`,
      { headers: { authorization: `Bearer ${token}` }, method: "POST" },
    );
    expect(retry.status).toBe(409);
    await expect(retry.json()).resolves.toEqual({ error: "retry conflict" });
  });

  it("keeps the control plane unavailable without a durable TiDB repository", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => spaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    await spaces.create({ name: "Tenant docs", slug: "tenant-docs", tenantId: "tenant-1" });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [token]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "operator-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: spaceId, ownerSubjectId: "operator-1" },
      ]),
      knowledgeSpaces: spaces,
    });
    const response = await app.request(`/knowledge-spaces/${spaceId}/tidb-fts-posting-backfill`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(503);
  });
});

function job(): TidbFtsPostingBackfill {
  return {
    completedAt: "2026-07-14T00:00:10.000Z",
    createdAt: "2026-07-14T00:00:00.000Z",
    id: "20000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: spaceId,
    lastErrorCode: "TOKENIZER_ERROR",
    lastErrorMessage: "bad historical source",
    leaseToken: "40000000-0000-4000-8000-000000000001",
    retryCount: 0,
    rowVersion: 2,
    runState: "failed",
    scannedProjections: 0,
    tenantId: "tenant-1",
    tokenizerVersion: "mixed-nfkc-v1",
    updatedAt: "2026-07-14T00:00:10.000Z",
    writtenPostings: 0,
  };
}
