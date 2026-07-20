import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createSourceComparisonService } from "./source-comparison";

describe("source comparison service", () => {
  it("compares bounded evidence items with an injected judge", async () => {
    const judgeCalls: unknown[] = [];
    const service = createSourceComparisonService({
      judge: {
        compare: async (input) => {
          judgeCalls.push(input);
          const first = sourceAt(input.sources, 0);
          const second = sourceAt(input.sources, 1);
          const third = sourceAt(input.sources, 2);

          return {
            findings: [
              {
                evidenceNodeIds: [first.nodeId, second.nodeId],
                kind: "agreement",
                summary: "Both sources mention annual renewal.",
              },
              {
                evidenceNodeIds: [first.nodeId, third.nodeId],
                kind: "difference",
                summary: "The notice period differs across sources.",
              },
            ],
            summary: "Renewal is agreed, notice period differs.",
          };
        },
      },
      maxEvidenceItems: 4,
      maxItemTextBytes: 80,
      now: () => "2026-05-12T17:00:00.000Z",
    });

    const report = await service.compare({
      evidenceBundle: comparisonBundle(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7f01",
    });

    expect(report).toMatchObject({
      comparedAt: "2026-05-12T17:00:00.000Z",
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      findings: [
        {
          evidenceNodeIds: [
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b02",
          ],
          kind: "agreement",
          sourceLocationsByNodeId: {
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01": [
              { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01" },
            ],
            "018f0d60-7a49-7cc2-9c1b-5b36f18f7b02": [
              { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02" },
            ],
          },
          sourceLocations: [
            { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01" },
            { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02" },
          ],
        },
        { kind: "difference" },
      ],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "compare renewal evidence",
      sourceCount: 3,
      strategyVersion: "source-comparison-v1",
      summary: "Renewal is agreed, notice period differs.",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7f01",
    });
    expect(judgeCalls).toMatchObject([
      {
        query: "compare renewal evidence",
        sources: [
          {
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
            text: "Contract says renewal is annual with 30 days notice.",
          },
          {
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b02",
          },
          {
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
          },
        ],
      },
    ]);

    sourceLocationAt(findingAt(report.findings, 0).sourceLocations, 0).sectionPath.push("mutated");
    const secondReport = await service.compare({
      evidenceBundle: comparisonBundle(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    expect(
      sourceLocationAt(findingAt(secondReport.findings, 0).sourceLocations, 0).sectionPath,
    ).toEqual(["Policy"]);
  });

  it("rejects unbounded source comparison inputs", async () => {
    expect(() =>
      createSourceComparisonService({
        judge: { compare: async () => ({ findings: [], summary: "" }) },
        maxEvidenceItems: 0,
      }),
    ).toThrow("Source comparison maxEvidenceItems must be at least 1");

    const service = createSourceComparisonService({
      judge: { compare: async () => ({ findings: [], summary: "unused" }) },
      maxEvidenceItems: 2,
      maxItemTextBytes: 12,
    });

    await expect(
      service.compare({
        evidenceBundle: comparisonBundle(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Source comparison evidence item count exceeds maxEvidenceItems=2");

    await expect(
      service.compare({
        evidenceBundle: EvidenceBundleSchema.parse({
          ...comparisonBundle(),
          items: [comparisonBundle().items[0]],
        }),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Source comparison evidence item text exceeds maxItemTextBytes=12");
  });

  it("rejects an invalid maxItemTextBytes bound", () => {
    expect(() =>
      createSourceComparisonService({
        judge: { compare: async () => ({ findings: [], summary: "" }) },
        maxItemTextBytes: 0,
      }),
    ).toThrow("Source comparison maxItemTextBytes must be at least 1");
  });

  it("rejects a blank knowledgeSpaceId", async () => {
    const service = createSourceComparisonService({
      judge: { compare: async () => ({ findings: [], summary: "unused" }) },
    });

    await expect(
      service.compare({ evidenceBundle: comparisonBundle(), knowledgeSpaceId: "   " }),
    ).rejects.toThrow("Source comparison knowledgeSpaceId is required");
  });

  it("maps findings that cite unknown evidence nodes to empty source locations", async () => {
    const service = createSourceComparisonService({
      judge: {
        compare: async () => ({
          findings: [
            {
              evidenceNodeIds: ["node-not-in-bundle"],
              kind: "unknown",
              summary: "No overlapping evidence found.",
            },
          ],
          summary: "Sources do not overlap.",
        }),
      },
    });

    const report = await service.compare({
      evidenceBundle: comparisonBundle(),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    expect(report.findings).toEqual([
      {
        evidenceNodeIds: ["node-not-in-bundle"],
        kind: "unknown",
        sourceLocations: [],
        sourceLocationsByNodeId: { "node-not-in-bundle": [] },
        summary: "No overlapping evidence found.",
      },
    ]);
  });

  it("rejects blank judge finding summaries", async () => {
    const service = createSourceComparisonService({
      judge: {
        compare: async () => ({
          findings: [{ evidenceNodeIds: [], kind: "agreement", summary: "   " }],
          summary: "ok",
        }),
      },
    });

    await expect(
      service.compare({
        evidenceBundle: comparisonBundle(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("Source comparison finding summary is required");
  });
});

function comparisonBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T16:58:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
    items: [
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
        sectionPath: ["Policy"],
        text: "Contract says renewal is annual with 30 days notice.",
      }),
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b02",
        sectionPath: ["Memo"],
        text: "Renewal happens yearly after mutual review.",
      }),
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c03",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
        sectionPath: ["Email"],
        text: "Customer email asks for 60 days notice before renewal.",
      }),
    ],
    missingEvidence: [],
    query: "compare renewal evidence",
    state: "answerable",
  });
}

function sourceAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected source at index ${index}`);
  }

  return item;
}

function findingAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected finding at index ${index}`);
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

function evidenceItem({
  documentAssetId,
  nodeId,
  sectionPath,
  text,
}: {
  readonly documentAssetId: string;
  readonly nodeId: string;
  readonly sectionPath: readonly string[];
  readonly text: string;
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
    freshness: { status: "fresh" as const },
    metadata: {},
    nodeId,
    score: 0.9,
    scores: { final: 0.9, retrieval: 0.9 },
    text,
  };
}
