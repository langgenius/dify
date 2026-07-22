import { describe, expect, it } from "vitest";

import {
  evaluateDocumentMultimodalCitations,
  evaluateDocumentMultimodalOcrRecall,
  evaluateDocumentMultimodalUnderstanding,
  gateDocumentMultimodalModeEvaluations,
} from "./document-multimodal-evaluation";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { HybridRetrievalItem } from "./retrieval-fusion";

describe("document multimodal citation evaluation branch coverage", () => {
  it("marks missing items with per-expectation false hits when only bbox/page/visual are expected", () => {
    const report = evaluateDocumentMultimodalCitations({
      expectations: [
        {
          expectedBoundingBox: { height: 10, width: 10, x: 0, y: 0 },
          expectedPageNumber: 3,
          expectedVisualEmbeddingHit: true,
          id: "missing-with-visual-expectations",
          nodeId: "node-not-retrieved",
        },
      ],
      items: [],
    });

    expect(report.items).toEqual([
      {
        boundingBoxHit: false,
        expectedPageHit: false,
        expectedVisualEmbeddingHit: false,
        id: "missing-with-visual-expectations",
        nodeId: "node-not-retrieved",
        status: "missing",
      },
    ]);
    expect(report.metrics).toEqual({
      boundingBoxHitRate: 0,
      manifestItemHitRate: null,
      missingRate: 1,
      pageHitRate: 0,
      visualEmbeddingHitRate: 0,
    });
  });

  it("evaluates retrieved items that expose no multimodal metadata at all", () => {
    const report = evaluateDocumentMultimodalCitations({
      expectations: [
        {
          expectedBoundingBox: { height: 10, width: 10, x: 0, y: 0 },
          id: "bare-item",
          nodeId: "node-bare",
        },
      ],
      items: [
        retrievalItem({
          metadata: {},
          nodeId: "node-bare",
        }),
      ],
    });

    expect(report.items).toEqual([
      {
        boundingBoxHit: false,
        id: "bare-item",
        nodeId: "node-bare",
        status: "miss",
      },
    ]);
    expect(report.metrics).toEqual({
      boundingBoxHitRate: 0,
      manifestItemHitRate: null,
      missingRate: 0,
      pageHitRate: null,
      visualEmbeddingHitRate: null,
    });
  });

  it("ignores partial bounding box metadata and scores zero-area IoU as zero", () => {
    const report = evaluateDocumentMultimodalCitations({
      boundingBoxIouThreshold: 0,
      expectations: [
        {
          expectedBoundingBox: { height: 10, width: 10, x: 0, y: 0 },
          id: "partial-bbox",
          nodeId: "node-partial-bbox",
        },
        {
          expectedBoundingBox: { height: 0, width: 0, x: 5, y: 5 },
          id: "zero-area-bbox",
          nodeId: "node-zero-area",
        },
      ],
      items: [
        retrievalItem({
          metadata: {
            multimodalCandidate: {
              boundingBox: { x: 1, y: 2 },
            },
          },
          nodeId: "node-partial-bbox",
        }),
        retrievalItem({
          metadata: {
            multimodalCandidate: {
              boundingBox: { height: 0, width: 0, x: 5, y: 5 },
            },
          },
          nodeId: "node-zero-area",
        }),
      ],
    });

    // Partial bbox metadata (missing width/height) is dropped, so no observed bbox exists.
    expect(report.items[0]).toMatchObject({ boundingBoxHit: false, status: "miss" });
    // Zero-area union yields IoU 0, which still satisfies a 0 threshold.
    expect(report.items[1]).toMatchObject({ boundingBoxHit: true, status: "hit" });
  });

  it("returns zeroed missing rate and null hit rates for empty expectations", () => {
    const report = evaluateDocumentMultimodalCitations({ expectations: [], items: [] });

    expect(report.metrics).toEqual({
      boundingBoxHitRate: null,
      manifestItemHitRate: null,
      missingRate: 0,
      pageHitRate: null,
      visualEmbeddingHitRate: null,
    });
  });
});

describe("document multimodal understanding evaluation branch coverage", () => {
  it("marks missing items with modality/title/status expectations and no keywords", () => {
    const report = evaluateDocumentMultimodalUnderstanding({
      expectations: [
        {
          expectedModality: "image",
          expectedTitle: "ARR bridge",
          expectedUnderstandingStatus: "provided",
          id: "missing-structured",
          manifestItemId: "does-not-exist",
        },
      ],
      manifest: buildUnderstandingManifest(),
    });

    expect(report.items).toEqual([
      {
        expectedModalityHit: false,
        expectedTitleHit: false,
        expectedUnderstandingStatusHit: false,
        id: "missing-structured",
        manifestItemId: "does-not-exist",
        status: "missing",
      },
    ]);
    expect(report.metrics).toEqual({
      missingRate: 1,
      modalityHitRate: 0,
      summaryKeywordHitRate: null,
      titleHitRate: 0,
      understandingStatusHitRate: 0,
    });
  });

  it("evaluates untitled unenriched items without optional expectations", () => {
    const manifest = buildUnderstandingManifest();
    const itemId = manifest.items[0]?.id;

    if (!itemId) {
      throw new Error("Expected understanding manifest fixture item");
    }

    const report = evaluateDocumentMultimodalUnderstanding({
      expectations: [
        {
          id: "no-expectations",
          manifestItemId: itemId,
        },
        {
          expectedTitle: "ARR bridge",
          id: "title-against-untitled",
          manifestItemId: itemId,
        },
      ],
      manifest,
    });

    // Without any expected fields there is nothing to score, so the item cannot be a hit.
    expect(report.items[0]).toEqual({
      id: "no-expectations",
      manifestItemId: itemId,
      observedModality: "image",
      status: "miss",
    });
    // Untitled item never matches an expected title.
    expect(report.items[1]).toMatchObject({
      expectedTitleHit: false,
      status: "miss",
    });
    expect(report.metrics).toEqual({
      missingRate: 0,
      modalityHitRate: null,
      summaryKeywordHitRate: null,
      titleHitRate: 0,
      understandingStatusHitRate: null,
    });
  });

  it("searches keyword evidence through arrays and nested metadata objects", () => {
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact: {
        artifactHash: "e".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        elements: [
          {
            id: "figure-nested",
            metadata: {
              blank: "   ",
              count: 42,
              nested: { note: "beta insight" },
              tags: ["alpha finding", 7],
            },
            sectionPath: ["Appendix"],
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
    const itemId = manifest.items[0]?.id;

    if (!itemId) {
      throw new Error("Expected nested metadata manifest fixture item");
    }

    const report = evaluateDocumentMultimodalUnderstanding({
      expectations: [
        {
          expectedSummaryKeywords: ["alpha finding", "beta insight", "gamma"],
          id: "nested-keywords",
          manifestItemId: itemId,
        },
      ],
      manifest,
    });

    expect(report.items[0]).toMatchObject({
      summaryKeywordHitRate: 0.667,
      summaryKeywordHits: ["alpha finding", "beta insight"],
      summaryKeywordMisses: ["gamma"],
    });
  });
});

describe("document multimodal OCR recall evaluation branch coverage", () => {
  it("returns null OCR keyword hit rate for empty expectations", () => {
    const report = evaluateDocumentMultimodalOcrRecall({
      expectations: [],
      manifest: buildUnderstandingManifest(),
    });

    expect(report.metrics).toEqual({
      missingRate: 0,
      ocrKeywordHitRate: null,
    });
    expect(report.items).toEqual([]);
  });
});

describe("document multimodal mode gate branch coverage", () => {
  it("gates understanding-only modes and skips explicitly undefined thresholds", () => {
    const understanding = {
      items: [],
      metrics: {
        missingRate: 0,
        modalityHitRate: null,
        summaryKeywordHitRate: 0.7,
        titleHitRate: null,
        understandingStatusHitRate: 1,
      },
      strategyVersion: "document-multimodal-understanding-eval-v1" as const,
    };

    const report = gateDocumentMultimodalModeEvaluations({
      modes: { fast: { understanding } },
      thresholds: {
        maxUnderstandingMissingRate: 0.25,
        minPageHitRate: undefined,
        minSummaryKeywordHitRate: 0.9,
        minUnderstandingStatusHitRate: 0.5,
      },
    });

    expect(report).toEqual({
      failures: ["fast.understanding.summaryKeywordHitRate 0.7 < 0.9"],
      modes: {
        fast: {
          failures: ["fast.understanding.summaryKeywordHitRate 0.7 < 0.9"],
          passed: false,
        },
      },
      passed: false,
      strategyVersion: "document-multimodal-mode-gate-v1",
    });
  });
});

function buildUnderstandingManifest() {
  return createDocumentMultimodalManifestBuilder().build({
    artifact: {
      artifactHash: "f".repeat(64),
      contentType: "mixed",
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      elements: [
        {
          id: "figure-plain",
          metadata: {},
          sectionPath: ["Appendix"],
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
}

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
