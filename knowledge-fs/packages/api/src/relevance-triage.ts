import type { FailedQuery } from "@knowledge/core";

import type {
  FailedQueryPermissionBinding,
  FailedQueryRepository,
} from "./failed-query-repository";
import { cloneJsonObject } from "./json-utils";

/**
 * Relevance triage decides WHY a failed query failed, using signals that are independent of and
 * coarser than the chunk retriever that already failed:
 *  - `summaryRelevance` — the query against document/section summaries (pageindex),
 *  - `graphRelevance` — the query's entities against the knowledge graph,
 *  - `answerability` — an LLM judge (only when the query looks relevant) that separates a retrieval
 *    miss (answer exists, should have been retrieved) from a coverage gap (relevant topic, no answer
 *    in the corpus).
 */
export type TriageVerdict = "irrelevant" | "retrieval-miss" | "coverage-gap" | "uncertain";

export interface RelevanceTriageInput {
  readonly knowledgeSpaceId: string;
  readonly permissionScope?: readonly string[] | undefined;
  readonly query: string;
  readonly tenantId: string;
}

export interface SummaryRelevanceSignal {
  readonly matched: boolean;
  readonly score?: number | undefined;
}

export interface GraphRelevanceSignal {
  readonly entityOverlap?: number | undefined;
  readonly matched: boolean;
}

export interface AnswerabilitySignal {
  readonly confidence?: number | undefined;
  readonly verdict: "coverage-gap" | "retrieval-miss" | "uncertain";
}

export interface RelevanceTriageSignals {
  answerability(input: RelevanceTriageInput): Promise<AnswerabilitySignal>;
  graphRelevance(input: RelevanceTriageInput): Promise<GraphRelevanceSignal>;
  summaryRelevance(input: RelevanceTriageInput): Promise<SummaryRelevanceSignal>;
}

export interface TriageSignals {
  readonly answerability?: AnswerabilitySignal | undefined;
  readonly graph: GraphRelevanceSignal;
  readonly summary: SummaryRelevanceSignal;
}

export interface TriageResult {
  readonly confidence: number;
  readonly signals: TriageSignals;
  readonly verdict: TriageVerdict;
}

export interface RelevanceTriage {
  triage(input: RelevanceTriageInput): Promise<TriageResult>;
}

export function createRelevanceTriage({
  signals,
}: {
  readonly signals: RelevanceTriageSignals;
}): RelevanceTriage {
  return {
    triage: async (input) => {
      const [summary, graph] = await Promise.all([
        signals.summaryRelevance(input),
        signals.graphRelevance(input),
      ]);

      // No independent evidence that the query is on-topic → out of scope. Not a failed query.
      if (!summary.matched && !graph.matched) {
        return {
          confidence: irrelevantConfidence(summary, graph),
          signals: { graph, summary },
          verdict: "irrelevant",
        };
      }

      // On-topic → ask whether the answer actually exists (retrieval miss vs coverage gap).
      const answerability = await signals.answerability(input);

      return {
        confidence: answerability.confidence ?? 0.5,
        signals: { answerability, graph, summary },
        verdict: answerability.verdict,
      };
    },
  };
}

function irrelevantConfidence(
  summary: SummaryRelevanceSignal,
  graph: GraphRelevanceSignal,
): number {
  // The lower both relevance signals are, the more confident we are the query is out of scope.
  const summaryScore = typeof summary.score === "number" ? summary.score : 0;
  const graphScore = typeof graph.entityOverlap === "number" ? graph.entityOverlap : 0;

  return clamp01(1 - Math.max(summaryScore, graphScore));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Status a triaged failed query moves to for a given verdict. */
export function statusForVerdict(verdict: TriageVerdict): FailedQuery["status"] {
  return verdict === "irrelevant" ? "dismissed" : "pending-annotation";
}

export interface FailedQueryTriageRunnerInput {
  readonly candidateGrants: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly limit?: number | undefined;
  readonly permission: FailedQueryPermissionBinding;
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface FailedQueryTriageRunnerResult {
  readonly triaged: number;
  readonly verdicts: Record<TriageVerdict, number>;
}

export interface FailedQueryTriageRunner {
  run(input: FailedQueryTriageRunnerInput): Promise<FailedQueryTriageRunnerResult>;
}

const DEFAULT_TRIAGE_BATCH = 50;
const MAX_TRIAGE_BATCH = 200;

/**
 * Triages a bounded batch of `pending-triage` failed queries: each is triaged and moved to
 * `dismissed` (irrelevant) or `pending-annotation` (needs a human), recording the verdict, confidence
 * and signals under `metadata.triage`. A per-query triage failure is isolated and leaves that query
 * pending.
 */
export function createFailedQueryTriageRunner({
  failedQueries,
  now = () => new Date().toISOString(),
  triage,
}: {
  readonly failedQueries: FailedQueryRepository;
  readonly now?: () => string;
  readonly triage: RelevanceTriage;
}): FailedQueryTriageRunner {
  return {
    run: async ({ candidateGrants, knowledgeSpaceId, limit, permission, subjectId, tenantId }) => {
      const batch = Math.min(limit ?? DEFAULT_TRIAGE_BATCH, MAX_TRIAGE_BATCH);
      const verdicts: Record<TriageVerdict, number> = {
        "coverage-gap": 0,
        irrelevant: 0,
        "retrieval-miss": 0,
        uncertain: 0,
      };
      let triaged = 0;

      const pending = await failedQueries.list({
        candidateGrants,
        knowledgeSpaceId,
        limit: batch,
        status: "pending-triage",
        subjectId,
        tenantId,
      });

      for (const failedQuery of pending.items) {
        let result: TriageResult;

        try {
          result = await triage.triage({
            knowledgeSpaceId,
            permissionScope: candidateGrants,
            query: failedQuery.query,
            tenantId,
          });
        } catch {
          continue;
        }

        await failedQueries.update({
          candidateGrants,
          id: failedQuery.id,
          knowledgeSpaceId,
          metadata: {
            ...cloneJsonObject(failedQuery.metadata),
            triage: {
              confidence: result.confidence,
              signals: result.signals as unknown as Record<string, unknown>,
              triagedAt: now(),
              verdict: result.verdict,
            },
          },
          permission,
          status: statusForVerdict(result.verdict),
          subjectId,
          tenantId,
        });
        verdicts[result.verdict] += 1;
        triaged += 1;
      }

      return { triaged, verdicts };
    },
  };
}
