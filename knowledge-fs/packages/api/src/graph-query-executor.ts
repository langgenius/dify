import { runWithAbortSignal } from "./bounded-concurrency";
import {
  type GraphEvidencePath,
  type GraphQueryPathResult,
  type GraphQueryPlan,
  GraphQueryPlanSchema,
  type GraphQueryRepository,
  type GraphQueryScope,
  type GraphQueryStep,
} from "./graph-query-contracts";

/** Executes only existing edges. A vector match is never synthesized into an edge or identity link. */
export async function executeGraphQueryPaths(
  input: GraphQueryScope & {
    readonly plan: GraphQueryPlan;
    readonly repository: GraphQueryRepository;
    readonly fanout?: number;
    readonly maxPaths?: number;
    readonly maxFrontier?: number;
    readonly maxEdges?: number;
    readonly timeoutMs?: number;
    readonly now?: () => number;
  },
): Promise<GraphQueryPathResult> {
  const plan = GraphQueryPlanSchema.parse(input.plan);
  if (plan.status !== "ready") return { paths: [], truncated: false, examinedEdges: 0 };
  const {
    repository,
    fanout = 12,
    maxPaths = 24,
    maxFrontier = 96,
    maxEdges = 1024,
    timeoutMs = 5000,
    now = Date.now,
  } = input;
  for (const value of [fanout, maxPaths, maxFrontier, maxEdges, timeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid graph path budget");
  }
  if (fanout > 64 || maxFrontier > 128 || maxPaths > 128 || maxEdges > 8192 || timeoutMs > 30000)
    throw new Error("Graph path budget exceeds hard ceiling");
  const deadline = now() + timeoutMs;
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const scope = { ...input, signal };
  const roots = await runWithAbortSignal(
    () => repository.loadEntities({ ...scope, ids: plan.startEntityIds }),
    signal,
  );
  if (
    roots.some(
      (root) =>
        !plan.startEntityIds.includes(root.id) ||
        root.knowledgeSpaceId !== input.snapshot.knowledgeSpaceId ||
        !root.permissionScope.every((permission) => input.permissionScope.includes(permission)),
    )
  )
    throw new Error("Graph query root scope mismatch");
  let completed: GraphEvidencePath[] = roots.map((root) => ({
    entityIds: [root.id],
    entityNames: [root.name],
    edges: [],
    sourceNodeIds: [...root.sourceNodeIds],
  }));
  let examinedEdges = 0;
  let truncated = false;
  const bounded = () => now() >= deadline || examinedEdges >= maxEdges;
  for (const step of plan.steps) {
    let frontierPaths = completed;
    completed = [];
    const completedKeys = new Set<string>();
    for (let hop = 1; hop <= step.maxHops && frontierPaths.length; hop += 1) {
      input.signal?.throwIfAborted();
      if (bounded() || signal.aborted) {
        truncated = true;
        break;
      }
      const allIds = [
        ...new Set(
          frontierPaths.map((path) => {
            const id = path.entityIds.at(-1);
            if (!id) throw new Error("Graph frontier contains an empty path");
            return id;
          }),
        ),
      ];
      const frontier = allIds.slice(0, maxFrontier);
      if (frontier.length < allIds.length) truncated = true;
      let batch: Awaited<ReturnType<GraphQueryRepository["loadEdges"]>>;
      try {
        batch = await runWithAbortSignal(
          () => repository.loadEdges({ ...scope, frontier, step, fanout }),
          signal,
        );
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!signal.aborted) throw error;
        truncated = true;
        break;
      }
      truncated ||= batch.truncated;
      const next: GraphEvidencePath[] = [];
      for (const path of frontierPaths) {
        for (const item of batch.edges) {
          if (item.edge.fromEntityId !== path.entityIds.at(-1)) continue;
          if (examinedEdges >= maxEdges) {
            truncated = true;
            break;
          }
          examinedEdges += 1;
          // Defense in depth for test/alternate adapters: enforce predicate and orientation again.
          const edge = item.edge;
          const relation = edge.relation;
          if (!step.relationTypes.includes(relation.type) || !edgeMatchesDirection(edge, step))
            throw new Error("Graph repository returned an edge outside the constrained plan");
          if (
            item.entity.id !== edge.toEntityId ||
            relation.knowledgeSpaceId !== input.snapshot.knowledgeSpaceId ||
            item.entity.knowledgeSpaceId !== input.snapshot.knowledgeSpaceId
          )
            throw new Error("Graph path crossed its knowledge-space boundary");
          if (
            ![...item.entity.permissionScope, ...relation.permissionScope].every((permission) =>
              input.permissionScope.includes(permission),
            )
          )
            throw new Error("Graph path crossed its permission scope");
          if (path.entityIds.includes(edge.toEntityId)) continue;
          const extended: GraphEvidencePath = {
            entityIds: [...path.entityIds, edge.toEntityId],
            entityNames: [...path.entityNames, item.entity.name],
            edges: [...path.edges, edge],
            sourceNodeIds: [
              ...new Set([
                ...path.sourceNodeIds,
                ...relation.sourceNodeIds,
                ...item.entity.sourceNodeIds,
              ]),
            ],
          };
          if (
            hop >= step.minHops &&
            (!step.targetEntityIds.length || step.targetEntityIds.includes(item.entity.id)) &&
            (!step.targetTypes.length || step.targetTypes.includes(item.entity.type))
          ) {
            const key = extended.edges
              .map((entry) => `${entry.relation.id}:${entry.fromEntityId}`)
              .join("/");
            if (!completedKeys.has(key)) {
              completedKeys.add(key);
              if (completed.length < maxPaths) completed.push(extended);
              else truncated = true;
            }
          }
          if (hop < step.maxHops) {
            if (next.length < maxFrontier) next.push(extended);
            else truncated = true;
          }
        }
      }
      frontierPaths = next;
    }
    if (!completed.length) break;
  }
  input.signal?.throwIfAborted();
  return { paths: completed, truncated, examinedEdges };
}

function edgeMatchesDirection(
  edge: GraphEvidencePath["edges"][number],
  step: GraphQueryStep,
): boolean {
  const outgoing =
    edge.fromEntityId === edge.relation.subjectEntityId &&
    edge.toEntityId === edge.relation.objectEntityId;
  const incoming =
    edge.fromEntityId === edge.relation.objectEntityId &&
    edge.toEntityId === edge.relation.subjectEntityId;
  return step.direction === "either"
    ? outgoing || incoming
    : step.direction === "outgoing"
      ? outgoing
      : incoming;
}
