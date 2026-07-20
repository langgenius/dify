import { isDeepStrictEqual } from "node:util";

import { type AnswerTrace, AnswerTraceSchema, EvidenceBundleSchema } from "@knowledge/core";

/** Raised when one durable AnswerTrace id is reused for a different semantic payload. */
export class AnswerTraceSemanticConflictError extends Error {
  readonly traceId: string;

  constructor(traceId: string) {
    super(`AnswerTrace id=${traceId} was reused with a different semantic payload`);
    this.name = "AnswerTraceSemanticConflictError";
    this.traceId = traceId;
  }
}

/**
 * Returns the already-durable trace only when it is the exact logical write being retried.
 * Repositories may derive evidenceBundleId from an embedded bundle, so that single derived field
 * is normalized before comparing every other persisted field, timestamp, step and metadata value.
 */
export function reconcileAnswerTraceWrite(
  existing: AnswerTrace,
  requested: AnswerTrace,
): AnswerTrace {
  const normalizedExisting = normalizedAnswerTrace(existing);
  const normalizedRequested = normalizedAnswerTrace(requested);
  if (!isDeepStrictEqual(normalizedExisting, normalizedRequested)) {
    throw new AnswerTraceSemanticConflictError(requested.id);
  }
  return existing;
}

function normalizedAnswerTrace(trace: AnswerTrace): AnswerTrace {
  const parsed = AnswerTraceSchema.parse(trace);
  const embeddedIds = parsed.steps.flatMap((step) => {
    const embedded = EvidenceBundleSchema.safeParse(step.metadata.evidenceBundle);
    return embedded.success ? [embedded.data.id] : [];
  });
  const distinctEmbeddedIds = [...new Set(embeddedIds)];
  const derivedEvidenceBundleId =
    parsed.evidenceBundleId ??
    (distinctEmbeddedIds.length === 1 ? distinctEmbeddedIds[0] : undefined);

  return AnswerTraceSchema.parse({
    ...parsed,
    ...(derivedEvidenceBundleId ? { evidenceBundleId: derivedEvidenceBundleId } : {}),
    steps: parsed.steps.map((step) => ({
      ...step,
      endedAt: step.endedAt ?? step.startedAt,
    })),
  });
}
