export const TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY = "traceEvidenceAvailability";
export const TRACE_UNAVAILABLE_EVIDENCE_TEXT = "Evidence deleted or unavailable";

export type TraceEvidenceUnavailableReason =
  | "document-deleted-or-unavailable"
  | "evidence-unavailable"
  | "permission-denied";

export interface TraceEvidenceAvailability {
  readonly reason: TraceEvidenceUnavailableReason;
  readonly status: "unavailable";
}

export function traceEvidenceAvailabilityFromMetadata(
  metadata: Readonly<Record<string, unknown>>,
): TraceEvidenceAvailability | null {
  const value = metadata[TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const status = Reflect.get(value, "status");
  const reason = Reflect.get(value, "reason");
  if (status !== "unavailable" || !traceEvidenceUnavailableReason(reason)) return null;

  return { reason, status };
}

function traceEvidenceUnavailableReason(value: unknown): value is TraceEvidenceUnavailableReason {
  return (
    value === "document-deleted-or-unavailable" ||
    value === "evidence-unavailable" ||
    value === "permission-denied"
  );
}
