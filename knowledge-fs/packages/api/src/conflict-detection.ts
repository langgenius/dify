import type { Citation } from "@knowledge/core";

import type { SourceComparisonFinding, SourceComparisonReport } from "./source-comparison";

export type ConflictSeverity = "blocking" | "info" | "warning";

export interface ConflictDetectionDetectorInput {
  readonly findings: readonly SourceComparisonFinding[];
  readonly knowledgeSpaceId: string;
  readonly query: string;
}

export interface ConflictDetectionDetectorConflict {
  readonly confidence: number;
  readonly evidenceNodeIds: readonly string[];
  readonly severity: ConflictSeverity;
  readonly summary: string;
}

export interface ConflictDetectionDetectorResult {
  readonly conflicts: readonly ConflictDetectionDetectorConflict[];
  readonly summary: string;
}

export interface ConflictDetectionDetector {
  detect(input: ConflictDetectionDetectorInput): Promise<ConflictDetectionDetectorResult>;
}

export interface ConflictDetectionServiceOptions {
  readonly detector: ConflictDetectionDetector;
  readonly maxConflicts?: number | undefined;
  readonly maxFindings?: number | undefined;
  readonly now?: () => string;
}

export interface ConflictDetectionInput {
  readonly comparisonReport: SourceComparisonReport;
  readonly knowledgeSpaceId: string;
  readonly traceId?: string | undefined;
}

export interface DetectedConflict {
  readonly confidence: number;
  readonly evidenceNodeIds: readonly string[];
  readonly severity: ConflictSeverity;
  readonly sourceLocations: readonly Citation[];
  readonly summary: string;
}

export interface ConflictDetectionReport {
  readonly conflictCount: number;
  readonly conflicts: readonly DetectedConflict[];
  readonly detectedAt: string;
  readonly evidenceBundleId: string;
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly strategyVersion: "conflict-detection-v1";
  readonly summary: string;
  readonly traceId?: string | undefined;
}

export interface ConflictDetectionService {
  detect(input: ConflictDetectionInput): Promise<ConflictDetectionReport>;
}

const defaultMaxConflicts = 50;
const defaultMaxFindings = 100;

export function createConflictDetectionService({
  detector,
  maxConflicts = defaultMaxConflicts,
  maxFindings = defaultMaxFindings,
  now = () => new Date().toISOString(),
}: ConflictDetectionServiceOptions): ConflictDetectionService {
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 1) {
    throw new Error("Conflict detection maxFindings must be at least 1");
  }

  if (!Number.isSafeInteger(maxConflicts) || maxConflicts < 1) {
    throw new Error("Conflict detection maxConflicts must be at least 1");
  }

  return {
    detect: async (input) => {
      const comparisonReport = cloneJson(input.comparisonReport);
      const knowledgeSpaceId = input.knowledgeSpaceId.trim();

      if (!knowledgeSpaceId) {
        throw new Error("Conflict detection knowledgeSpaceId is required");
      }

      if (comparisonReport.findings.length > maxFindings) {
        throw new Error(`Conflict detection finding count exceeds maxFindings=${maxFindings}`);
      }

      const candidateFindings = comparisonReport.findings.filter(
        (finding) => finding.kind === "difference",
      );
      const detectorResult = await detector.detect({
        findings: cloneJson(candidateFindings),
        knowledgeSpaceId,
        query: comparisonReport.query,
      });

      if (detectorResult.conflicts.length > maxConflicts) {
        throw new Error(`Conflict detection conflict count exceeds maxConflicts=${maxConflicts}`);
      }

      const sourceLocationsByNodeId = new Map<string, Citation[]>();
      for (const finding of comparisonReport.findings) {
        finding.evidenceNodeIds.forEach((nodeId, index) => {
          const groupedLocations = finding.sourceLocationsByNodeId?.[nodeId];
          const indexedLocation = finding.sourceLocations[index];
          const locations =
            groupedLocations && groupedLocations.length > 0
              ? groupedLocations
              : indexedLocation
                ? [indexedLocation]
                : finding.sourceLocations;

          for (const location of locations) {
            addUniqueSourceLocation(sourceLocationsByNodeId, nodeId, location);
          }
        });
      }

      const conflicts = detectorResult.conflicts.map((conflict) =>
        normalizeConflict(conflict, sourceLocationsByNodeId),
      );

      return cloneJson({
        conflictCount: conflicts.length,
        conflicts,
        detectedAt: now(),
        evidenceBundleId: comparisonReport.evidenceBundleId,
        knowledgeSpaceId,
        query: comparisonReport.query,
        strategyVersion: "conflict-detection-v1",
        summary: requiredString(detectorResult.summary, "summary"),
        ...(input.traceId ? { traceId: input.traceId } : {}),
      } satisfies ConflictDetectionReport);
    },
  };
}

function normalizeConflict(
  conflict: ConflictDetectionDetectorConflict,
  sourceLocationsByNodeId: ReadonlyMap<string, readonly Citation[]>,
): DetectedConflict {
  const evidenceNodeIds = conflict.evidenceNodeIds.map((nodeId) =>
    requiredString(nodeId, "conflict evidenceNodeId"),
  );
  const sourceLocations = dedupeSourceLocations(
    evidenceNodeIds.flatMap((nodeId) => cloneJson(sourceLocationsByNodeId.get(nodeId) ?? [])),
  );

  if (!Number.isFinite(conflict.confidence) || conflict.confidence < 0 || conflict.confidence > 1) {
    throw new Error("Conflict detection confidence must be between 0 and 1");
  }

  return {
    confidence: conflict.confidence,
    evidenceNodeIds,
    severity: conflict.severity,
    sourceLocations,
    summary: requiredString(conflict.summary, "conflict summary"),
  };
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Conflict detection ${label} is required`);
  }

  return normalized;
}

function addUniqueSourceLocation(
  sourceLocationsByNodeId: Map<string, Citation[]>,
  nodeId: string,
  sourceLocation: Citation,
): void {
  const locations = sourceLocationsByNodeId.get(nodeId) ?? [];
  const candidateKey = sourceLocationKey(sourceLocation);

  if (!locations.some((location) => sourceLocationKey(location) === candidateKey)) {
    sourceLocationsByNodeId.set(nodeId, [...locations, cloneJson(sourceLocation)]);
  }
}

function dedupeSourceLocations(sourceLocations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const unique: Citation[] = [];

  for (const sourceLocation of sourceLocations) {
    const key = sourceLocationKey(sourceLocation);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cloneJson(sourceLocation));
    }
  }

  return unique;
}

function sourceLocationKey(sourceLocation: Citation): string {
  return JSON.stringify(sourceLocation);
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
