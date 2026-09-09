import { describe, expect, it, vi } from "vitest";
import { createGraphQueryPlanner } from "./graph-query-planner";
import {
  graphCandidates,
  graphPlan,
  graphRepository,
  graphRetrievalInput,
} from "./graph-query.fixtures";
import { createGraphSemanticQueryService } from "./graph-semantic-query";
import { ResearchModelCallObserverError } from "./research-model-usage";

describe("grounded semantic graph planning", () => {
  it("uses the frozen knowledge model once and accounts for the call exactly once", async () => {
    const generate = vi.fn(async () => ({ model: "reason", text: JSON.stringify(graphPlan) }));
    const observer = { before: vi.fn(), after: vi.fn() };
    const planner = createGraphQueryPlanner({
      maxOutputTokens: 2048,
      providerFactory: () => ({ generate }),
    });
    expect(
      await planner.plan({
        retrieval: { ...graphRetrievalInput, researchModelCallObserver: observer },
        candidates: graphCandidates,
      }),
    ).toEqual(graphPlan);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "reason",
        tenantId: "tenant-graph",
        signal: expect.any(AbortSignal),
        maxOutputTokens: 2048,
        structuredOutputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            steps: expect.objectContaining({
              items: expect.objectContaining({
                properties: expect.objectContaining({
                  targetTypes: expect.objectContaining({
                    items: expect.objectContaining({
                      enum: expect.arrayContaining(["person", "organization"]),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(observer.before).toHaveBeenCalledTimes(1);
    expect(observer.after).toHaveBeenCalledTimes(1);
    expect(observer.after).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });
  it("does not reconcile twice or degrade away failed model accounting", async () => {
    const observer = {
      before: vi.fn(),
      after: vi.fn(async () => {
        throw new Error("ledger down");
      }),
    };
    const service = createGraphSemanticQueryService({
      repository: graphRepository(),
      planner: createGraphQueryPlanner({
        maxOutputTokens: 2048,
        providerFactory: () => ({
          generate: async () => ({ model: "reason", text: JSON.stringify(graphPlan) }),
        }),
      }),
    });
    await expect(
      service.query({ ...graphRetrievalInput, researchModelCallObserver: observer }),
    ).rejects.toBeInstanceOf(ResearchModelCallObserverError);
    expect(observer.after).toHaveBeenCalledTimes(1);
  });
  it("returns explicit degradation for invalid/truncated model output", async () => {
    const service = createGraphSemanticQueryService({
      repository: graphRepository(),
      planner: createGraphQueryPlanner({
        maxOutputTokens: 2048,
        providerFactory: () => ({
          generate: async () => ({ model: "reason", text: "{broken", finishReason: "length" }),
        }),
      }),
    });
    expect(await service.query(graphRetrievalInput)).toMatchObject({
      status: "unavailable",
      flags: ["graph-query-unavailable"],
      paths: [],
    });
  });
  it("reports planner deadlines as a timed-out graph leg without failing document retrieval", async () => {
    const service = createGraphSemanticQueryService({
      repository: graphRepository(),
      planner: {
        plan: async () => {
          throw new DOMException("Planner deadline", "TimeoutError");
        },
      },
    });
    expect(await service.query(graphRetrievalInput)).toMatchObject({
      status: "unavailable",
      flags: ["graph-query-timeout"],
      paths: [],
    });
  });
  it("rechecks custom planner grounding, carries partial coverage, and propagates cancellation", async () => {
    const repository = graphRepository();
    repository.loadEntities = vi.fn(repository.loadEntities);
    const service = createGraphSemanticQueryService({
      repository,
      planner: { plan: async () => ({ ...graphPlan, startEntityIds: ["forbidden"] }) },
    });
    expect((await service.query(graphRetrievalInput)).status).toBe("unavailable");
    expect(repository.loadEntities).not.toHaveBeenCalled();
    repository.search = async () => ({ ...graphCandidates, semanticCoverage: "partial" });
    const working = createGraphSemanticQueryService({
      repository,
      planner: { plan: async () => graphPlan },
    });
    expect(await working.query(graphRetrievalInput)).toMatchObject({
      status: "ready",
      flags: ["graph-semantic-index-partial"],
    });
    await expect(
      working.query({
        ...graphRetrievalInput,
        signal: AbortSignal.abort(new Error("disconnected")),
      }),
    ).rejects.toThrow("disconnected");
  });
  it("rejects mismatched publication scope and does not call a model when no candidates exist", async () => {
    const generate = vi.fn();
    const planner = createGraphQueryPlanner({
      maxOutputTokens: 2048,
      providerFactory: () => ({ generate }),
    });
    expect(
      (
        await planner.plan({
          retrieval: graphRetrievalInput,
          candidates: { entities: [], relations: [], semanticCoverage: "missing" },
        })
      ).status,
    ).toBe("not-applicable");
    expect(generate).not.toHaveBeenCalled();
    const service = createGraphSemanticQueryService({ repository: graphRepository(), planner });
    await expect(service.query({ ...graphRetrievalInput, tenantId: "wrong" })).rejects.toThrow(
      "scope mismatch",
    );
  });
});
