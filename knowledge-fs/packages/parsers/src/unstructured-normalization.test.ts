import { afterEach, describe, expect, it, vi } from "vitest";

import { createUnstructuredParserClient } from "./index";

vi.mock("./unstructured-normalization-policy", () => ({
  maxUnstructuredSectionDepth: 4,
  maxUnstructuredSectionPathItems: 16,
  maxUnstructuredVerticalCandidateComparisons: 8,
}));

const input = {
  body: new TextEncoder().encode("%PDF-1.4\n"),
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename: "layout.pdf",
  mimeType: "application/pdf",
  version: 1,
};

function parserFor(elements: readonly unknown[]) {
  return createUnstructuredParserClient({
    endpoint: "http://parser.invalid",
    fetch: async () => Response.json(elements),
  });
}

function titleChain(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    element_id: `title-${index}`,
    metadata: index === 0 ? {} : { parent_id: `title-${index - 1}` },
    text: `Heading ${index + 1}`,
    type: "Title",
  }));
}

function glyph(index: number, x: number, y: number, pageNumber = 1) {
  return {
    element_id: `glyph-${index}`,
    metadata: {
      coordinates: {
        layout_height: 10000,
        layout_width: 1000,
        points: [
          [x, y],
          [x, y + 10],
          [x + 10, y + 10],
          [x + 10, y],
        ],
        system: "PixelSpace",
      },
      page_number: pageNumber,
    },
    text: "中",
    type: "UncategorizedText",
  };
}

describe("bounded Unstructured normalization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an over-deep provider parent chain before expanding its paths", async () => {
    await expect(parserFor(titleChain(5)).parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      message: expect.stringContaining("maxSectionDepth=4"),
    });
  });

  it("applies the same depth limit to category-depth headings", async () => {
    const elements = titleChain(5).map((element, index) => ({
      ...element,
      metadata: { category_depth: index },
    }));
    await expect(parserFor(elements).parse(input)).rejects.toThrow("maxSectionDepth=4");
  });

  it("rejects excessive cumulative section-path expansion across paragraphs", async () => {
    const elements = [
      ...titleChain(4),
      { metadata: {}, text: "First body", type: "NarrativeText" },
      { metadata: {}, text: "Second body", type: "NarrativeText" },
    ];
    await expect(parserFor(elements).parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      message: expect.stringContaining("maxSectionPathItems=16"),
    });
  });

  it("preserves admitted hierarchical paths and sibling headings", async () => {
    const artifact = await parserFor([
      ...titleChain(3),
      { metadata: {}, text: "Body", type: "NarrativeText" },
      {
        element_id: "sibling",
        metadata: { parent_id: "title-0" },
        text: "Sibling",
        type: "Title",
      },
    ]).parse(input);
    expect(artifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Heading 1"],
      ["Heading 1", "Heading 2"],
      ["Heading 1", "Heading 2", "Heading 3"],
      ["Heading 1", "Heading 2", "Heading 3"],
      ["Heading 1", "Sibling"],
    ]);
  });

  it("rejects pathological dense layout when its comparison budget is exhausted", async () => {
    const elements = Array.from({ length: 6 }, (_, index) => glyph(index, 10, 10));
    await expect(parserFor(elements).parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      message: expect.stringContaining("maxVerticalCandidateComparisons=8"),
    });
  });

  it("does not charge unrelated pages against the local candidate budget", async () => {
    const elements = Array.from({ length: 100 }, (_, index) => glyph(index, 10, 10, index + 1));
    const artifact = await parserFor(elements).parse(input);
    expect(artifact.elements).toHaveLength(100);
    expect(artifact.elements.map((element) => element.pageNumber)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });

  it("does not compare spatially distant glyphs on the same page", async () => {
    const elements = Array.from({ length: 50 }, (_, index) => glyph(index, 10, index * 100));
    const artifact = await parserFor(elements).parse(input);
    expect(artifact.elements).toHaveLength(50);
  });

  it("merges a bounded vertical line in reading order", async () => {
    const artifact = await parserFor([
      { ...glyph(0, 10, 10), text: "中" },
      { ...glyph(1, 10, 21), text: "国" },
      { ...glyph(2, 10, 32), text: "人" },
    ]).parse(input);
    expect(artifact.elements).toHaveLength(1);
    expect(artifact.elements[0]?.text).toBe("中国人");
    expect(artifact.elements[0]?.metadata.layout_normalization).toEqual({
      operation: "merge_vertical_text",
      source_element_count: 3,
    });
  });

  it("preserves the original leftmost tie-break across candidate buckets", async () => {
    const artifact = await parserFor([
      { ...glyph(0, 10, 10), text: "中" },
      { ...glyph(1, 13, 21), text: "日" },
      { ...glyph(2, 11, 22), text: "月" },
    ]).parse(input);
    expect(artifact.elements.map((element) => element.text)).toEqual(["中月", "日"]);
  });

  it("does not merge glyphs from incompatible coordinate systems", async () => {
    const lower = glyph(1, 10, 21);
    const artifact = await parserFor([
      glyph(0, 10, 10),
      {
        ...lower,
        metadata: {
          ...lower.metadata,
          coordinates: { ...lower.metadata.coordinates, system: "PointSpace" },
        },
      },
    ]).parse(input);
    expect(artifact.elements).toHaveLength(2);
  });

  it("rejects finite points whose inferred geometry overflows", async () => {
    const element = glyph(0, 0, 0);
    const parser = parserFor([
      {
        ...element,
        metadata: {
          ...element.metadata,
          coordinates: {
            ...element.metadata.coordinates,
            points: [
              [-1e308, 0],
              [1e308, 10],
            ],
          },
        },
      },
    ]);
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      message: "Unstructured parser returned invalid glyph geometry",
    });
  });

  it("recognizes a monotonic deadline overrun even before timers can run", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const parser = createUnstructuredParserClient({
      endpoint: "http://parser.invalid",
      fetch: async () => {
        clock.mockReturnValue(101);
        return Response.json([{ metadata: {}, text: "Body", type: "NarrativeText" }]);
      },
      requestTimeoutMs: 100,
    });
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_timeout",
      retryable: false,
    });
  });

  it("accepts a response strictly within the monotonic deadline", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const parser = createUnstructuredParserClient({
      endpoint: "http://parser.invalid",
      fetch: async () => {
        clock.mockReturnValue(1099);
        return Response.json([{ metadata: {}, text: "Body", type: "NarrativeText" }]);
      },
      requestTimeoutMs: 100,
    });
    const artifact = await parser.parse(input);
    expect(artifact.elements[0]?.text).toBe("Body");
  });
});
