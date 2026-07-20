import { randomUUID } from "node:crypto";

import { type EvidenceBundle, EvidenceBundleSchema } from "@knowledge/core";

import { hybridRetrievalItemToEvidenceItem } from "./retrieval-evidence";
import type { HybridRetrievalResult } from "./retrieval-types";

export interface EvidenceBundleAssemblerOptions {
  readonly answerability?: AnswerabilityEvaluator | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly maxItems?: number | undefined;
  readonly maxMissingEvidence?: number | undefined;
  readonly now?: (() => string) | undefined;
}

export interface AnswerabilityEvaluatorOptions {
  readonly minFinalScore?: number | undefined;
  readonly minItems?: number | undefined;
}

export interface EvaluateAnswerabilityInput {
  readonly items: readonly EvidenceBundle["items"][number][];
  readonly missingEvidence: readonly EvidenceBundle["missingEvidence"][number][];
  readonly permissionLimited?: boolean | undefined;
}

export interface AnswerabilityEvaluator {
  evaluate(input: EvaluateAnswerabilityInput): EvidenceBundle["state"];
}

export interface AssembleEvidenceBundleInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly permissionLimited?: boolean | undefined;
  readonly query: string;
  readonly retrieval: HybridRetrievalResult;
  readonly state?: EvidenceBundle["state"] | undefined;
  readonly traceId?: string | undefined;
}

export interface EvidenceBundleAssembler {
  assemble(input: AssembleEvidenceBundleInput): EvidenceBundle;
}

export function createAnswerabilityEvaluator({
  minFinalScore = 0.5,
  minItems = 1,
}: AnswerabilityEvaluatorOptions = {}): AnswerabilityEvaluator {
  if (!Number.isFinite(minFinalScore) || minFinalScore < 0 || minFinalScore > 1) {
    throw new Error("Answerability minFinalScore must be between 0 and 1");
  }

  if (!Number.isInteger(minItems) || minItems < 1) {
    throw new Error("Answerability minItems must be at least 1");
  }

  return {
    evaluate({ items, missingEvidence, permissionLimited }) {
      if (
        permissionLimited ||
        missingEvidence.some((missing) => missing.reason === "permission-filtered")
      ) {
        return "permission-limited";
      }

      if (items.length < minItems || items.every((item) => item.scores.final < minFinalScore)) {
        return "not-enough-evidence";
      }

      if (
        items.some((item) => item.conflicts.some((conflict) => conflict.severity === "blocking"))
      ) {
        return "conflict";
      }

      if (missingEvidence.length > 0 || items.some((item) => item.freshness.status === "stale")) {
        return "partial";
      }

      return "answerable";
    },
  };
}

export function createEvidenceBundleAssembler({
  answerability = createAnswerabilityEvaluator(),
  generateId = randomUUID,
  maxItems = 20,
  maxMissingEvidence = 20,
  now = () => new Date().toISOString(),
}: EvidenceBundleAssemblerOptions = {}): EvidenceBundleAssembler {
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error("EvidenceBundle assembler maxItems must be at least 1");
  }

  if (!Number.isInteger(maxMissingEvidence) || maxMissingEvidence < 0) {
    throw new Error("EvidenceBundle assembler maxMissingEvidence must be non-negative");
  }

  return {
    assemble(input) {
      const query = input.query.trim();

      if (!query) {
        throw new Error("EvidenceBundle assembler query is required");
      }

      if (input.retrieval.items.length > maxItems) {
        throw new Error(`EvidenceBundle assembler item count exceeds maxItems=${maxItems}`);
      }

      const items = input.retrieval.items.map(hybridRetrievalItemToEvidenceItem);
      const retrievedEvidenceIds = new Set(
        items.flatMap((item) => [
          item.nodeId,
          ...item.citations.map((citation) => citation.documentAssetId),
        ]),
      );
      const missingEvidence = uniqueStrings([...(input.expectedEvidenceIds ?? [])])
        .filter((expectedEvidenceId) => !retrievedEvidenceIds.has(expectedEvidenceId))
        .map((expectedEvidenceId) => ({
          expectedEvidenceId,
          metadata: {},
          reason: "not-retrieved" as const,
          text: "Expected evidence was not retrieved.",
        }));

      if (missingEvidence.length > maxMissingEvidence) {
        throw new Error(
          `EvidenceBundle assembler missing evidence count exceeds maxMissingEvidence=${maxMissingEvidence}`,
        );
      }

      return EvidenceBundleSchema.parse({
        createdAt: now(),
        id: generateId(),
        items,
        missingEvidence,
        query,
        state:
          input.state ??
          answerability.evaluate({
            items,
            missingEvidence,
            permissionLimited: input.permissionLimited,
          }),
        ...(input.traceId ? { traceId: input.traceId } : {}),
      });
    },
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}
