import { describe, expect, it } from "vitest";

import {
  ResearchTaskDryRunPlanResponseSchema,
  ResearchTaskJobResponseSchema,
  ResearchTaskPartialResultListResponseSchema,
} from "./research-task-response-schemas";

const UUID_A = "00000000-0000-4000-8000-000000000001";

describe("research-task-response-schemas", () => {
  it("accepts research job and partial-result list responses", () => {
    const job = ResearchTaskJobResponseSchema.parse({
      cost: { entries: [], totalUsd: 0 },
      createdAt: 1,
      id: "research-1",
      knowledgeSpaceId: UUID_A,
      metadata: {},
      permissionSnapshot: {
        accessChannel: "interactive",
        id: UUID_A,
        revision: 1,
      },
      query: "What changed?",
      queueJobId: "queue-1",
      stage: "completed",
      subjectId: "subject-1",
      tenantId: "tenant-a",
      updatedAt: 2,
    });

    expect(job).toMatchObject({ stage: "completed" });
    expect(job).not.toHaveProperty("permissionSnapshot");
    expect(job).not.toHaveProperty("queueJobId");
    expect(job).not.toHaveProperty("subjectId");
    expect(job).not.toHaveProperty("tenantId");
    expect(job).not.toHaveProperty("mode");
    expect(job).not.toHaveProperty("topK");
    expect(ResearchTaskJobResponseSchema.parse({ ...job, mode: "deep", topK: 7 })).toMatchObject({
      mode: "deep",
      topK: 7,
    });

    expect(
      ResearchTaskPartialResultListResponseSchema.parse({
        items: [
          {
            evidenceBundle: {
              createdAt: "2026-05-14T00:00:00.000Z",
              id: UUID_A,
              items: [],
              query: "What changed?",
              state: "not-enough-evidence",
            },
            knowledgeSpaceId: UUID_A,
            researchTaskJobId: "research-1",
            sequence: 1,
            tenantId: "tenant-a",
          },
        ],
      }),
    ).toMatchObject({ items: [{ sequence: 1 }] });
  });

  it("rejects invalid persisted retrieval settings", () => {
    const base = {
      cost: { entries: [], totalUsd: 0 },
      createdAt: 1,
      id: "research-1",
      knowledgeSpaceId: UUID_A,
      metadata: {},
      permissionSnapshot: {
        accessChannel: "interactive",
        id: UUID_A,
        revision: 1,
      },
      query: "What changed?",
      queueJobId: "queue-1",
      stage: "queued",
      subjectId: "subject-1",
      tenantId: "tenant-a",
      updatedAt: 2,
    };

    expect(ResearchTaskJobResponseSchema.safeParse({ ...base, mode: "invalid" }).success).toBe(
      false,
    );
    expect(ResearchTaskJobResponseSchema.safeParse({ ...base, topK: 0 }).success).toBe(false);
  });

  it("accepts dry-run plan responses with bounded plan estimates", () => {
    expect(
      ResearchTaskDryRunPlanResponseSchema.parse({
        budget: { exceedsBudget: false },
        estimates: {
          cacheHitProbability: 0.5,
          costUsd: { currency: "USD", estimated: 0.1, max: 0.2, min: 0 },
          inputTokens: 100,
          latencyMs: { p50: 50, p95: 100 },
          outputTokens: 40,
          retrievalSteps: 2,
          scannedResources: 10,
          toolCalls: 1,
          totalTokens: 140,
        },
        knowledgeSpaceId: UUID_A,
        query: "What changed?",
        retrievalPlan: {
          denseTopK: 0,
          ftsTopK: 0,
          fusionLimit: 0,
          queryLanguage: "latin",
          requestedMode: "research",
          rerankCandidateLimit: 0,
          resolvedMode: "research",
          strategyVersion: "v1",
          topK: 5,
        },
        steps: [
          {
            estimatedCostUsd: 0.01,
            estimatedInputTokens: 10,
            estimatedLatencyMs: 50,
            estimatedOutputTokens: 5,
            estimatedToolCalls: 0,
            name: "plan",
          },
        ],
        strategyVersion: "research-dry-run-planner-v1",
      }),
    ).toMatchObject({ strategyVersion: "research-dry-run-planner-v1" });
  });
});
