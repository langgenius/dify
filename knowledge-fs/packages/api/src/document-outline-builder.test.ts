import { describe, expect, it } from "vitest";

import type { ParseArtifact, ParseElement } from "@knowledge/core";

import { createDocumentOutlineBuilder } from "./document-outline-builder";
import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";

const createdAt = "2026-06-18T00:00:00.000Z";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const sha256 = "a".repeat(64);

describe("document outline builder", () => {
  it("builds a nested outline from parser section paths and page numbers", () => {
    const builder = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      ]),
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 120,
      now: () => createdAt,
    });

    const outline = builder.build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "element-1",
          pageNumber: 1,
          sectionPath: ["Overview"],
          text: "Overview",
          type: "heading",
        },
        {
          id: "element-2",
          pageNumber: 1,
          sectionPath: ["Overview"],
          text: "KnowledgeFS compiles documents into agent-readable evidence.",
          type: "paragraph",
        },
        {
          id: "element-3",
          pageNumber: 2,
          sectionPath: ["Overview", "Retrieval"],
          text: "Retrieval",
          type: "heading",
        },
        {
          id: "element-4",
          pageNumber: 2,
          sectionPath: ["Overview", "Retrieval"],
          text: "Fast and deep modes keep dense, full-text, and graph retrieval.",
          type: "paragraph",
        },
        {
          id: "element-5",
          pageNumber: 5,
          sectionPath: ["Research"],
          text: "Research",
          type: "heading",
        },
      ]),
    });

    expect(outline.id).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2c53");
    expect(outline.metadata).toMatchObject({
      builder: "deterministic-parse-artifact",
      parser: "native-markdown",
      quality: {
        fallbackNodeCount: 0,
        headingCoverageRatio: 1,
        largeSectionCandidates: [],
        nodeCount: 3,
        offsetRangeValid: true,
        pageRangeValid: true,
        titleLocationCoverageRatio: 1,
        warnings: [],
      },
      sourceElementCount: 5,
    });
    expect(outline.nodes.map((node) => node.title)).toEqual(["Overview", "Research"]);
    expect(outline.nodes[0]?.childNodeIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"]);
    expect(outline.nodes[0]?.children[0]?.sectionPath).toEqual(["Overview", "Retrieval"]);
    expect(outline.nodes[0]?.startPage).toBe(1);
    expect(outline.nodes[0]?.endPage).toBe(2);
    expect(outline.nodes[0]?.titleLocation).toMatchObject({
      matchedText: "Overview",
      pageNumber: 1,
      source: "parser-heading",
    });
    expect(outline.nodes[0]?.summary).toContain("agent-readable evidence");
    expect(outline.nodes[0]?.children[0]?.summary).toContain("dense, full-text, and graph");
  });

  it("falls back to a document node when parse output has no heading structure", () => {
    const builder = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      ]),
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 80,
      now: () => createdAt,
    });

    const outline = builder.build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "element-1",
          pageNumber: 3,
          text: "A paragraph without headings still needs a browseable outline.",
          type: "paragraph",
        },
      ]),
    });

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({
      endPage: 3,
      sectionPath: ["Document"],
      startPage: 3,
      title: "Document",
      tocSource: "fallback",
    });
    expect(outline.metadata.quality).toMatchObject({
      fallbackNodeCount: 1,
      headingCoverageRatio: 0,
      titleLocationCoverageRatio: 0,
      warnings: ["outline-derived-from-fallback", "some-title-locations-missing"],
    });
  });

  it("uses the same normalized UTF-8 byte coordinates as artifact segments and chunking", () => {
    const builder = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      ]),
      largeSectionChars: 5,
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 80,
      now: () => createdAt,
    });
    const outline = builder.build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "heading",
          sectionPath: ["指南"],
          text: " \u3000标题🚀 \n",
          type: "heading",
        },
        {
          id: "empty",
          sectionPath: ["指南"],
          text: " \u3000\t",
          type: "paragraph",
        },
        {
          id: "body",
          sectionPath: ["指南"],
          text: "\t内容🙂  ",
          type: "paragraph",
        },
      ]),
    });

    expect(outline.metadata).toMatchObject({
      elementSeparator: "\n",
      offsetEncoding: "utf-8-bytes",
      textNormalization: "unicode-whitespace-trim",
    });
    expect(outline.nodes[0]).toMatchObject({
      endOffset: 21,
      metadata: { canonicalCharacterCount: 6 },
      startOffset: 0,
      summary: "内容🙂",
      titleLocation: {
        endOffset: 10,
        matchedText: "标题🚀",
        startOffset: 0,
      },
    });
    expect(outline.metadata.quality).toMatchObject({
      largeSectionCandidates: [expect.objectContaining({ estimatedChars: 6 })],
    });
  });

  it("marks large sections as recursive subdivision candidates", () => {
    const builder = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      ]),
      largeSectionChars: 20,
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 80,
      now: () => createdAt,
    });

    const outline = builder.build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "element-1",
          sectionPath: ["Long Section"],
          text: "Long Section",
          type: "heading",
        },
        {
          id: "element-2",
          sectionPath: ["Long Section"],
          text: "This section has enough characters to need recursive subdivision.",
          type: "paragraph",
        },
      ]),
    });

    expect(outline.metadata.quality).toMatchObject({
      largeSectionCandidates: [
        expect.objectContaining({
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
          sectionPath: ["Long Section"],
          title: "Long Section",
        }),
      ],
      warnings: ["large-sections-need-recursive-subdivision"],
    });
    expect(() =>
      createDocumentOutlineBuilder({
        largeSectionChars: 0,
        maxElements: 20,
        maxNodes: 10,
        maxSummaryChars: 80,
      }),
    ).toThrow("Document outline largeSectionChars must be at least 1");
  });

  it("uses generation-scoped deterministic physical ids for candidate outlines", () => {
    const builder = createDocumentOutlineBuilder({
      generateId: () => {
        throw new Error("candidate outline must not use random ids");
      },
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 80,
      now: () => createdAt,
    });
    const artifact = parseArtifact([
      {
        id: "element-1",
        sectionPath: ["Overview"],
        text: "Overview",
        type: "heading",
      },
    ]);
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61";
    const first = builder.build({
      knowledgeSpaceId,
      parseArtifact: artifact,
      publicationGenerationId: firstGeneration,
    });
    const retried = builder.build({
      knowledgeSpaceId,
      parseArtifact: artifact,
      publicationGenerationId: firstGeneration,
    });
    const second = builder.build({
      knowledgeSpaceId,
      parseArtifact: artifact,
      publicationGenerationId: secondGeneration,
    });
    const otherDocument = builder.build({
      knowledgeSpaceId,
      parseArtifact: {
        ...artifact,
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c70",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c71",
      },
      publicationGenerationId: firstGeneration,
    });

    expect(first.publicationGenerationId).toBe(firstGeneration);
    expect(retried.id).toBe(first.id);
    expect(retried.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.id).not.toBe(first.id);
    expect(second.nodes[0]?.id).not.toBe(first.nodes[0]?.id);
    expect(otherDocument.id).not.toBe(first.id);
    expect(otherDocument.nodes[0]?.id).not.toBe(first.nodes[0]?.id);
    expect(() =>
      builder.build({
        knowledgeSpaceId,
        parseArtifact: artifact,
        publicationGenerationId: "",
      }),
    ).toThrow();
  });
});

describe("document outline repository", () => {
  it("stores defensive clones by document version", async () => {
    const builder = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      ]),
      maxElements: 20,
      maxNodes: 10,
      maxSummaryChars: 80,
      now: () => createdAt,
    });
    const repository = createInMemoryDocumentOutlineRepository({ maxOutlines: 2 });
    const outline = builder.build({
      knowledgeSpaceId,
      parseArtifact: parseArtifact([
        {
          id: "element-1",
          sectionPath: ["Overview"],
          text: "Overview",
          type: "heading",
        },
      ]),
    });

    const created = await repository.create(outline);
    (created.nodes[0]?.sourceElementIds as string[] | undefined)?.push("mutated");

    await expect(
      repository.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toMatchObject({
      id: outline.id,
      nodes: [{ sourceElementIds: ["element-1"] }],
    });
    await expect(repository.getById({ id: outline.id })).resolves.toMatchObject({
      documentAssetId,
      version: 1,
    });
  });
});

function parseArtifact(
  elements: readonly (Omit<ParseElement, "metadata" | "sectionPath"> &
    Partial<Pick<ParseElement, "metadata" | "sectionPath">>)[],
): ParseArtifact {
  return {
    artifactHash: sha256,
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

function sequenceIds(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("No test id left");
    }

    index += 1;
    return id;
  };
}
