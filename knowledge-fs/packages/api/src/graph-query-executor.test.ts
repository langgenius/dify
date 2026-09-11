import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import { GraphQueryPlanSchema, groundGraphQueryPlan } from "./graph-query-contracts";
import { executeGraphQueryPaths } from "./graph-query-executor";
import {
  graphCandidates,
  graphEntity,
  graphId,
  graphPlan,
  graphRelation,
  graphRepository,
  graphScope,
} from "./graph-query.fixtures";

const step = graphPlan.steps[0];
assert(step);
describe("constrained graph path execution", () => {
  it("returns only genuine directed paths and provenance, including indirect-only traversal", async () => {
    const result = await executeGraphQueryPaths({
      ...graphScope,
      repository: graphRepository(),
      plan: { ...graphPlan, steps: [{ ...step, minHops: 2 }] },
    });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toMatchObject({
      entityIds: [graphId(10), graphId(11), graphId(12)],
      entityNames: ["Service 10", "Service 11", "Service 12"],
      sourceNodeIds: [graphId(110), graphId(111), graphId(112)],
    });
    expect(result.truncated).toBe(false);
  });
  it("supports inverse dependencies without changing stored subject/object orientation", async () => {
    const result = await executeGraphQueryPaths({
      ...graphScope,
      repository: graphRepository(),
      plan: {
        ...graphPlan,
        startEntityIds: [graphId(12)],
        steps: [{ ...step, direction: "incoming" }],
      },
    });
    expect(result.paths.map((path) => path.entityIds)).toEqual([
      [graphId(12), graphId(11)],
      [graphId(12), graphId(11), graphId(10)],
    ]);
    expect(result.paths[0]?.edges[0]?.relation.subjectEntityId).toBe(graphId(11));
  });
  it("enforces ordered relation steps, endpoint constraints, and does not emit partial conjunctions", async () => {
    const repository = graphRepository(undefined, [
      graphRelation(20, 10, 11, { type: "responsible_for" }),
      graphRelation(21, 11, 12),
    ]);
    const plan = {
      ...graphPlan,
      steps: [
        { ...step, relationTypes: ["responsible_for" as const], maxHops: 1 },
        {
          ...step,
          maxHops: 1,
          targetEntityIds: [graphId(12)],
          targetTypes: ["product"],
        },
      ],
    };
    expect((await executeGraphQueryPaths({ ...graphScope, repository, plan })).paths).toHaveLength(
      1,
    );
    const secondStep = plan.steps[1];
    assert(secondStep);
    expect(
      (
        await executeGraphQueryPaths({
          ...graphScope,
          repository,
          plan: {
            ...plan,
            steps: [...plan.steps.slice(0, 1), { ...secondStep, targetTypes: ["person"] }],
          },
        })
      ).paths,
    ).toEqual([]);
  });
  it("does not bridge homonyms or cycles", async () => {
    const repository = graphRepository(
      [graphEntity(10), graphEntity(11), graphEntity(12, { name: "Service 11" }), graphEntity(13)],
      [graphRelation(20, 10, 11), graphRelation(21, 11, 10), graphRelation(22, 12, 13)],
    );
    const result = await executeGraphQueryPaths({ ...graphScope, repository, plan: graphPlan });
    expect(result.paths.map((path) => path.entityIds)).toEqual([[graphId(10), graphId(11)]]);
  });
  it("does not cross hidden entities and marks edge/path limits as truncated", async () => {
    const hidden = graphRepository([
      graphEntity(10),
      graphEntity(11, { permissionScope: ["secret"] }),
      graphEntity(12),
    ]);
    expect(
      (await executeGraphQueryPaths({ ...graphScope, repository: hidden, plan: graphPlan })).paths,
    ).toEqual([]);
    expect(
      (
        await executeGraphQueryPaths({
          ...graphScope,
          repository: graphRepository(),
          plan: graphPlan,
          maxEdges: 1,
        })
      ).truncated,
    ).toBe(true);
    expect(
      (
        await executeGraphQueryPaths({
          ...graphScope,
          repository: graphRepository(),
          plan: graphPlan,
          maxPaths: 1,
        })
      ).truncated,
    ).toBe(true);
  });
  it("stops canceled work before reading roots", async () => {
    const repository = graphRepository();
    repository.loadEntities = vi.fn(repository.loadEntities);
    await expect(
      executeGraphQueryPaths({
        ...graphScope,
        repository,
        plan: graphPlan,
        signal: AbortSignal.abort(new Error("lease lost")),
      }),
    ).rejects.toThrow("lease lost");
    expect(repository.loadEntities).not.toHaveBeenCalled();
  });
  it("rejects a malformed adapter returning wrong directions or tenant roots", async () => {
    const repository = graphRepository();
    const loadEdges = repository.loadEdges;
    repository.loadEdges = async (input) => {
      const result = await loadEdges(input);
      return {
        ...result,
        edges: result.edges.map((entry) => ({
          ...entry,
          edge: { ...entry.edge, relation: { ...entry.edge.relation, type: "owns" } },
        })),
      };
    };
    await expect(
      executeGraphQueryPaths({ ...graphScope, repository, plan: graphPlan }),
    ).rejects.toThrow("constrained plan");
    repository.loadEntities = async () => [graphEntity(10, { knowledgeSpaceId: "other-space" })];
    await expect(
      executeGraphQueryPaths({ ...graphScope, repository, plan: graphPlan }),
    ).rejects.toThrow("root scope mismatch");
  });
  it("validates grounding, ambiguity, known types and total hop ceiling before execution", async () => {
    expect(() =>
      groundGraphQueryPlan({ ...graphPlan, startEntityIds: ["invented"] }, graphCandidates),
    ).toThrow("authorized candidates");
    expect(() =>
      groundGraphQueryPlan(
        { ...graphPlan, steps: [{ ...graphPlan.steps[0], relationTypes: ["owns"] }] },
        graphCandidates,
      ),
    ).toThrow("ungrounded");
    expect(
      GraphQueryPlanSchema.safeParse({
        ...graphPlan,
        steps: [{ ...graphPlan.steps[0], targetTypes: ["invented"] }],
      }).success,
    ).toBe(false);
    expect(
      GraphQueryPlanSchema.safeParse({
        ...graphPlan,
        steps: [graphPlan.steps[0], graphPlan.steps[0], graphPlan.steps[0]],
      }).success,
    ).toBe(false);
    const repository = graphRepository();
    repository.loadEntities = vi.fn();
    expect(
      (
        await executeGraphQueryPaths({
          ...graphScope,
          repository,
          plan: { status: "ambiguous", startEntityIds: [], steps: [] },
        })
      ).paths,
    ).toEqual([]);
    expect(repository.loadEntities).not.toHaveBeenCalled();
  });
});
