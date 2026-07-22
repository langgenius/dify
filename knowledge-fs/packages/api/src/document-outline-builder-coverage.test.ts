import type { ParseArtifact, ParseElement } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDocumentOutlineBuilder } from "./document-outline-builder";

const createdAt = "2026-06-18T00:00:00.000Z";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

function parseArtifact(
  elements: readonly (Omit<ParseElement, "metadata" | "sectionPath"> &
    Partial<Pick<ParseElement, "metadata" | "sectionPath">>)[],
): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt,
    documentAssetId,
    elements: elements.map((element) => ({
      ...element,
      metadata: element.metadata ?? {},
      sectionPath: element.sectionPath ?? [],
    })),
    id: parseArtifactId,
    metadata: { parserVersion: "native-markdown@1" },
    parser: "native-markdown",
    version: 1,
  };
}

function builder(
  overrides: Partial<Parameters<typeof createDocumentOutlineBuilder>[0]> = {},
): ReturnType<typeof createDocumentOutlineBuilder> {
  return createDocumentOutlineBuilder({
    maxElements: 20,
    maxNodes: 10,
    maxSummaryChars: 200,
    now: () => createdAt,
    ...overrides,
  });
}

describe("document outline builder coverage", () => {
  it("validates builder options", () => {
    expect(() => builder({ maxElements: 0 })).toThrow(
      "Document outline maxElements must be at least 1",
    );
    expect(() => builder({ maxNodes: 0 })).toThrow("Document outline maxNodes must be at least 1");
    expect(() => builder({ maxSummaryChars: 0 })).toThrow(
      "Document outline maxSummaryChars must be at least 1",
    );
  });

  it("requires a knowledge space id", () => {
    expect(() =>
      builder().build({
        knowledgeSpaceId: "   ",
        parseArtifact: parseArtifact([{ id: "element-1", text: "Body", type: "paragraph" }]),
      }),
    ).toThrow("Document outline knowledgeSpaceId is required");
  });

  it("enforces the element and node limits", () => {
    const twoSections = parseArtifact([
      { id: "element-1", sectionPath: ["A"], text: "Alpha", type: "paragraph" },
      { id: "element-2", sectionPath: ["B"], text: "Beta", type: "paragraph" },
    ]);

    expect(() =>
      builder({ maxElements: 1 }).build({ knowledgeSpaceId, parseArtifact: twoSections }),
    ).toThrow("Document outline element count exceeds maxElements=1");
    expect(() =>
      builder({ maxNodes: 1 }).build({ knowledgeSpaceId, parseArtifact: twoSections }),
    ).toThrow("Document outline node count exceeds maxNodes=1");
  });

  it("builds an offsetless fallback outline when no element has text", () => {
    const outline = builder().build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        { id: "element-1", pageNumber: 1, type: "page-break" },
        { id: "element-2", text: "   ", type: "paragraph" },
      ]),
    });

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({
      sectionPath: ["Document"],
      summary: "Document",
      title: "Document",
      tocSource: "fallback",
    });
    expect(outline.nodes[0]).not.toHaveProperty("startOffset");
    expect(outline.nodes[0]).not.toHaveProperty("endOffset");
    expect(outline.nodes[0]).not.toHaveProperty("startPage");
    expect(outline.nodes[0]).not.toHaveProperty("endPage");
    expect(outline.nodes[0]).not.toHaveProperty("titleLocation");
    expect(outline.metadata.quality).toMatchObject({
      fallbackNodeCount: 1,
      largeSectionCandidates: [],
      nodeCount: 1,
      offsetRangeValid: true,
      pageRangeValid: true,
    });
  });

  it("derives section paths from headings and titles without parser paths", () => {
    const outline = builder().build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        { id: "element-1", text: "My Heading", type: "heading" },
        { id: "element-2", text: "Doc Title", type: "title" },
      ]),
    });

    expect(outline.nodes.map((node) => node.title)).toEqual(["My Heading", "Doc Title"]);
    expect(outline.nodes[0]?.tocSource).toBe("parser-heading");
    expect(outline.nodes[0]?.titleLocation).toMatchObject({
      matchedText: "My Heading",
      source: "parser-heading",
    });
    expect(outline.nodes[0]?.titleLocation).not.toHaveProperty("pageNumber");
  });

  it("creates fallback intermediate nodes that inherit ranges from children", () => {
    const outline = builder().build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "element-1",
          pageNumber: 2,
          sectionPath: ["A", "B"],
          text: "Deep Heading",
          type: "heading",
        },
      ]),
    });

    const root = outline.nodes[0];
    expect(root).toMatchObject({
      level: 1,
      sectionPath: ["A"],
      title: "A",
      tocSource: "fallback",
    });
    const child = root?.children[0];
    expect(child).toMatchObject({
      level: 2,
      sectionPath: ["A", "B"],
      title: "B",
      tocSource: "parser-heading",
    });
    // The intermediate node has no spans of its own; ranges come from the child.
    expect(root?.startOffset).toBe(child?.startOffset);
    expect(root?.endOffset).toBe(child?.endOffset);
    expect(root?.startPage).toBe(2);
    expect(root?.endPage).toBe(2);
    // Own summary text is empty, so the parent summarizes through its child.
    expect(root?.summary).toBe("B");
  });

  it("attaches the first heading as the title of a content-created section", () => {
    const outline = builder().build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        { id: "element-1", sectionPath: ["Intro"], text: "Body text first", type: "paragraph" },
        {
          id: "element-2",
          pageNumber: 4,
          sectionPath: ["Intro"],
          text: "Intro",
          type: "heading",
        },
        { id: "element-3", sectionPath: ["Intro"], text: "Second heading", type: "heading" },
        { id: "element-4", sectionPath: ["Other"], text: "Other body", type: "paragraph" },
        { id: "element-5", sectionPath: ["Other"], text: "Other", type: "heading" },
      ]),
    });

    expect(outline.nodes).toHaveLength(2);
    expect(outline.nodes[0]?.titleLocation).toMatchObject({
      matchedText: "Intro",
      pageNumber: 4,
      source: "parser-heading",
    });
    // A heading without a page number still becomes the title location.
    expect(outline.nodes[1]?.titleLocation).toMatchObject({
      matchedText: "Other",
      source: "parser-heading",
    });
    expect(outline.nodes[1]?.titleLocation).not.toHaveProperty("pageNumber");
  });

  it("truncates summaries against small character budgets", () => {
    const artifactWithLongText = parseArtifact([
      {
        id: "element-1",
        sectionPath: ["Long"],
        text: "abcdefghijklmnopqrstuvwxyz",
        type: "paragraph",
      },
    ]);

    const truncated = builder({ maxSummaryChars: 10 }).build({
      knowledgeSpaceId,
      parseArtifact: artifactWithLongText,
    });
    expect(truncated.nodes[0]?.summary).toBe("abcdefg...");

    const tiny = builder({ maxSummaryChars: 2 }).build({
      knowledgeSpaceId,
      parseArtifact: artifactWithLongText,
    });
    expect(tiny.nodes[0]?.summary).toBe("ab");
  });
});
