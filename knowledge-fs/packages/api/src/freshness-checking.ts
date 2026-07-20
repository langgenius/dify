import {
  type Citation,
  type EvidenceBundle,
  EvidenceBundleSchema,
  type EvidenceItem,
} from "@knowledge/core";

export type FreshnessWarningReason = "source-updated-at-exceeds-policy" | "stale-status";
export type FreshnessWarningSeverity = "info" | "warning";

export interface FreshnessCheckingServiceOptions {
  readonly maxEvidenceItems?: number | undefined;
  readonly now?: () => string;
  readonly staleAfterSeconds?: number | undefined;
}

export interface FreshnessCheckingInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly knowledgeSpaceId: string;
  readonly traceId?: string | undefined;
}

export interface FreshnessWarning {
  readonly ageSeconds?: number | undefined;
  readonly evidenceNodeId: string;
  readonly observedAt?: string | undefined;
  readonly reason: FreshnessWarningReason;
  readonly severity: FreshnessWarningSeverity;
  readonly sourceLocations: readonly Citation[];
  readonly sourceUpdatedAt?: string | undefined;
  readonly status: EvidenceItem["freshness"]["status"];
}

export interface FreshnessCheckingReport {
  readonly checkedAt: string;
  readonly evidenceBundleId: string;
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly staleCount: number;
  readonly strategyVersion: "freshness-check-v1";
  readonly summary: string;
  readonly traceId?: string | undefined;
  readonly warnings: readonly FreshnessWarning[];
}

export interface FreshnessCheckingService {
  check(input: FreshnessCheckingInput): Promise<FreshnessCheckingReport>;
}

const defaultMaxEvidenceItems = 100;

export function createFreshnessCheckingService({
  maxEvidenceItems = defaultMaxEvidenceItems,
  now = () => new Date().toISOString(),
  staleAfterSeconds,
}: FreshnessCheckingServiceOptions = {}): FreshnessCheckingService {
  if (!Number.isSafeInteger(maxEvidenceItems) || maxEvidenceItems < 1) {
    throw new Error("Freshness checking maxEvidenceItems must be at least 1");
  }

  if (
    staleAfterSeconds !== undefined &&
    (!Number.isSafeInteger(staleAfterSeconds) || staleAfterSeconds < 1)
  ) {
    throw new Error("Freshness checking staleAfterSeconds must be at least 1");
  }

  return {
    check: async (input) => {
      const evidenceBundle = EvidenceBundleSchema.parse(cloneJson(input.evidenceBundle));
      const knowledgeSpaceId = input.knowledgeSpaceId.trim();
      const checkedAt = now();

      if (!knowledgeSpaceId) {
        throw new Error("Freshness checking knowledgeSpaceId is required");
      }

      if (evidenceBundle.items.length > maxEvidenceItems) {
        throw new Error(
          `Freshness checking evidence item count exceeds maxEvidenceItems=${maxEvidenceItems}`,
        );
      }

      const warnings = evidenceBundle.items.flatMap((item) =>
        warningForEvidenceItem(item, checkedAt, staleAfterSeconds),
      );

      return cloneJson({
        checkedAt,
        evidenceBundleId: evidenceBundle.id,
        knowledgeSpaceId,
        query: evidenceBundle.query,
        staleCount: warnings.length,
        strategyVersion: "freshness-check-v1",
        summary:
          warnings.length === 0
            ? "No stale evidence items found."
            : `${warnings.length} stale evidence item(s) found.`,
        ...(input.traceId ? { traceId: input.traceId } : {}),
        warnings,
      } satisfies FreshnessCheckingReport);
    },
  };
}

function warningForEvidenceItem(
  item: EvidenceItem,
  checkedAt: string,
  staleAfterSeconds: number | undefined,
): readonly FreshnessWarning[] {
  if (item.freshness.status === "stale") {
    return [
      {
        evidenceNodeId: item.nodeId,
        observedAt: item.freshness.observedAt,
        reason: "stale-status",
        severity: "warning",
        sourceLocations: cloneJson(item.citations),
        sourceUpdatedAt: item.freshness.sourceUpdatedAt,
        status: item.freshness.status,
      },
    ];
  }

  if (staleAfterSeconds === undefined || item.freshness.sourceUpdatedAt === undefined) {
    return [];
  }

  const ageSeconds = secondsBetween(item.freshness.sourceUpdatedAt, checkedAt);

  if (ageSeconds <= staleAfterSeconds) {
    return [];
  }

  return [
    {
      ageSeconds,
      evidenceNodeId: item.nodeId,
      observedAt: item.freshness.observedAt,
      reason: "source-updated-at-exceeds-policy",
      severity: "warning",
      sourceLocations: cloneJson(item.citations),
      sourceUpdatedAt: item.freshness.sourceUpdatedAt,
      status: item.freshness.status,
    },
  ];
}

function secondsBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("Freshness checking timestamps must be valid ISO datetimes");
  }

  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
