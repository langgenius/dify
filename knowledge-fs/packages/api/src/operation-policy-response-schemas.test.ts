import { describe, expect, it } from "vitest";

import {
  BulkOperationProgressResponseSchema,
  RetentionPolicyResponseSchema,
} from "./operation-policy-response-schemas";

describe("operation-policy-response-schemas", () => {
  it("accepts bounded bulk operation progress payloads", () => {
    expect(
      BulkOperationProgressResponseSchema.parse({
        canceledItems: 0,
        completedItems: 4,
        createdAt: "2026-05-14T00:00:00.000Z",
        failedItemIds: ["doc-3"],
        failedItems: 1,
        id: "bulk-1",
        knowledgeSpaceId: "space-1",
        status: "running",
        totalItems: 10,
        type: "document_reindex",
        updatedAt: "2026-05-14T00:01:00.000Z",
      }),
    ).toMatchObject({ failedItems: 1, status: "running" });
  });

  it("accepts tenant and knowledge-space retention policies", () => {
    const tenantPolicy = RetentionPolicyResponseSchema.parse({
      answerTraceRetentionDays: 30,
      createdAt: "2026-05-14T00:00:00.000Z",
      evidenceCacheRetentionDays: 14,
      id: "policy-1",
      inactiveProjectionRetentionDays: 7,
      knowledgeSpaceId: null,
      parseArtifactVersions: 3,
      rawDocumentRetentionDays: null,
      scope: "tenant",
      sessionInactivityMinutes: 60,
      tenantId: "tenant-a",
      updatedAt: "2026-05-14T00:01:00.000Z",
    });

    expect(tenantPolicy).toMatchObject({ knowledgeSpaceId: null, scope: "tenant" });

    expect(
      RetentionPolicyResponseSchema.parse({
        ...tenantPolicy,
        knowledgeSpaceId: "00000000-0000-4000-8000-000000000001",
        rawDocumentRetentionDays: 90,
        scope: "knowledge_space",
      }),
    ).toMatchObject({ rawDocumentRetentionDays: 90, scope: "knowledge_space" });
  });
});
