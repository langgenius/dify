import { z } from "zod";
import { ENTITY_EXTRACTION_TYPES } from "./extraction-types";
import type { GraphEntity, GraphRelation } from "./graph-index-repository";
import { GRAPH_RELATION_TYPES } from "./graph-relation-catalog";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type { RetrieveHybridInput } from "./retrieval-types";

export const GRAPH_QUERY_VERSION = "graph-semantic-query-v1";
export const GRAPH_QUERY_MAX_HOPS = 6;

export const GraphQueryStepSchema = z
  .object({
    relationTypes: z.array(z.enum(GRAPH_RELATION_TYPES)).min(1).max(4),
    direction: z.enum(["outgoing", "incoming", "either"]),
    minHops: z.number().int().min(1).max(GRAPH_QUERY_MAX_HOPS),
    maxHops: z.number().int().min(1).max(GRAPH_QUERY_MAX_HOPS),
    targetEntityIds: z.array(z.string().min(1).max(64)).max(8),
    targetTypes: z
      .array(
        z
          .string()
          .refine(
            (type) => ENTITY_EXTRACTION_TYPES.has(type as GraphEntity["type"]),
            "Unknown graph entity type",
          ),
      )
      .max(4),
  })
  .strict()
  .refine((step) => step.minHops <= step.maxHops, "minHops exceeds maxHops");

export const GraphQueryPlanSchema = z
  .object({
    status: z.enum(["ready", "ambiguous", "not-applicable"]),
    startEntityIds: z.array(z.string().min(1).max(64)).max(8),
    steps: z.array(GraphQueryStepSchema).max(4),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.status === "ready" && (!plan.startEntityIds.length || !plan.steps.length)) {
      context.addIssue({ code: "custom", message: "Ready graph queries require roots and steps" });
    }
    if (plan.steps.reduce((sum, step) => sum + step.maxHops, 0) > GRAPH_QUERY_MAX_HOPS) {
      context.addIssue({ code: "custom", message: "Graph query exceeds total hop budget" });
    }
    if (plan.status !== "ready" && (plan.startEntityIds.length || plan.steps.length)) {
      context.addIssue({ code: "custom", message: "Unresolved plans cannot execute paths" });
    }
  });

export type GraphQueryPlan = z.infer<typeof GraphQueryPlanSchema>;
export type GraphQueryStep = z.infer<typeof GraphQueryStepSchema>;

export interface GraphSemanticCandidate {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly score: number;
  readonly matchedBy: readonly ("exact" | "lexical" | "vector")[];
}

export interface GraphQueryScope {
  readonly permissionScope: readonly string[];
  readonly snapshot: PublishedProjectionReadSnapshot;
  readonly signal?: AbortSignal | undefined;
  /** Intersect graph provenance with caller-selected document/node filters before ranking. */
  readonly filters?: RetrieveHybridInput["filters"];
}

export interface GraphSemanticSearchInput extends GraphQueryScope {
  readonly query: string;
  readonly queryVector: readonly number[];
  readonly vectorSpaceId: string;
  readonly limit: number;
}

export interface GraphSemanticSearchResult {
  readonly entities: readonly GraphSemanticCandidate[];
  readonly relations: readonly GraphSemanticCandidate[];
  readonly semanticCoverage: "complete" | "partial" | "missing";
}

export interface GraphPathEdge {
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly relation: GraphRelation;
}

export interface GraphEvidencePath {
  readonly entityIds: readonly string[];
  readonly entityNames: readonly string[];
  readonly edges: readonly GraphPathEdge[];
  readonly sourceNodeIds: readonly string[];
}

export interface GraphQueryPathResult {
  readonly paths: readonly GraphEvidencePath[];
  readonly truncated: boolean;
  readonly examinedEdges: number;
}

export interface GraphQueryEdgeBatch {
  readonly edges: readonly { readonly entity: GraphEntity; readonly edge: GraphPathEdge }[];
  readonly truncated: boolean;
}

export interface GraphQueryRepository {
  search(input: GraphSemanticSearchInput): Promise<GraphSemanticSearchResult>;
  loadEntities(
    input: GraphQueryScope & { readonly ids: readonly string[] },
  ): Promise<readonly GraphEntity[]>;
  loadEdges(
    input: GraphQueryScope & {
      readonly frontier: readonly string[];
      readonly step: GraphQueryStep;
      readonly fanout: number;
    },
  ): Promise<GraphQueryEdgeBatch>;
}

export interface GraphQueryPlanner {
  plan(input: {
    readonly retrieval: RetrieveHybridInput;
    readonly candidates: GraphSemanticSearchResult;
  }): Promise<GraphQueryPlan>;
}

/** Model output may select candidates, never invent IDs, predicates, or ungrounded traversals. */
export function groundGraphQueryPlan(
  value: unknown,
  candidates: GraphSemanticSearchResult,
): GraphQueryPlan {
  const plan = GraphQueryPlanSchema.parse(value);
  const entities = new Set(candidates.entities.map((entity) => entity.id));
  const relations = new Set(candidates.relations.map((relation) => relation.type));
  for (const id of [
    ...plan.startEntityIds,
    ...plan.steps.flatMap((step) => step.targetEntityIds),
  ]) {
    if (!entities.has(id))
      throw new Error("Graph query selected an entity outside its authorized candidates");
  }
  for (const type of plan.steps.flatMap((step) => step.relationTypes)) {
    if (!relations.has(type)) throw new Error("Graph query selected an ungrounded relationship");
  }
  return plan;
}
