import { describe, expect, it } from "vitest";

import {
  createInMemoryKnowledgeSpaceOverviewRepository,
  decodeKnowledgeSpaceActivityCursor,
  deterministicKnowledgeSpaceActivityId,
  encodeKnowledgeSpaceActivityCursor,
} from "./knowledge-space-overview";

const TENANT_ID = "tenant-overview";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const QUERY_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const NOW = "2026-07-14T14:00:00.000Z";

describe("in-memory knowledge-space Overview repository", () => {
  it("enforces semantic idempotency while allowing a commit retry timestamp to drift", async () => {
    const repository = createInMemoryKnowledgeSpaceOverviewRepository({
      maxEvents: 1,
      maxListLimit: 10,
    });
    const id = deterministicKnowledgeSpaceActivityId("query.requested", TENANT_ID, QUERY_ID);
    const input = {
      action: "query.requested" as const,
      actor: { id: "member-1", type: "member" as const },
      details: { apiKey: "must-not-leak", mode: "fast", query: "must-not-leak" },
      id,
      knowledgeSpaceId: SPACE_ID,
      occurredAt: NOW,
      requiredPermissionScope: ["team:camera"],
      resource: { id: QUERY_ID, type: "query" as const },
      result: "pending" as const,
      tenantId: TENANT_ID,
    };

    const first = await repository.appendActivity(input);
    const replay = await repository.appendActivity({
      ...input,
      occurredAt: "2026-07-14T14:00:01.000Z",
    });

    expect(replay).toEqual(first);
    expect(first.details).toEqual({ mode: "fast" });
    await expect(repository.appendActivity({ ...input, result: "failure" })).rejects.toThrow(
      "idempotency key",
    );
    await expect(repository.appendActivity({ ...input, tenantId: "tenant-other" })).rejects.toThrow(
      "idempotency key",
    );
  });

  it("counts distinct requested query identities and only their later successful completion", async () => {
    const repository = createInMemoryKnowledgeSpaceOverviewRepository({
      maxEvents: 20,
      maxListLimit: 10,
    });
    const append = (
      id: string,
      action: "query.completed" | "query.requested",
      occurredAt: string,
      resourceId = QUERY_ID,
    ) =>
      repository.appendActivity({
        action,
        actor: { id: "member-1", type: "member" },
        id,
        knowledgeSpaceId: SPACE_ID,
        occurredAt,
        requiredPermissionScope: ["team:camera"],
        resource: { id: resourceId, type: "query" },
        result: action === "query.requested" ? "pending" : "success",
        tenantId: TENANT_ID,
      });

    // A terminal event cannot create an answer before its matching request.
    await append(
      "00000000-0000-4000-8000-000000000001",
      "query.completed",
      "2026-07-14T12:59:00.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000002",
      "query.requested",
      "2026-07-14T13:00:00.000Z",
    );
    // Request and completion retries have different event ids but one logical query identity.
    await append(
      "00000000-0000-4000-8000-000000000003",
      "query.requested",
      "2026-07-14T13:00:01.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000004",
      "query.completed",
      "2026-07-14T13:01:00.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000005",
      "query.completed",
      "2026-07-14T13:01:01.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000006",
      "query.completed",
      "2026-07-14T13:02:00.000Z",
      "query-without-request",
    );

    const stats = await repository.getStats({
      candidateGrants: ["team:camera"],
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      subjectId: "member-1",
      tenantId: TENANT_ID,
    });
    expect(stats.windows["24h"]).toMatchObject({
      answerRate: 1,
      answeredQueryCount: 1,
      queryCount: 1,
    });
    const hidden = await repository.getStats({
      candidateGrants: [],
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      subjectId: "member-1",
      tenantId: TENANT_ID,
    });
    expect(hidden.windows["24h"]).toMatchObject({
      answerRate: 0,
      answeredQueryCount: 0,
      queryCount: 0,
    });
  });

  it("buckets a retried query once and keeps outcome categories mutually exclusive", async () => {
    const repository = createInMemoryKnowledgeSpaceOverviewRepository({
      maxEvents: 20,
      maxListLimit: 10,
    });
    const append = (
      id: string,
      action: "query.completed" | "query.failed" | "query.requested",
      occurredAt: string,
      details: Readonly<Record<string, unknown>> = {},
    ) =>
      repository.appendActivity({
        action,
        actor: { id: "member-1", type: "member" },
        details,
        id,
        knowledgeSpaceId: SPACE_ID,
        occurredAt,
        requiredPermissionScope: ["team:camera"],
        resource: { id: QUERY_ID, type: "query" },
        result:
          action === "query.requested"
            ? "pending"
            : action === "query.completed"
              ? "success"
              : "failure",
        tenantId: TENANT_ID,
      });

    // Insert the retry first so the reducer must move the identity to its earliest request bucket.
    await append(
      "00000000-0000-4000-8000-000000000011",
      "query.requested",
      "2026-07-14T13:30:00.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000012",
      "query.requested",
      "2026-07-14T12:30:00.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000013",
      "query.completed",
      "2026-07-14T13:31:00.000Z",
    );
    await append(
      "00000000-0000-4000-8000-000000000014",
      "query.failed",
      "2026-07-14T13:32:00.000Z",
      { reasonCode: "no-evidence" },
    );

    const outcomes = await repository.getQueryOutcomes({
      candidateGrants: ["team:camera"],
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      subjectId: "member-1",
      tenantId: TENANT_ID,
      window: "24h",
    });

    expect(outcomes.current).toMatchObject({
      answerRate: 0,
      answered: 0,
      lowConfidence: 0,
      noEvidence: 1,
      queryCount: 1,
    });
    expect(outcomes.buckets.filter((bucket) => bucket.queryCount > 0)).toHaveLength(1);
  });

  it("round-trips opaque activity cursors and rejects malformed input", () => {
    const cursor = { id: QUERY_ID, occurredAt: NOW };
    expect(decodeKnowledgeSpaceActivityCursor(encodeKnowledgeSpaceActivityCursor(cursor))).toEqual(
      cursor,
    );
    expect(() => decodeKnowledgeSpaceActivityCursor("not-a-cursor")).toThrow(
      "Invalid activity cursor",
    );
  });
});
