import { describe, expect, it } from "vitest";

import {
  evaluateDocumentMultimodalCitations,
  evaluateDocumentMultimodalOcrRecall,
  evaluateDocumentMultimodalUnderstanding,
  gateDocumentMultimodalModeEvaluations,
} from "./document-multimodal-evaluation";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { HybridRetrievalItem } from "./retrieval-fusion";

describe("document multimodal citation evaluation", () => {
  it("scores manifest item, page, and bounding box hits", () => {
    const report = evaluateDocumentMultimodalCitations({
      expectations: [
        {
          expectedBoundingBox: { height: 100, width: 200, x: 10, y: 20 },
          expectedManifestItemId: "manifest:0:figure-1",
          expectedPageNumber: 2,
          expectedVisualEmbeddingHit: true,
          id: "case-hit",
          nodeId: "node-hit",
        },
        {
          expectedBoundingBox: { height: 100, width: 200, x: 10, y: 20 },
          expectedManifestItemId: "manifest:0:figure-2",
          expectedPageNumber: 7,
          expectedVisualEmbeddingHit: true,
          id: "case-miss",
          nodeId: "node-miss",
        },
        {
          expectedManifestItemId: "manifest:0:missing",
          id: "case-missing",
          nodeId: "node-missing",
        },
      ],
      items: [
        retrievalItem({
          metadata: {
            multimodalCandidate: {
              boundingBox: { height: 98, width: 198, x: 11, y: 21 },
              manifestItemId: "manifest:0:figure-1",
              pageNumber: 2,
              visualEmbeddingStatus: "provided",
            },
          },
          nodeId: "node-hit",
        }),
        retrievalItem({
          metadata: {
            multimodalCandidate: {
              boundingBox: { height: 30, width: 40, x: 500, y: 500 },
              manifestItemId: "manifest:0:wrong",
              pageNumber: 8,
              visualEmbeddingStatus: "missing",
            },
          },
          nodeId: "node-miss",
        }),
      ],
    });

    expect(report).toMatchObject({
      metrics: {
        boundingBoxHitRate: 0.5,
        manifestItemHitRate: 0.333,
        missingRate: 0.333,
        pageHitRate: 0.5,
        visualEmbeddingHitRate: 0.5,
      },
      strategyVersion: "document-multimodal-citation-eval-v1",
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        boundingBoxHit: true,
        expectedManifestItemHit: true,
        expectedPageHit: true,
        expectedVisualEmbeddingHit: true,
        id: "case-hit",
        observedVisualEmbeddingHit: true,
        status: "hit",
      }),
      expect.objectContaining({
        boundingBoxHit: false,
        expectedManifestItemHit: false,
        expectedPageHit: false,
        expectedVisualEmbeddingHit: false,
        id: "case-miss",
        observedVisualEmbeddingHit: false,
        status: "miss",
      }),
      expect.objectContaining({
        id: "case-missing",
        status: "missing",
      }),
    ]);
  });

  it("falls back to projection multimodal metadata and validates IoU thresholds", () => {
    const report = evaluateDocumentMultimodalCitations({
      boundingBoxIouThreshold: 0.9,
      expectations: [
        {
          expectedBoundingBox: { height: 100, width: 200, x: 10, y: 20 },
          expectedManifestItemId: "manifest:0:figure-1",
          expectedPageNumber: 4,
          id: "case-projection",
          nodeId: "node-projection",
        },
      ],
      items: [
        retrievalItem({
          citation: { ...retrievalItem().citation, pageNumber: 4 },
          metadata: {
            multimodal: {
              boundingBox: { height: 100, width: 200, x: 10, y: 20 },
              manifestItemId: "manifest:0:figure-1",
            },
          },
          nodeId: "node-projection",
        }),
      ],
    });

    expect(report.metrics).toEqual({
      boundingBoxHitRate: 1,
      manifestItemHitRate: 1,
      missingRate: 0,
      pageHitRate: 1,
      visualEmbeddingHitRate: null,
    });
    expect(() =>
      evaluateDocumentMultimodalCitations({
        boundingBoxIouThreshold: 1.1,
        expectations: [],
        items: [],
      }),
    ).toThrow("Document multimodal citation eval boundingBoxIouThreshold must be 0..1");
  });
});

describe("document multimodal understanding evaluation", () => {
  it("scores chart and table understanding metadata from manifests", () => {
    const baseManifest = createDocumentMultimodalManifestBuilder().build({
      artifact: {
        artifactHash: "c".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        elements: [
          {
            id: "chart-1",
            metadata: { chartTitle: "ARR bridge" },
            pageNumber: 2,
            sectionPath: ["Metrics"],
            type: "image",
          },
          {
            id: "table-1",
            metadata: {},
            sectionPath: ["Metrics"],
            text: "metric | value\nARR | $12M",
            type: "table",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    const chartId = baseManifest.items[0]?.id;
    const tableId = baseManifest.items[1]?.id;

    if (!chartId || !tableId) {
      throw new Error("Expected multimodal manifest fixture items");
    }

    const manifest = {
      ...baseManifest,
      items: baseManifest.items.map((item) =>
        item.id === chartId
          ? {
              ...item,
              caption: "ARR bridge chart",
              sourceMetadata: {
                ...item.sourceMetadata,
                enrichment: {
                  status: "provided",
                  summary: "ARR grew 18% quarter over quarter with expansion leading the bridge.",
                  task: "chart",
                },
              },
              textPreview: "ARR grew 18% quarter over quarter with expansion leading the bridge.",
              title: "ARR bridge",
            }
          : {
              ...item,
              sourceMetadata: {
                ...item.sourceMetadata,
                enrichment: {
                  status: "provided",
                  summary: "ARR table shows $12M.",
                  task: "table",
                },
              },
              textPreview: "ARR table shows $12M.",
              title: "ARR table",
            },
      ),
    };

    const report = evaluateDocumentMultimodalUnderstanding({
      expectations: [
        {
          expectedModality: "image",
          expectedSummaryKeywords: ["ARR grew", "expansion"],
          expectedTitle: "ARR bridge",
          expectedUnderstandingStatus: "provided",
          id: "chart-case",
          manifestItemId: chartId,
        },
        {
          expectedModality: "table",
          expectedSummaryKeywords: ["ARR", "$12M", "gross margin"],
          expectedTitle: "ARR table",
          expectedUnderstandingStatus: "provided",
          id: "table-case",
          manifestItemId: tableId,
        },
        {
          expectedSummaryKeywords: ["missing"],
          id: "missing-case",
          manifestItemId: "missing-item",
        },
      ],
      manifest,
    });

    expect(report).toMatchObject({
      metrics: {
        missingRate: 0.333,
        modalityHitRate: 1,
        summaryKeywordHitRate: 0.556,
        titleHitRate: 1,
        understandingStatusHitRate: 1,
      },
      strategyVersion: "document-multimodal-understanding-eval-v1",
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        id: "chart-case",
        status: "hit",
        summaryKeywordHitRate: 1,
        summaryKeywordHits: ["ARR grew", "expansion"],
      }),
      expect.objectContaining({
        id: "table-case",
        status: "miss",
        summaryKeywordHitRate: 0.667,
        summaryKeywordMisses: ["gross margin"],
      }),
      expect.objectContaining({
        id: "missing-case",
        status: "missing",
        summaryKeywordHitRate: 0,
      }),
    ]);
  });
});

describe("document multimodal OCR recall evaluation", () => {
  it("scores OCR keyword recall from manifest items", () => {
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact: {
        artifactHash: "d".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        elements: [
          {
            id: "image-1",
            metadata: { ocrText: "Q1 renewals increased 12% in enterprise." },
            pageNumber: 3,
            sectionPath: ["Metrics"],
            type: "image",
          },
          {
            id: "image-2",
            metadata: {},
            pageNumber: 4,
            sectionPath: ["Metrics"],
            text: "Gross margin improved.",
            type: "image",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    const firstId = manifest.items[0]?.id;
    const secondId = manifest.items[1]?.id;

    if (!firstId || !secondId) {
      throw new Error("Expected OCR recall manifest fixture items");
    }

    const report = evaluateDocumentMultimodalOcrRecall({
      expectations: [
        {
          expectedKeywords: ["renewals", "enterprise"],
          id: "ocr-hit",
          manifestItemId: firstId,
        },
        {
          expectedKeywords: ["gross margin", "enterprise"],
          id: "ocr-miss",
          manifestItemId: secondId,
        },
        {
          expectedKeywords: ["missing"],
          id: "ocr-missing",
          manifestItemId: "missing-item",
        },
      ],
      manifest,
    });

    expect(report).toMatchObject({
      metrics: {
        missingRate: 0.333,
        ocrKeywordHitRate: 0.5,
      },
      strategyVersion: "document-multimodal-ocr-recall-eval-v1",
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        id: "ocr-hit",
        ocrKeywordHitRate: 1,
        ocrKeywordHits: ["renewals", "enterprise"],
        status: "hit",
      }),
      expect.objectContaining({
        id: "ocr-miss",
        ocrKeywordHitRate: 0.5,
        ocrKeywordMisses: ["enterprise"],
        status: "miss",
      }),
      expect.objectContaining({
        id: "ocr-missing",
        ocrKeywordHitRate: 0,
        status: "missing",
      }),
    ]);
  });
});

describe("document multimodal mode evaluation gate", () => {
  it("gates fast, deep, and research multimodal metrics with per-mode failures", () => {
    const citation = evaluateDocumentMultimodalCitations({
      expectations: [
        {
          expectedManifestItemId: "manifest:0:figure-1",
          expectedPageNumber: 2,
          expectedVisualEmbeddingHit: true,
          id: "case-hit",
          nodeId: "node-hit",
        },
      ],
      items: [
        retrievalItem({
          metadata: {
            multimodalCandidate: {
              manifestItemId: "manifest:0:figure-1",
              pageNumber: 2,
              visualEmbeddingStatus: "provided",
            },
          },
          nodeId: "node-hit",
        }),
      ],
    });
    const failingCitation = evaluateDocumentMultimodalCitations({
      expectations: [
        {
          expectedManifestItemId: "manifest:0:figure-1",
          expectedPageNumber: 2,
          id: "case-miss",
          nodeId: "node-miss",
        },
      ],
      items: [],
    });
    const ocr = {
      items: [],
      metrics: { missingRate: 0, ocrKeywordHitRate: 0.75 },
      strategyVersion: "document-multimodal-ocr-recall-eval-v1" as const,
    };

    const report = gateDocumentMultimodalModeEvaluations({
      modes: {
        deep: { citation, ocr },
        fast: { citation },
        research: { citation: failingCitation, ocr },
      },
      thresholds: {
        maxCitationMissingRate: 0.1,
        minManifestItemHitRate: 0.8,
        minOcrKeywordHitRate: 0.8,
        minPageHitRate: 0.8,
        minVisualEmbeddingHitRate: 0.8,
      },
    });

    expect(report).toEqual({
      failures: [
        "deep.ocr.ocrKeywordHitRate 0.75 < 0.8",
        "research.citation.missingRate 1 > 0.1",
        "research.citation.manifestItemHitRate 0 < 0.8",
        "research.citation.pageHitRate 0 < 0.8",
        "research.citation.visualEmbeddingHitRate is unavailable",
        "research.ocr.ocrKeywordHitRate 0.75 < 0.8",
      ],
      modes: {
        deep: {
          failures: ["deep.ocr.ocrKeywordHitRate 0.75 < 0.8"],
          passed: false,
        },
        fast: {
          failures: [],
          passed: true,
        },
        research: {
          failures: [
            "research.citation.missingRate 1 > 0.1",
            "research.citation.manifestItemHitRate 0 < 0.8",
            "research.citation.pageHitRate 0 < 0.8",
            "research.citation.visualEmbeddingHitRate is unavailable",
            "research.ocr.ocrKeywordHitRate 0.75 < 0.8",
          ],
          passed: false,
        },
      },
      passed: false,
      strategyVersion: "document-multimodal-mode-gate-v1",
    });
    expect(() =>
      gateDocumentMultimodalModeEvaluations({
        modes: {},
        thresholds: { minPageHitRate: 1.1 },
      }),
    ).toThrow("Document multimodal mode gate minPageHitRate must be 0..1");
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
