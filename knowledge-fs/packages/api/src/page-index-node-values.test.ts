import { DocumentOutlineSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { PageIndexDocumentValueHit } from "./page-index-document-selection";
import { buildPageIndexNodeValues } from "./page-index-node-values";

describe("buildPageIndexNodeValues", () => {
  it("maps dense hits to the deepest matching outline node and propagates peak value with max", () => {
    const result = buildPageIndexNodeValues({
      hits: [
        hit("dense-invoice", 0.9, ["Finance", "Invoice"], 120, 180),
        hit("dense-finance", 0.6, ["Finance"], 10, 90),
      ],
      maxHitsPerNode: 4,
      outline: fixtureOutline(),
    });

    expect(result.assignments.map((entry) => [entry.candidateNodeId, entry.outlineNodeId])).toEqual(
      [
        ["dense-finance", "finance"],
        ["dense-invoice", "invoice"],
      ],
    );
    expect(result.valuesByNodeId.get("invoice")?.peakValue).toBe(0.9);
    expect(result.valuesByNodeId.get("finance")?.peakValue).toBe(0.9);
    expect(result.valuesByNodeId.get("root")?.peakValue).toBe(0.9);
  });

  it("uses max rather than descendant sum for ancestor priors", () => {
    const result = buildPageIndexNodeValues({
      hits: [
        hit("dense-invoice", 0.8, ["Finance", "Invoice"], 120, 180),
        hit("dense-tax", 0.8, ["Finance", "Tax"], 220, 280),
      ],
      maxHitsPerNode: 4,
      outline: fixtureOutline(),
    });

    expect(result.valuesByNodeId.get("root")?.peakValue).toBe(0.8);
    expect(result.valuesByNodeId.get("root")?.breadthValue).toBe(
      Math.max(
        result.valuesByNodeId.get("invoice")?.breadthValue ?? 0,
        result.valuesByNodeId.get("tax")?.breadthValue ?? 0,
      ),
    );
  });

  it("caps per-node hits, ignores unrelated hits, and ranks openable nodes deterministically", () => {
    const result = buildPageIndexNodeValues({
      hits: [
        hit("dense-3", 0.7, ["Finance", "Invoice"], 120, 180),
        hit("dense-2", 0.9, ["Finance", "Invoice"], 120, 180),
        hit("dense-1", 0.9, ["Finance", "Invoice"], 120, 180),
        hit("unrelated", 1, ["Legal"], undefined, undefined),
      ],
      maxHitsPerNode: 2,
      outline: fixtureOutline(),
    });

    expect(result.assignments.map((entry) => entry.candidateNodeId)).toEqual([
      "dense-1",
      "dense-2",
    ]);
    expect(result.unassignedHitCount).toBe(1);
    expect(result.rankedOpenableNodeIds[0]).toBe("invoice");
  });

  it("rejects invalid limits and normalized hit scores", () => {
    expect(() =>
      buildPageIndexNodeValues({ hits: [], maxHitsPerNode: 0, outline: fixtureOutline() }),
    ).toThrow("maxHitsPerNode must be a positive integer");
    expect(() =>
      buildPageIndexNodeValues({ hits: [], maxHitsPerNode: 0.5, outline: fixtureOutline() }),
    ).toThrow("maxHitsPerNode must be a positive integer");
    expect(() =>
      buildPageIndexNodeValues({
        hits: [hit("negative", -0.1, ["Finance"])],
        maxHitsPerNode: 1,
        outline: fixtureOutline(),
      }),
    ).toThrow("normalized hit scores must be within [0, 1]");
    expect(() =>
      buildPageIndexNodeValues({
        hits: [hit("nan", Number.NaN, ["Finance"])],
        maxHitsPerNode: 1,
        outline: fixtureOutline(),
      }),
    ).toThrow("normalized hit scores must be within [0, 1]");
  });

  it("counts hits from another document separately from same-document misses", () => {
    const foreign = hit("foreign", 0.8, ["Finance", "Invoice"], 120, 180);
    const result = buildPageIndexNodeValues({
      hits: [
        {
          ...foreign,
          candidate: {
            ...foreign.candidate,
            citation: {
              ...foreign.candidate.citation,
              documentAssetId: "10000000-0000-4000-8000-000000000099",
            },
          },
        },
        hit("no-match", 0.7, ["Legal"], undefined, undefined),
      ],
      maxHitsPerNode: 2,
      outline: fixtureOutline(),
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassignedHitCount).toBe(2);
  });

  it("prefers source identity and keeps the best deterministic duplicate projection", () => {
    const rawOutline = JSON.parse(JSON.stringify(fixtureOutline())) as {
      nodes: Array<{ children: Array<{ children: Array<{ sourceNodeIds: string[] }> }> }>;
    };
    const invoice = rawOutline.nodes[0]?.children[0]?.children[0];
    if (!invoice) throw new Error("missing invoice fixture");
    invoice.sourceNodeIds = ["shared-source"];
    const outline = DocumentOutlineSchema.parse(rawOutline);
    const first = hit("shared-source", 0.6, ["Elsewhere"], undefined, undefined);
    const stronger = {
      ...first,
      candidate: { ...first.candidate, projectionId: "projection-z" },
      normalizedScore: 0.9,
    };
    const equalEarlierProjection = {
      ...stronger,
      candidate: { ...stronger.candidate, projectionId: "projection-a" },
    };
    const weaker = {
      ...first,
      candidate: { ...first.candidate, projectionId: "projection-weak" },
      normalizedScore: 0.4,
    };
    const result = buildPageIndexNodeValues({
      hits: [first, stronger, equalEarlierProjection, weaker],
      maxHitsPerNode: 4,
      outline,
    });

    expect(result.assignments).toEqual([
      expect.objectContaining({
        candidateNodeId: "shared-source",
        normalizedScore: 0.9,
        outlineNodeId: "invoice",
        projectionId: "projection-a",
      }),
    ]);
  });

  it("matches normalized paths and overlapping ranges while excluding non-openable headings", () => {
    const rawOutline = JSON.parse(JSON.stringify(fixtureOutline())) as {
      nodes: Array<{
        children: Array<{
          children: Array<{
            endOffset?: number;
            sectionPath: string[];
            startOffset?: number;
          }>;
        }>;
      }>;
    };
    const invoice = rawOutline.nodes[0]?.children[0]?.children[0];
    const tax = rawOutline.nodes[0]?.children[0]?.children[1];
    if (!invoice || !tax) throw new Error("missing leaf fixtures");
    invoice.sectionPath = [" Finance ", " INVOICE "];
    Reflect.deleteProperty(tax, "startOffset");
    Reflect.deleteProperty(tax, "endOffset");
    const outline = DocumentOutlineSchema.parse(rawOutline);
    const result = buildPageIndexNodeValues({
      hits: [
        hit("path", 0.9, ["finance", "invoice"], undefined, undefined),
        hit("range", 0.8, ["Other"], 150, 170),
        hit("tax-heading", 0.7, ["Finance", "Tax"], undefined, undefined),
      ],
      maxHitsPerNode: 3,
      outline,
    });

    expect(result.assignments.map((entry) => entry.outlineNodeId)).toEqual([
      "invoice",
      "invoice",
      "tax",
    ]);
    expect(result.rankedOpenableNodeIds).not.toContain("tax");
  });
});

function hit(
  nodeId: string,
  normalizedScore: number,
  sectionPath: readonly string[],
  startOffset?: number,
  endOffset?: number,
): PageIndexDocumentValueHit {
  return {
    candidate: {
      citation: {
        artifactHash: "a".repeat(64),
        documentAssetId: "10000000-0000-4000-8000-000000000001",
        documentVersion: 1,
        ...(endOffset === undefined ? {} : { endOffset }),
        sectionPath: [...sectionPath],
        ...(startOffset === undefined ? {} : { startOffset }),
      },
      metadata: { text: nodeId },
      nodeId,
      permissionScope: ["document:read"],
      projectionId: `projection-${nodeId}`,
      score: normalizedScore,
      source: "dense",
    },
    normalizedScore,
  };
}

function fixtureOutline() {
  const leaf = (id: string, title: string, startOffset: number, endOffset: number) => ({
    childNodeIds: [],
    children: [],
    endOffset,
    id,
    level: 3,
    metadata: {},
    sectionPath: ["Finance", title],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset,
    summary: `${title} summary`,
    title,
    tocSource: "parser-heading",
  });
  const invoice = leaf("invoice", "Invoice", 100, 200);
  const tax = leaf("tax", "Tax", 200, 300);
  const finance = {
    childNodeIds: ["invoice", "tax"],
    children: [invoice, tax],
    endOffset: 300,
    id: "finance",
    level: 2,
    metadata: {},
    sectionPath: ["Finance"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 0,
    summary: "Finance summary",
    title: "Finance",
    tocSource: "parser-heading",
  };
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId: "10000000-0000-4000-8000-000000000001",
    id: "20000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "30000000-0000-4000-8000-000000000001",
    metadata: {},
    nodes: [
      {
        childNodeIds: ["finance"],
        children: [finance],
        endOffset: 300,
        id: "root",
        level: 1,
        metadata: {},
        sectionPath: ["Document"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Document summary",
        title: "Document",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    version: 1,
  });
}
