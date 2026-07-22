import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createFreshnessCheckingService } from "./freshness-checking";

describe("freshness checking service", () => {
  it("returns stale evidence warnings with source locations", async () => {
    const service = createFreshnessCheckingService({
      maxEvidenceItems: 4,
      now: () => "2026-05-12T18:30:00.000Z",
      staleAfterSeconds: 86_400,
    });

    const report = await service.check({
      evidenceBundle: freshnessBundle(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    });

    expect(report).toMatchObject({
      checkedAt: "2026-05-12T18:30:00.000Z",
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "which policy is current?",
      staleCount: 2,
      strategyVersion: "freshness-check-v1",
      summary: "2 stale evidence item(s) found.",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      warnings: [
        {
          evidenceNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c02",
          reason: "stale-status",
          severity: "warning",
          sourceLocations: [{ documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02" }],
        },
        {
          ageSeconds: 172_800,
          evidenceNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c03",
          reason: "source-updated-at-exceeds-policy",
          severity: "warning",
          sourceUpdatedAt: "2026-05-10T18:30:00.000Z",
        },
      ],
    });

    sourceLocationAt(warningAt(report.warnings, 0).sourceLocations, 0).sectionPath.push("mutated");
    const second = await service.check({
      evidenceBundle: freshnessBundle(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    expect(sourceLocationAt(warningAt(second.warnings, 0).sourceLocations, 0).sectionPath).toEqual([
      "Old Policy",
    ]);
  });

  it("rejects unbounded freshness inputs and invalid configuration", async () => {
    expect(() =>
      createFreshnessCheckingService({
        maxEvidenceItems: 0,
      }),
    ).toThrow("Freshness checking maxEvidenceItems must be at least 1");

    expect(() =>
      createFreshnessCheckingService({
        staleAfterSeconds: 0,
      }),
    ).toThrow("Freshness checking staleAfterSeconds must be at least 1");

    const service = createFreshnessCheckingService({
      maxEvidenceItems: 2,
    });
    await expect(
      service.check({
        evidenceBundle: freshnessBundle(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Freshness checking evidence item count exceeds maxEvidenceItems=2");
  });
});

function freshnessBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T18:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
    items: [
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
        freshness: { status: "fresh" as const, sourceUpdatedAt: "2026-05-12T18:00:00.000Z" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c01",
        sectionPath: ["Current Policy"],
      }),
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02",
        freshness: { status: "stale" as const, sourceUpdatedAt: "2026-05-01T18:30:00.000Z" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c02",
        sectionPath: ["Old Policy"],
      }),
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
        freshness: { status: "unknown" as const, sourceUpdatedAt: "2026-05-10T18:30:00.000Z" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c03",
        sectionPath: ["Cached Memo"],
      }),
    ],
    missingEvidence: [],
    query: "which policy is current?",
    state: "partial",
  });
}

function evidenceItem({
  documentAssetId,
  freshness,
  nodeId,
  sectionPath,
}: {
  readonly documentAssetId: string;
  readonly freshness: {
    readonly sourceUpdatedAt?: string | undefined;
    readonly status: "fresh" | "stale" | "unknown";
  };
  readonly nodeId: string;
  readonly sectionPath: readonly string[];
}) {
  return {
    citations: [
      {
        documentAssetId,
        documentVersion: 1,
        sectionPath,
        startOffset: 0,
      },
    ],
    conflicts: [],
    freshness,
    metadata: {},
    nodeId,
    score: 0.8,
    scores: { final: 0.8, retrieval: 0.8 },
    text: `Evidence from ${sectionPath.join("/")}`,
  };
}

function warningAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected warning at index ${index}`);
  }

  return item;
}

function sourceLocationAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected source location at index ${index}`);
  }

  return item;
}
