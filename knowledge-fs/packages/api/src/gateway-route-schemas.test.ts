import { describe, expect, it } from "vitest";

import {
  AnswerTraceParamsSchema,
  BulkOperationParamsSchema,
  CreateProductionBadCaseSchema,
  ErrorResponseSchema,
  GraphTraverseQuerySchema,
  QueryStreamRequestSchema,
  QueryVirtualTreeListQuerySchema,
  RetentionPolicyPatchSchema,
} from "./gateway-route-schemas";

const TRACE_ID = "00000000-0000-4000-8000-000000000001";
const SPACE_ID = "00000000-0000-4000-8000-000000000002";

describe("gateway-route-schemas", () => {
  it("validates shared bounded route params and error responses", () => {
    expect(ErrorResponseSchema.parse({ error: "Unauthorized" })).toEqual({
      error: "Unauthorized",
    });
    expect(
      ErrorResponseSchema.parse({ code: "SOURCE_SYNC_FAILED", error: "Source sync failed" }),
    ).toEqual({
      code: "SOURCE_SYNC_FAILED",
      error: "Source sync failed",
    });
    expect(BulkOperationParamsSchema.parse({ id: "bulk-1" })).toEqual({ id: "bulk-1" });
    expect(AnswerTraceParamsSchema.parse({ traceId: TRACE_ID })).toEqual({ traceId: TRACE_ID });

    expect(() => AnswerTraceParamsSchema.parse({ traceId: "not-a-uuid" })).toThrow();
  });

  it("coerces bounded graph and virtual tree query values", () => {
    expect(
      GraphTraverseQuerySchema.parse({
        depth: "2",
        entityId: TRACE_ID,
        fanout: "10",
        maxNodes: "25",
        timeoutMs: "500",
      }),
    ).toEqual({
      depth: 2,
      entityId: TRACE_ID,
      fanout: 10,
      maxNodes: 25,
      timeoutMs: 500,
    });

    expect(QueryVirtualTreeListQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
    expect(() => GraphTraverseQuerySchema.parse({ entityId: TRACE_ID, maxNodes: "201" })).toThrow();
  });

  it("validates retention patches and query stream requests", () => {
    expect(
      RetentionPolicyPatchSchema.parse({
        parseArtifactVersions: 3,
        rawDocumentRetentionDays: null,
      }),
    ).toEqual({ parseArtifactVersions: 3, rawDocumentRetentionDays: null });

    expect(
      QueryStreamRequestSchema.parse({
        activeDocumentIds: [TRACE_ID],
        knowledgeSpaceId: SPACE_ID,
        query: "what changed?",
      }),
    ).toEqual({
      activeDocumentIds: [TRACE_ID],
      activeEntityIds: [],
      knowledgeSpaceId: SPACE_ID,
      query: "what changed?",
    });

    expect(() =>
      QueryStreamRequestSchema.parse({
        activeDocumentIds: Array.from({ length: 101 }, () => TRACE_ID),
        knowledgeSpaceId: SPACE_ID,
        query: "too many active docs",
      }),
    ).toThrow();
  });

  it("validates production bad-case capture inputs", () => {
    expect(
      CreateProductionBadCaseSchema.parse({
        reason: "missed citation",
        tags: ["retrieval"],
        traceId: TRACE_ID,
      }),
    ).toEqual({
      reason: "missed citation",
      tags: ["retrieval"],
      traceId: TRACE_ID,
    });

    expect(() =>
      CreateProductionBadCaseSchema.parse({
        tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
        traceId: TRACE_ID,
      }),
    ).toThrow();
  });
});
