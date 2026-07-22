import { type AnswerTrace, type EvidenceBundle, EvidenceBundleSchema } from "@knowledge/core";

import { cloneEvidenceBundle, uniqueStrings } from "./api-shared-utils";
import type { TrustedCreateGoldenQuestionInput } from "./golden-question-repository";
import { cloneJsonObject } from "./json-utils";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import type { KnowledgeFsEntry, KnowledgeFsListResult } from "./knowledge-fs-types";

export function evidenceBundleFromAnswerTrace(trace: AnswerTrace): EvidenceBundle | null {
  for (const step of [...trace.steps].reverse()) {
    const evidenceBundle = step.metadata.evidenceBundle;
    const parsed = EvidenceBundleSchema.safeParse(evidenceBundle);

    if (parsed.success) {
      return cloneEvidenceBundle(parsed.data);
    }
  }

  return null;
}

export function productionBadCaseGoldenQuestionInput({
  reason,
  tags,
  trace,
}: {
  readonly reason?: string | undefined;
  readonly tags: readonly string[];
  readonly trace: AnswerTrace;
}): TrustedCreateGoldenQuestionInput {
  const bundle = evidenceBundleFromAnswerTrace(trace);
  const expectedEvidenceIds = uniqueStrings([
    ...(bundle?.items.map((item) => item.nodeId) ?? []),
    ...(bundle?.missingEvidence
      .map((missing) => missing.expectedEvidenceId)
      .filter((id): id is string => Boolean(id)) ?? []),
  ]);

  return {
    expectedEvidenceIds,
    knowledgeSpaceId: trace.knowledgeSpaceId,
    metadata: {
      evidenceContext: productionBadCaseEvidenceContext(bundle),
      ...(reason ? { reason } : {}),
      source: "production-bad-case",
      traceId: trace.id,
    },
    question: trace.query,
    tags: uniqueStrings(["production-bad-case", "needs-review", ...tags]),
  };
}

export function productionBadCaseEvidenceContext(
  bundle: EvidenceBundle | null,
): Record<string, unknown> {
  const maxEvidenceItems = 20;
  const maxMissingEvidence = 20;

  if (!bundle) {
    return {
      itemCount: 0,
      items: [],
      missingEvidence: [],
      missingEvidenceCount: 0,
      state: "unknown",
      truncated: false,
    };
  }

  return {
    itemCount: bundle.items.length,
    items: bundle.items.slice(0, maxEvidenceItems).map((item) => ({
      citationCount: item.citations.length,
      conflictCount: item.conflicts.length,
      freshnessStatus: item.freshness.status,
      nodeId: item.nodeId,
      score: item.score,
    })),
    missingEvidence: bundle.missingEvidence.slice(0, maxMissingEvidence).map((missing) => ({
      ...(missing.expectedEvidenceId ? { expectedEvidenceId: missing.expectedEvidenceId } : {}),
      reason: missing.reason,
      text: missing.text.slice(0, 200),
    })),
    missingEvidenceCount: bundle.missingEvidence.length,
    state: bundle.state,
    truncated:
      bundle.items.length > maxEvidenceItems || bundle.missingEvidence.length > maxMissingEvidence,
  };
}

export function queryEvidenceEntries(traceId: string, bundle: EvidenceBundle): KnowledgeFsEntry[] {
  return bundle.items.map((item) => ({
    kind: "resource",
    metadata: {
      citationCount: item.citations.length,
      conflictCount: item.conflicts.length,
      freshness: cloneJsonObject(item.freshness),
      score: item.score,
      scores: cloneJsonObject(item.scores),
    },
    name: item.nodeId,
    path: `/queries/${traceId}/evidence/${item.nodeId}`,
    resourceType: "node",
    targetId: item.nodeId,
  }));
}

export function queryConflictEntries(traceId: string, bundle: EvidenceBundle): KnowledgeFsEntry[] {
  return bundle.items.flatMap((item) =>
    item.conflicts.map((conflict, index) => ({
      kind: "resource" as const,
      metadata: {
        nodeId: item.nodeId,
        reason: conflict.reason,
        severity: conflict.severity,
      },
      name: `conflict-${index + 1}`,
      path: `/queries/${traceId}/conflicts/${item.nodeId}/${index + 1}`,
      resourceType: "node" as const,
      targetId: conflict.withNodeId ?? item.nodeId,
    })),
  );
}

export function queryMissingEntries(traceId: string, bundle: EvidenceBundle): KnowledgeFsEntry[] {
  return bundle.missingEvidence.map((missing, index) => ({
    kind: "resource",
    metadata: {
      ...cloneJsonObject(missing.metadata),
      reason: missing.reason,
    },
    name: `missing-${index + 1}`,
    path: `/queries/${traceId}/missing/${index + 1}`,
    resourceType: "evidence",
    targetId: missing.expectedEvidenceId ?? `missing-${index + 1}`,
  }));
}

export function paginateQueryVirtualEntries({
  cursor,
  entries,
  limit,
  path,
}: {
  readonly cursor?: string | undefined;
  readonly entries: readonly KnowledgeFsEntry[];
  readonly limit: number;
  readonly path: string;
}): KnowledgeFsListResult {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new KnowledgeFsValidationError("Query virtual tree cursor is invalid");
  }

  const page = entries.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    items: page,
    ...(nextOffset < entries.length ? { nextCursor: String(nextOffset) } : {}),
    path,
    truncated: nextOffset < entries.length,
  };
}
