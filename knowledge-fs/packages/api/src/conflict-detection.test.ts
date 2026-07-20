import { describe, expect, it } from "vitest";

import { createConflictDetectionService } from "./conflict-detection";
import type { SourceComparisonReport } from "./source-comparison";

describe("conflict detection service", () => {
  it("detects source-location conflicts from comparison findings with an injected detector", async () => {
    const detectorCalls: unknown[] = [];
    const service = createConflictDetectionService({
      detector: {
        detect: async (input) => {
          detectorCalls.push(input);
          const firstFinding = requiredItem(input.findings, 0);

          return {
            conflicts: [
              {
                confidence: 0.92,
                evidenceNodeIds: firstFinding.evidenceNodeIds,
                severity: "blocking",
                summary: "Notice period conflicts between policy and email.",
              },
            ],
            summary: "One blocking conflict found.",
          };
        },
      },
      maxConflicts: 4,
      maxFindings: 4,
      now: () => "2026-05-12T17:30:00.000Z",
    });

    const result = await service.detect({
      comparisonReport: comparisonReport(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8f01",
    });

    expect(result).toMatchObject({
      conflictCount: 1,
      detectedAt: "2026-05-12T17:30:00.000Z",
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      conflicts: [
        {
          confidence: 0.92,
          evidenceNodeIds: [
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
          ],
          severity: "blocking",
          sourceLocations: [
            { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01" },
            { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c03" },
          ],
        },
      ],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      strategyVersion: "conflict-detection-v1",
      summary: "One blocking conflict found.",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8f01",
    });
    expect(detectorCalls).toMatchObject([
      {
        findings: [{ kind: "difference" }],
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      },
    ]);

    requiredItem(requiredItem(result.conflicts, 0).sourceLocations, 0).sectionPath.push("mutated");
    const second = await service.detect({
      comparisonReport: comparisonReport(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    expect(requiredItem(requiredItem(second.conflicts, 0).sourceLocations, 0).sectionPath).toEqual([
      "Policy",
    ]);
  });

  it("rejects unbounded conflict detection inputs and invalid detector output", async () => {
    expect(() =>
      createConflictDetectionService({
        detector: { detect: async () => ({ conflicts: [], summary: "" }) },
        maxFindings: 0,
      }),
    ).toThrow("Conflict detection maxFindings must be at least 1");

    const tooManyFindings = createConflictDetectionService({
      detector: { detect: async () => ({ conflicts: [], summary: "unused" }) },
      maxFindings: 1,
    });
    await expect(
      tooManyFindings.detect({
        comparisonReport: comparisonReport(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Conflict detection finding count exceeds maxFindings=1");

    const tooManyConflicts = createConflictDetectionService({
      detector: {
        detect: async () => ({
          conflicts: [
            conflict("018f0d60-7a49-7cc2-9c1b-5b36f18f7b01"),
            conflict("018f0d60-7a49-7cc2-9c1b-5b36f18f7b03"),
          ],
          summary: "too many",
        }),
      },
      maxConflicts: 1,
      maxFindings: 4,
    });
    await expect(
      tooManyConflicts.detect({
        comparisonReport: comparisonReport(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Conflict detection conflict count exceeds maxConflicts=1");
  });

  it("preserves grouped source locations when evidence nodes have multiple citations", async () => {
    const service = createConflictDetectionService({
      detector: {
        detect: async () => ({
          conflicts: [
            {
              confidence: 0.9,
              evidenceNodeIds: [
                "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
                "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
              ],
              severity: "warning",
              summary: "The policy and email disagree.",
            },
          ],
          summary: "Grouped conflict found.",
        }),
      },
    });

    const report = await service.detect({
      comparisonReport: {
        ...comparisonReport(),
        findings: [
          {
            evidenceNodeIds: [
              "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
              "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
            ],
            kind: "difference",
            sourceLocations: [
              {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01",
                documentVersion: 1,
                sectionPath: ["Policy", "Main"],
              },
              {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02",
                documentVersion: 1,
                sectionPath: ["Policy", "Appendix"],
              },
              {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c03",
                documentVersion: 1,
                sectionPath: ["Email"],
              },
            ],
            sourceLocationsByNodeId: {
              "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01": [
                {
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01",
                  documentVersion: 1,
                  sectionPath: ["Policy", "Main"],
                },
                {
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02",
                  documentVersion: 1,
                  sectionPath: ["Policy", "Appendix"],
                },
              ],
              "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03": [
                {
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c03",
                  documentVersion: 1,
                  sectionPath: ["Email"],
                },
              ],
            },
            summary: "The notice period differs across sources.",
          },
        ],
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });

    expect(requiredItem(report.conflicts, 0).sourceLocations).toMatchObject([
      { sectionPath: ["Policy", "Main"] },
      { sectionPath: ["Policy", "Appendix"] },
      { sectionPath: ["Email"] },
    ]);
  });
});

function conflict(nodeId: string) {
  return {
    confidence: 0.8,
    evidenceNodeIds: [nodeId],
    severity: "warning" as const,
    summary: "conflict",
  };
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`Expected item at index ${index}`);
  }

  return item;
}

function comparisonReport(): SourceComparisonReport {
  return {
    comparedAt: "2026-05-12T17:00:00.000Z",
    evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
    findings: [
      {
        evidenceNodeIds: [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
        ],
        kind: "difference",
        sourceLocations: [
          {
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01",
            documentVersion: 1,
            sectionPath: ["Policy"],
          },
          {
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c03",
            documentVersion: 1,
            sectionPath: ["Email"],
          },
        ],
        summary: "The notice period differs across sources.",
      },
      {
        evidenceNodeIds: [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7b02",
        ],
        kind: "agreement",
        sourceLocations: [],
        summary: "Both sources mention annual renewal.",
      },
    ],
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    query: "compare renewal evidence",
    sourceCount: 3,
    strategyVersion: "source-comparison-v1",
    summary: "Renewal is agreed, notice period differs.",
  };
}
