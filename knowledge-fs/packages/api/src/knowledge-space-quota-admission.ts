import type { KnowledgeSpaceManifest } from "@knowledge/core";

import type { KnowledgeSpaceQuotaUsageReader } from "./knowledge-space-quota-usage";

export interface KnowledgeSpaceQuotaAdmissionDelta {
  readonly artifactBytes?: number | undefined;
  readonly nodeCount?: number | undefined;
  readonly projectionCount?: number | undefined;
  readonly rawDocumentBytes?: number | undefined;
  readonly segmentCount?: number | undefined;
}

export interface EnforceKnowledgeSpaceQuotaAdmissionInput {
  readonly delta?: KnowledgeSpaceQuotaAdmissionDelta | undefined;
  readonly knowledgeSpaceId: string;
  readonly manifest: KnowledgeSpaceManifest;
  readonly projectionVersion: number;
  readonly usageReader: KnowledgeSpaceQuotaUsageReader;
}

export class KnowledgeSpaceQuotaExceededError extends Error {
  constructor(readonly dimension: KnowledgeSpaceQuotaDimension) {
    super(`KnowledgeSpace quota exceeded: ${dimension}`);
  }
}

export class KnowledgeSpaceQuotaUsageTruncatedError extends Error {
  constructor() {
    super("KnowledgeSpace quota usage is truncated");
  }
}

type KnowledgeSpaceQuotaDimension =
  | "maxArtifactBytes"
  | "maxNodeCount"
  | "maxProjectionCount"
  | "maxRawDocumentBytes"
  | "maxSegmentCount";

export async function enforceKnowledgeSpaceQuotaAdmission({
  delta,
  knowledgeSpaceId,
  manifest,
  projectionVersion,
  usageReader,
}: EnforceKnowledgeSpaceQuotaAdmissionInput): Promise<void> {
  const supportedLimits = manifest.quotaPolicy;
  const activeLimits = quotaChecks
    .map((check) => ({
      ...check,
      limit: supportedLimits[check.dimension],
    }))
    .filter((check) => check.limit !== null);

  if (activeLimits.length === 0) {
    return;
  }

  const usage = await usageReader.read({ knowledgeSpaceId, projectionVersion });

  if (usage.truncated) {
    throw new KnowledgeSpaceQuotaUsageTruncatedError();
  }

  for (const check of activeLimits) {
    const projected = usage[check.usageField] + (delta?.[check.deltaField] ?? 0);

    if (check.limit !== null && projected > check.limit) {
      throw new KnowledgeSpaceQuotaExceededError(check.dimension);
    }
  }
}

const quotaChecks = [
  {
    deltaField: "rawDocumentBytes",
    dimension: "maxRawDocumentBytes",
    usageField: "rawDocumentBytes",
  },
  {
    deltaField: "artifactBytes",
    dimension: "maxArtifactBytes",
    usageField: "artifactBytes",
  },
  {
    deltaField: "segmentCount",
    dimension: "maxSegmentCount",
    usageField: "segmentCount",
  },
  {
    deltaField: "nodeCount",
    dimension: "maxNodeCount",
    usageField: "nodeCount",
  },
  {
    deltaField: "projectionCount",
    dimension: "maxProjectionCount",
    usageField: "projectionCount",
  },
] as const satisfies readonly {
  readonly deltaField: keyof KnowledgeSpaceQuotaAdmissionDelta;
  readonly dimension: KnowledgeSpaceQuotaDimension;
  readonly usageField:
    | "artifactBytes"
    | "nodeCount"
    | "projectionCount"
    | "rawDocumentBytes"
    | "segmentCount";
}[];
