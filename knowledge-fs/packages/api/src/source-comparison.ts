import {
  type Citation,
  type EvidenceBundle,
  EvidenceBundleSchema,
  type EvidenceItem,
} from "@knowledge/core";

export type SourceComparisonFindingKind = "agreement" | "difference" | "unknown";

export interface SourceComparisonSource {
  readonly citations: readonly Citation[];
  readonly freshness: EvidenceItem["freshness"];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nodeId: string;
  readonly score: number;
  readonly text: string;
}

export interface SourceComparisonJudgeInput {
  readonly query: string;
  readonly sources: readonly SourceComparisonSource[];
}

export interface SourceComparisonJudgeFinding {
  readonly evidenceNodeIds: readonly string[];
  readonly kind: SourceComparisonFindingKind;
  readonly summary: string;
}

export interface SourceComparisonJudgeResult {
  readonly findings: readonly SourceComparisonJudgeFinding[];
  readonly summary: string;
}

export interface SourceComparisonJudge {
  compare(input: SourceComparisonJudgeInput): Promise<SourceComparisonJudgeResult>;
}

export interface SourceComparisonServiceOptions {
  readonly judge: SourceComparisonJudge;
  readonly maxEvidenceItems?: number | undefined;
  readonly maxItemTextBytes?: number | undefined;
  readonly now?: () => string;
}

export interface SourceComparisonInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly knowledgeSpaceId: string;
  readonly traceId?: string | undefined;
}

export interface SourceComparisonFinding {
  readonly evidenceNodeIds: readonly string[];
  readonly kind: SourceComparisonFindingKind;
  readonly sourceLocations: readonly Citation[];
  readonly sourceLocationsByNodeId?: Readonly<Record<string, readonly Citation[]>> | undefined;
  readonly summary: string;
}

export interface SourceComparisonReport {
  readonly comparedAt: string;
  readonly evidenceBundleId: string;
  readonly findings: readonly SourceComparisonFinding[];
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly sourceCount: number;
  readonly strategyVersion: "source-comparison-v1";
  readonly summary: string;
  readonly traceId?: string | undefined;
}

export interface SourceComparisonService {
  compare(input: SourceComparisonInput): Promise<SourceComparisonReport>;
}

const defaultMaxEvidenceItems = 50;
const defaultMaxItemTextBytes = 16_384;

export function createSourceComparisonService({
  judge,
  maxEvidenceItems = defaultMaxEvidenceItems,
  maxItemTextBytes = defaultMaxItemTextBytes,
  now = () => new Date().toISOString(),
}: SourceComparisonServiceOptions): SourceComparisonService {
  if (!Number.isSafeInteger(maxEvidenceItems) || maxEvidenceItems < 1) {
    throw new Error("Source comparison maxEvidenceItems must be at least 1");
  }

  if (!Number.isSafeInteger(maxItemTextBytes) || maxItemTextBytes < 1) {
    throw new Error("Source comparison maxItemTextBytes must be at least 1");
  }

  return {
    compare: async (input) => {
      const evidenceBundle = EvidenceBundleSchema.parse(cloneJson(input.evidenceBundle));
      const knowledgeSpaceId = input.knowledgeSpaceId.trim();

      if (!knowledgeSpaceId) {
        throw new Error("Source comparison knowledgeSpaceId is required");
      }

      if (evidenceBundle.items.length > maxEvidenceItems) {
        throw new Error(
          `Source comparison evidence item count exceeds maxEvidenceItems=${maxEvidenceItems}`,
        );
      }

      const sources = evidenceBundle.items.map((item) =>
        toSourceComparisonSource(item, maxItemTextBytes),
      );
      const judged = await judge.compare({
        query: evidenceBundle.query,
        sources: cloneJson(sources),
      });
      const sourceLocationsByNodeId = new Map(
        sources.map((source) => [source.nodeId, source.citations]),
      );
      const findings = judged.findings.map((finding) =>
        normalizeFinding(finding, sourceLocationsByNodeId),
      );

      return cloneJson({
        comparedAt: now(),
        evidenceBundleId: evidenceBundle.id,
        findings,
        knowledgeSpaceId,
        query: evidenceBundle.query,
        sourceCount: sources.length,
        strategyVersion: "source-comparison-v1",
        summary: requiredString(judged.summary, "summary"),
        ...(input.traceId ? { traceId: input.traceId } : {}),
      } satisfies SourceComparisonReport);
    },
  };
}

function toSourceComparisonSource(
  item: EvidenceItem,
  maxItemTextBytes: number,
): SourceComparisonSource {
  const text = item.text.trim();

  if (new TextEncoder().encode(text).byteLength > maxItemTextBytes) {
    throw new Error(
      `Source comparison evidence item text exceeds maxItemTextBytes=${maxItemTextBytes}`,
    );
  }

  return {
    citations: cloneJson(item.citations),
    freshness: cloneJson(item.freshness),
    metadata: cloneJson(item.metadata),
    nodeId: item.nodeId,
    score: item.score,
    text,
  };
}

function normalizeFinding(
  finding: SourceComparisonJudgeFinding,
  sourceLocationsByNodeId: ReadonlyMap<string, readonly Citation[]>,
): SourceComparisonFinding {
  const evidenceNodeIds = finding.evidenceNodeIds.map((nodeId) =>
    requiredString(nodeId, "finding evidenceNodeId"),
  );
  const sourceLocationsByNodeIdObject = Object.fromEntries(
    evidenceNodeIds.map((nodeId) => [nodeId, cloneJson(sourceLocationsByNodeId.get(nodeId) ?? [])]),
  );
  const sourceLocations = evidenceNodeIds.flatMap(
    (nodeId) => sourceLocationsByNodeIdObject[nodeId] ?? [],
  );

  return {
    evidenceNodeIds,
    kind: finding.kind,
    sourceLocations,
    sourceLocationsByNodeId: sourceLocationsByNodeIdObject,
    summary: requiredString(finding.summary, "finding summary"),
  };
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Source comparison ${label} is required`);
  }

  return normalized;
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
