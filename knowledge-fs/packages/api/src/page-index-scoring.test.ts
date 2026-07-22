import type { DocumentOutlineNode } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  PageIndexMaxQueryTerms,
  PageIndexQueryComplexityExceededError,
  PageIndexScoreVersion,
  pageIndexQueryTerms,
  scorePageIndexOutlineNode,
} from "./page-index-scoring";

describe("PageIndex normalized scoring", () => {
  it("scores title, Summary, and section coverage on a [0, 1] domain", () => {
    const terms = pageIndexQueryTerms("camera warranty sensor");

    expect(scorePageIndexOutlineNode(node({ title: "Camera warranty" }), terms)).toMatchObject({
      score: 2 / 3,
      titleCoverage: 2 / 3,
      version: PageIndexScoreVersion,
    });
    expect(
      scorePageIndexOutlineNode(node({ summary: "Camera warranty and sensor policy" }), terms),
    ).toMatchObject({ score: 0.9, summaryCoverage: 1 });
    expect(
      scorePageIndexOutlineNode(node({ sectionPath: ["Camera", "Warranty", "Sensor"] }), terms),
    ).toMatchObject({ score: 0.8, sectionCoverage: 1 });
  });

  it("deduplicates words and expands CJK runs into searchable code points", () => {
    expect(pageIndexQueryTerms("Warranty warranty a")).toEqual(["warranty", "a"]);
    expect(pageIndexQueryTerms("相机保修")).toEqual(["相", "机", "保", "修"]);

    expect(
      scorePageIndexOutlineNode(
        node({ summary: "相机产品的保修说明" }),
        pageIndexQueryTerms("相机保修"),
      ).score,
    ).toBe(0.9);
  });

  it("uses one NFKC tokenizer symmetrically across mixed scripts", () => {
    expect(pageIndexQueryTerms("ＡＢＣ中文2026")).toEqual(["abc", "中", "文", "2026"]);
    expect(
      scorePageIndexOutlineNode(
        node({ title: "abc中文2026" }),
        pageIndexQueryTerms("ＡＢＣ 中文 2026"),
      ).score,
    ).toBe(1);
  });

  it("supports meaningful single-character terms and does not use substring matches", () => {
    expect(scorePageIndexOutlineNode(node({ title: "C API reference" }), ["c"]).score).toBe(1);
    expect(scorePageIndexOutlineNode(node({ title: "concatenate strings" }), ["cat"]).score).toBe(
      0,
    );
  });

  it("returns zero for empty or punctuation-only queries", () => {
    const score = scorePageIndexOutlineNode(node({}), pageIndexQueryTerms(" ... "));

    expect(score).toMatchObject({ matchedTerms: [], queryTermCount: 0, score: 0 });
  });

  it("rejects adversarial queries before their term set can multiply every Outline scan", () => {
    const manyCjkTerms = Array.from({ length: PageIndexMaxQueryTerms + 1 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    ).join("");

    expect(() => pageIndexQueryTerms(manyCjkTerms)).toThrow(PageIndexQueryComplexityExceededError);
    expect(() => pageIndexQueryTerms("x".repeat(129))).toThrow(
      PageIndexQueryComplexityExceededError,
    );
    expect(() => pageIndexQueryTerms("𐐀".repeat(100))).toThrow(
      PageIndexQueryComplexityExceededError,
    );
  });
});

function node(overrides: Partial<DocumentOutlineNode>): DocumentOutlineNode {
  return {
    childNodeIds: [],
    children: [],
    id: "outline-node-1",
    level: 1,
    metadata: {},
    sectionPath: ["General"],
    sourceElementIds: [],
    sourceNodeIds: [],
    title: "General",
    tocSource: "parser-heading",
    ...overrides,
  };
}
