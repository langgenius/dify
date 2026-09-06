import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nativeGoldenFixtures, summarizeParserSamples } from "./parser-benchmark.mjs";

test("resource benchmark contracts are part of the standard verification command", () => {
  const scripts = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
  assert.ok(scripts.check.includes("pnpm parser:regression:test"));
  assert.ok(scripts["parser:regression:test"].includes("parser-benchmark.test.mjs"));
  assert.ok(scripts["benchmark:parsers"].includes("parser-benchmark.mjs"));
});

test("benchmark keeps latency, memory, amplification and marker coverage separate", () => {
  const summary = summarizeParserSamples([
    { elapsedMs: 2, inputBytes: 10, outputBytes: 30, peakRssKiB: 100, markerCoverage: 1 },
    { elapsedMs: 8, inputBytes: 10, outputBytes: 40, peakRssKiB: 200, markerCoverage: 0.5 },
    { elapsedMs: 4, inputBytes: 10, outputBytes: 20, peakRssKiB: 150, markerCoverage: 1 },
  ]);
  assert.equal(summary.p50Ms, 4);
  assert.equal(summary.p95Ms, 8);
  assert.equal(summary.peakRssKiB, 200);
  assert.equal(summary.maxOutputAmplification, 4);
  assert.equal(summary.minimumMarkerCoverage, 0.5);
  assert.throws(() => summarizeParserSamples([]), /samples/);
});

test("golden corpus covers all native upload families and non-ASCII content with bounded fixtures", () => {
  const fixtures = nativeGoldenFixtures(20);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.extension),
    ["md", "mdx", "txt", "html", "json", "jsonl", "csv", "xml", "properties", "vtt"],
  );
  for (const fixture of fixtures) {
    assert.ok(fixture.body.byteLength < 100_000);
    assert.ok(fixture.markers.length >= 1);
  }
  assert.throws(() => nativeGoldenFixtures(1_000_001), /rows/);
});
