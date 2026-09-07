import { describe, expect, it } from "vitest";

import { createUnstructuredGlyphIndex } from "./unstructured-glyph-index";

function glyph(index: number, x: number, y: number, width = 10, height = 10, pageNumber = 1) {
  return { box: { bottom: y + height, height, width, x, y }, index, pageNumber };
}

describe("page-local glyph candidate index", () => {
  it("keeps a long sparse page local instead of scanning every glyph", () => {
    const glyphs = Array.from({ length: 1000 }, (_, index) => glyph(index, 10, index * 100));
    const index = createUnstructuredGlyphIndex(glyphs);
    let candidateCount = 0;
    for (const current of glyphs) {
      index.remove(current);
      candidateCount += [...index.candidates(current)].length;
    }
    expect(candidateCount).toBe(0);
  });

  it("excludes other pages and consumed candidates", () => {
    const upper = glyph(0, 10, 10);
    const lower = glyph(1, 10, 21);
    const otherPage = glyph(2, 10, 21, 10, 10, 2);
    const index = createUnstructuredGlyphIndex([upper, lower, otherPage]);
    index.remove(upper);
    expect([...index.candidates(upper)]).toEqual([lower]);
    index.remove(lower);
    expect([...index.candidates(upper)]).toEqual([]);
    index.remove(glyph(3, 10, 10, 10, 10, 3));
    expect([...index.candidates(glyph(3, 10, 10, 10, 10, 3))]).toEqual([]);
  });

  it("includes all geometrically eligible neighbors across signed bucket boundaries", () => {
    const glyphs = Array.from({ length: 240 }, (_, index) => ({
      ...glyph(
        index,
        ((index * 37) % 131) - 65,
        ((index * 19) % 167) - 83,
        index % 13,
        index % 17,
        index % 3,
      ),
      box: {
        ...glyph(
          index,
          ((index * 37) % 131) - 65,
          ((index * 19) % 167) - 83,
          index % 13,
          index % 17,
        ).box,
        layoutWidth: index % 2 ? 10000 : undefined,
      },
    }));
    const index = createUnstructuredGlyphIndex(glyphs);
    for (const upper of glyphs) {
      const candidates = new Set([...index.candidates(upper)].map((candidate) => candidate.index));
      for (const lower of glyphs) {
        if (upper.pageNumber !== lower.pageNumber) continue;
        const height = Math.max(upper.box.height, lower.box.height);
        const gap = lower.box.y - upper.box.bottom;
        const tolerance = Math.max(
          2,
          Math.max(upper.box.width, lower.box.width) * 0.35,
          Math.max(upper.box.layoutWidth ?? 0, lower.box.layoutWidth ?? 0) * 0.002,
        );
        if (
          lower.box.y + lower.box.height / 2 > upper.box.y + upper.box.height / 2 &&
          Math.abs(upper.box.x + upper.box.width / 2 - lower.box.x - lower.box.width / 2) <=
            tolerance &&
          gap >= -height * 0.25 &&
          gap <= height * 1.1
        ) {
          expect(candidates.has(lower.index)).toBe(true);
        }
      }
    }
  });

  it("does not emit duplicate buckets at large finite coordinates", () => {
    const first = glyph(0, 1e100, 1e100, 0, 0);
    const second = glyph(1, 1e100, 1e100, 0, 0);
    const index = createUnstructuredGlyphIndex([first, second]);
    index.remove(first);
    expect([...index.candidates(first)]).toEqual([second]);
  });
});
