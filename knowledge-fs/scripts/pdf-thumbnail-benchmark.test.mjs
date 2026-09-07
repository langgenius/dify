import assert from "node:assert/strict";
import test from "node:test";
import { thumbnailGoldenPdf } from "./pdf-thumbnail-benchmark.mjs";

test("thumbnail benchmark uses a small deterministic PDF, not an unbounded user document", () => {
  const first = thumbnailGoldenPdf();
  assert.deepEqual(first, thumbnailGoldenPdf());
  assert.ok(first.byteLength < 10_000);
  const text = new TextDecoder().decode(first);
  assert.ok(text.includes("/MediaBox [0 0 216 288]"));
  const offset = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(offset, offset + 4), "xref");
});
