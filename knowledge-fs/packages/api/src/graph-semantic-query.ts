import { runWithAbortSignal } from "./bounded-concurrency";
import {
  GRAPH_QUERY_VERSION,
  type GraphEvidencePath,
  type GraphQueryPlan,
  type GraphQueryPlanner,
  type GraphQueryRepository,
  groundGraphQueryPlan,
} from "./graph-query-contracts";
import { executeGraphQueryPaths } from "./graph-query-executor";
import { ResearchModelCallObserverError } from "./research-model-usage";
import type { RetrieveHybridInput } from "./retrieval-types";

export interface GraphSemanticQueryResult {
  readonly status: "ready" | "ambiguous" | "not-applicable" | "unavailable";
  readonly paths: readonly GraphEvidencePath[];
  readonly plan?: GraphQueryPlan | undefined;
  readonly flags: readonly string[];
  readonly elapsedMs: number;
  readonly entityCandidates: number;
  readonly relationCandidates: number;
  readonly examinedEdges: number;
  readonly version: typeof GRAPH_QUERY_VERSION;
}

export interface GraphSemanticQueryService {
  query(input: RetrieveHybridInput): Promise<GraphSemanticQueryResult>;
}

export function createGraphSemanticQueryService(options: {
  readonly repository: GraphQueryRepository;
  readonly planner: GraphQueryPlanner;
}): GraphSemanticQueryService {
  return {
    query: async (input) => {
      const start = Date.now();
      const embeddingProfile = input.embeddingProfile;
      const empty = (flag: string): GraphSemanticQueryResult => ({
        status: "unavailable",
        paths: [],
        flags: [flag],
        elapsedMs: Date.now() - start,
        entityCandidates: 0,
        relationCandidates: 0,
        examinedEdges: 0,
        version: GRAPH_QUERY_VERSION,
      });
      if (
        !input.projectionSnapshot ||
        !embeddingProfile ||
        !input.retrievalProfile?.reasoningModel ||
        !input.tenantId
      )
        return empty("graph-semantic-profile-unavailable");
      if (
        input.projectionSnapshot.knowledgeSpaceId !== input.knowledgeSpaceId ||
        input.projectionSnapshot.tenantId !== input.tenantId
      )
        throw new Error("Graph semantic query snapshot scope mismatch");
      input.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(30000);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
      try {
        const scope = {
          snapshot: input.projectionSnapshot,
          permissionScope: input.permissionScope ?? [],
          filters: input.filters,
          signal,
        };
        const candidates = await runWithAbortSignal(
          () =>
            options.repository.search({
              ...scope,
              query: input.query,
              queryVector: input.queryVector,
              vectorSpaceId: embeddingProfile.vectorSpaceId,
              limit: 24,
            }),
          signal,
        );
        const plan = groundGraphQueryPlan(
          await options.planner.plan({ retrieval: { ...input, signal }, candidates }),
          candidates,
        );
        const result = await executeGraphQueryPaths({
          ...scope,
          plan,
          repository: options.repository,
        });
        return {
          status: plan.status,
          plan,
          paths: result.paths,
          flags: [
            ...(candidates.semanticCoverage !== "complete"
              ? [`graph-semantic-index-${candidates.semanticCoverage}`]
              : []),
            ...(plan.status === "ambiguous" ? ["graph-query-ambiguous"] : []),
            ...(result.truncated ? ["graph-query-truncated"] : []),
          ],
          elapsedMs: Date.now() - start,
          entityCandidates: candidates.entities.length,
          relationCandidates: candidates.relations.length,
          examinedEdges: result.examinedEdges,
          version: GRAPH_QUERY_VERSION,
        };
      } catch (error) {
        input.signal?.throwIfAborted();
        if (error instanceof ResearchModelCallObserverError) throw error;
        // Existing document retrieval remains usable. The missing graph leg is never disguised as
        // evidence of absence; its explicit degradation flag is recorded in retrieval traces/tests.
        const timedOut =
          timeout.aborted || (error instanceof Error && error.name === "TimeoutError");
        return empty(timedOut ? "graph-query-timeout" : "graph-query-unavailable");
      }
    },
  };
}
