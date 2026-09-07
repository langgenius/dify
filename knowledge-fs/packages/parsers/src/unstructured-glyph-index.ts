interface IndexedGlyph {
  readonly box: {
    readonly bottom: number;
    readonly height: number;
    readonly layoutWidth?: number | undefined;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly index: number;
  readonly pageNumber: number;
}

interface GlyphPage<T> {
  readonly buckets: Map<string, Map<number, T>>;
  cellHeight: number;
  cellWidth: number;
}

/**
 * A conservative page-local grid for finite glyph geometry. Every adjacent pair under the
 * vertical-text predicate is in neighboring buckets: horizontal tolerance is at most cellWidth,
 * and lower.y - upper.bottom lies between -0.25 and +1.1 cellHeight. Exact adjacency and tie
 * breaking remain the caller's responsibility. Dense/adversarial buckets need a caller-owned
 * comparison budget; the index never silently drops a possible neighbor.
 */
export function createUnstructuredGlyphIndex<T extends IndexedGlyph>(
  glyphs: readonly T[],
): {
  candidates(upper: T): Iterable<T>;
  remove(glyph: T): void;
} {
  const pages = new Map<number, GlyphPage<T>>();
  for (const glyph of glyphs) {
    let page = pages.get(glyph.pageNumber);
    if (!page) {
      page = { buckets: new Map(), cellHeight: 1, cellWidth: 2 };
      pages.set(glyph.pageNumber, page);
    }
    page.cellHeight = Math.max(page.cellHeight, glyph.box.height);
    page.cellWidth = Math.max(
      page.cellWidth,
      glyph.box.width * 0.35,
      (glyph.box.layoutWidth ?? 0) * 0.002,
    );
  }

  const bucketKey = (glyph: T, page: GlyphPage<T>): string =>
    `${Math.floor((glyph.box.x + glyph.box.width / 2) / page.cellWidth)}:${Math.floor(glyph.box.y / page.cellHeight)}`;
  for (const glyph of glyphs) {
    const page = pages.get(glyph.pageNumber) as GlyphPage<T>;
    const key = bucketKey(glyph, page);
    let bucket = page.buckets.get(key);
    if (!bucket) {
      bucket = new Map();
      page.buckets.set(key, bucket);
    }
    bucket.set(glyph.index, glyph);
  }

  return {
    candidates: function* (upper) {
      const page = pages.get(upper.pageNumber);
      if (!page) return;
      const x = Math.floor((upper.box.x + upper.box.width / 2) / page.cellWidth);
      const y = Math.floor(upper.box.bottom / page.cellHeight);
      // Fixed offsets, rather than incrementing huge coordinate values in a numeric range, keep
      // traversal bounded even beyond the safe-integer range. Deduplicate rounded bucket keys.
      const visited = new Set<string>();
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1, 2]) {
          const key = `${x + dx}:${y + dy}`;
          if (visited.has(key)) continue;
          visited.add(key);
          const bucket = page.buckets.get(key);
          if (bucket) yield* bucket.values();
        }
      }
    },
    remove: (glyph) => {
      const page = pages.get(glyph.pageNumber);
      if (!page) return;
      const key = bucketKey(glyph, page);
      const bucket = page.buckets.get(key);
      bucket?.delete(glyph.index);
      if (bucket?.size === 0) page.buckets.delete(key);
    },
  };
}
