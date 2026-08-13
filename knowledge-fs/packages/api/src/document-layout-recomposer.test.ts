import { type ParseArtifact, ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { recomposeDocumentLayoutForSemanticSegmentation } from "./document-layout-recomposer";

describe("document layout recomposition for semantic segmentation", () => {
  it("removes unproven PDF title boundaries while preserving every source element", () => {
    const input = artifact({
      elements: [
        element("title", "电子发票（普通发票）", ["电子发票（普通发票）"], "title-1"),
        element("paragraph", "发票号码：26322000000000000000", ["电子发票（普通发票）"], "p-1"),
        element(
          "title",
          "名称：示例人工智能有限公司",
          ["名称：示例人工智能有限公司"],
          "false-title-1",
        ),
        element(
          "paragraph",
          "统一社会信用代码：91320506EXAMPLE01",
          ["名称：示例人工智能有限公司"],
          "p-2",
        ),
        element("title", "91320506EXAMPLE02", ["91320506EXAMPLE02"], "false-title-2"),
        element("table", "餐饮服务 | 1 | 533.96 | 6% | 32.04", ["91320506EXAMPLE02"], "table-1"),
        element("paragraph", "合计：566.00", ["91320506EXAMPLE02"], "p-3"),
      ],
      parser: "unstructured",
    });

    const result = recomposeDocumentLayoutForSemanticSegmentation(input);

    expect(result.artifact.elements.map(({ id, text, type }) => ({ id, text, type }))).toEqual(
      input.elements.map(({ id, text, type }) => ({ id, text, type })),
    );
    expect(result.artifact.elements.map((item) => item.sectionPath)).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(result.artifact.elements[2]?.metadata.layoutRecomposition).toEqual({
      boundaryPolicy: "reasoning-model",
      originalSectionPath: ["名称：示例人工智能有限公司"],
      originalType: "title",
      reason: "unstructured-heading-without-hierarchy-evidence",
      schemaVersion: 1,
    });
    expect(result.stats).toEqual({
      elementsRecomposed: 7,
      modelDecidedHeadingBoundaries: 3,
      trustedHeadingBoundaries: 0,
    });
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("preserves explicit Unstructured heading hierarchy and applies it to following content", () => {
    const input = artifact({
      elements: [
        element("title", "第一章", ["第一章"], "chapter", { category_depth: 0 }),
        element("heading", "范围", ["第一章", "范围"], "section", {
          category_depth: 1,
          parent_id: "chapter",
        }),
        element("paragraph", "适用范围正文。", ["第一章", "范围"], "paragraph"),
      ],
      parser: "unstructured",
    });

    const result = recomposeDocumentLayoutForSemanticSegmentation(input);

    expect(result.artifact.elements.map((item) => item.sectionPath)).toEqual([
      ["第一章"],
      ["第一章", "范围"],
      ["第一章", "范围"],
    ]);
    expect(result.stats).toEqual({
      elementsRecomposed: 3,
      modelDecidedHeadingBoundaries: 0,
      trustedHeadingBoundaries: 2,
    });
  });

  it("leaves native parser section boundaries unchanged", () => {
    const input = artifact({
      elements: [
        element("heading", "安装", ["安装"], "heading"),
        element("paragraph", "安装正文。", ["安装"], "paragraph"),
      ],
      parser: "native-markdown",
    });

    const result = recomposeDocumentLayoutForSemanticSegmentation(input);

    expect(result.artifact).toEqual(input);
    expect(result.stats).toEqual({
      elementsRecomposed: 0,
      modelDecidedHeadingBoundaries: 0,
      trustedHeadingBoundaries: 0,
    });
  });

  it("rejects artifacts that exceed the bounded element count", () => {
    const input = artifact({
      elements: [element("paragraph", "一", [], "one"), element("paragraph", "二", [], "two")],
      parser: "unstructured",
    });

    expect(() => recomposeDocumentLayoutForSemanticSegmentation(input, { maxElements: 1 })).toThrow(
      "Document layout recomposition exceeds maxElements=1",
    );
    expect(() => recomposeDocumentLayoutForSemanticSegmentation(input, { maxElements: 0 })).toThrow(
      "maxElements must be at least 1",
    );
  });

  it("trusts a non-empty parent id even when category depth is absent", () => {
    const input = artifact({
      elements: [
        element("heading", "子章节", ["父章节", "子章节"], "child", {
          parent_id: "parent",
        }),
        element("paragraph", "正文", ["父章节", "子章节"], "body"),
      ],
      parser: "unstructured",
    });

    const result = recomposeDocumentLayoutForSemanticSegmentation(input, { maxElements: 2 });
    expect(result.stats.trustedHeadingBoundaries).toBe(1);
    expect(result.artifact.elements[1]?.sectionPath).toEqual(["父章节", "子章节"]);
  });
});

function artifact({
  elements,
  parser,
}: {
  readonly elements: ParseArtifact["elements"];
  readonly parser: ParseArtifact["parser"];
}): ParseArtifact {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-08-13T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    elements,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    metadata: { parserVersion: `${parser}@test` },
    parser,
    version: 1,
  });
}

function element(
  type: ParseArtifact["elements"][number]["type"],
  text: string,
  sectionPath: readonly string[],
  id: string,
  metadata: Record<string, unknown> = {},
): ParseArtifact["elements"][number] {
  return {
    id,
    metadata,
    pageNumber: 1,
    sectionPath: [...sectionPath],
    text,
    type,
  };
}
