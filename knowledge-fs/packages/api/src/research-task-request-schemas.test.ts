import { describe, expect, it } from "vitest";

import {
  CreateResearchTaskSchema,
  ListResearchTaskPartialsQuerySchema,
  ListResearchTaskProgressQuerySchema,
  PlanResearchTaskSchema,
  ResearchTaskJobParamsSchema,
} from "./research-task-request-schemas";

const SPACE_ID = "00000000-0000-4000-8000-000000000001";

describe("research-task-request-schemas", () => {
  it("validates create and dry-run planning requests with bounded inputs", () => {
    expect(
      CreateResearchTaskSchema.parse({
        budgetUsd: 2.5,
        knowledgeSpaceId: SPACE_ID,
        limits: { maxRetrievalSteps: 3, maxToolCalls: 5 },
        mode: "research",
        query: "Summarize the migration plan",
        topK: 20,
      }),
    ).toMatchObject({
      metadata: {},
      topK: 20,
    });

    expect(
      PlanResearchTaskSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        query: "Estimate cost",
        topK: 5,
      }),
    ).toMatchObject({ mode: "fast", topK: 5 });
  });

  it("validates params and paginated partial/progress query defaults", () => {
    expect(ResearchTaskJobParamsSchema.parse({ id: "job-1" })).toEqual({ id: "job-1" });
    expect(ListResearchTaskPartialsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(ListResearchTaskProgressQuerySchema.parse({ cursor: "abc", limit: "50" })).toEqual({
      cursor: "abc",
      limit: 50,
    });
  });

  it("rejects unbounded research task fanout", () => {
    expect(() =>
      CreateResearchTaskSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        query: "Too wide",
        topK: 51,
      }),
    ).toThrow();
    expect(() =>
      PlanResearchTaskSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        query: "Explicit overrides keep the public ceiling",
        topK: 51,
      }),
    ).toThrow();
    expect(() => ListResearchTaskPartialsQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() =>
      CreateResearchTaskSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        permissionScope: { grants: ["admin"] },
        query: "Untrusted grants",
      }),
    ).toThrow();
  });
});
