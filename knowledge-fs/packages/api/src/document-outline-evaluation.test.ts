import { describe, expect, it } from "vitest";

import { evaluateDocumentOutlineLocalization } from "./document-outline-evaluation";
import type { HybridRetrievalItem } from "./retrieval-fusion";

describe("document outline localization evaluation", () => {
  it("scores section and page localization hits from outline-enriched retrieval items", () => {
    const report = evaluateDocumentOutlineLocalization({
      expectations: [
        {
          expectedPageNumber: 2,
          expectedSectionPath: ["Guide", "Refunds"],
          id: "case-hit",
          nodeId: "node-hit",
        },
        {
          expectedPageNumber: 7,
          expectedSectionPath: ["Guide", "Approvals"],
          id: "case-miss",
          nodeId: "node-miss",
        },
        {
          expectedSectionPath: ["Guide", "Missing"],
          id: "case-missing",
          nodeId: "node-missing",
        },
      ],
      items: [
        retrievalItem({
          metadata: {
            documentOutline: {
              sectionPath: ["Guide", "Refunds"],
              startPage: 2,
            },
          },
          nodeId: "node-hit",
        }),
        retrievalItem({
          metadata: {
            documentOutline: {
              sectionPath: ["Guide", "Other"],
              startPage: 8,
            },
          },
          nodeId: "node-miss",
        }),
      ],
    });

    expect(report).toMatchObject({
      metrics: {
        missingRate: 0.333,
        pageHitRate: 0.5,
        sectionHitRate: 0.333,
      },
      strategyVersion: "document-outline-localization-eval-v1",
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        expectedPageHit: true,
        expectedSectionHit: true,
        id: "case-hit",
        observedPageNumber: 2,
        observedSectionPath: ["Guide", "Refunds"],
        status: "hit",
      }),
      expect.objectContaining({
        expectedPageHit: false,
        expectedSectionHit: false,
        id: "case-miss",
        observedPageNumber: 8,
        observedSectionPath: ["Guide", "Other"],
        status: "miss",
      }),
      expect.objectContaining({
        expectedSectionHit: false,
        id: "case-missing",
        observedSectionPath: [],
        status: "missing",
      }),
    ]);
  });

  it("falls back to citation section and page when outline metadata is absent", () => {
    const report = evaluateDocumentOutlineLocalization({
      expectations: [
        {
          expectedPageNumber: 4,
          expectedSectionPath: ["Appendix"],
          id: "case-citation",
          nodeId: "node-citation",
        },
      ],
      items: [
        retrievalItem({
          citation: {
            artifactHash: "b".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            documentVersion: 1,
            pageNumber: 4,
            sectionPath: ["Appendix"],
          },
          nodeId: "node-citation",
        }),
      ],
    });

    expect(report.metrics).toEqual({
      missingRate: 0,
      pageHitRate: 1,
      sectionHitRate: 1,
    });
  });
});

function retrievalItem(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      sectionPath: ["Guide"],
    },
    metadata: {},
    nodeId: "node",
    projectionIds: ["projection-1"],
    score: 1,
    sources: ["dense"],
    ...overrides,
  };
}
