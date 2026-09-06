import { pathToFileURL } from "node:url";

/** Marker coverage is a narrow golden assertion, not an OCR/retrieval quality score. */
export function summarizeParserSamples(samples) {
  if (!samples.length) throw new Error("Parser benchmark requires samples");
  const times = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  return {
    p50Ms: times[Math.ceil(times.length * 0.5) - 1],
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    peakRssKiB: Math.max(...samples.map((sample) => sample.peakRssKiB)),
    maxOutputAmplification: Math.max(
      ...samples.map((sample) => sample.outputBytes / Math.max(1, sample.inputBytes)),
    ),
    minimumMarkerCoverage: Math.min(...samples.map((sample) => sample.markerCoverage)),
    samples: samples.length,
  };
}

export function nativeGoldenFixtures(rows) {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > 10_000)
    throw new Error("Golden fixture rows must be between 1 and 10000");
  const marker = "知识解析证据";
  const records = Array.from({ length: rows }, (_, index) => ({
    index,
    text: `${marker}${index}【完】`,
  }));
  const fixture = (
    extension,
    mimeType,
    text,
    markers = [`${marker}0【完】`, `${marker}${rows - 1}【完】`],
  ) => ({ extension, mimeType, body: new TextEncoder().encode(text), markers });
  return [
    fixture("md", "text/markdown", records.map((record) => `> ${record.text}\n`).join("\n")),
    fixture("mdx", "text/mdx", records.map((record) => `<p>${record.text}</p>`).join("\n\n")),
    fixture("txt", "text/plain", records.map((record) => record.text).join("\n\n")),
    fixture(
      "html",
      "text/html",
      `<html><body>${records.map((record) => `<section><p>${record.text}</p></section>`).join("")}</body></html>`,
    ),
    fixture("json", "application/json", JSON.stringify(records)),
    fixture(
      "jsonl",
      "application/x-ndjson",
      records.map((record) => JSON.stringify(record)).join("\n"),
    ),
    fixture(
      "csv",
      "text/csv",
      `index,text\n${records.map((record) => `${record.index},${record.text}`).join("\n")}`,
    ),
    fixture(
      "xml",
      "application/xml",
      `<records>${records.map((record) => `<record index="${record.index}">${record.text}</record>`).join("")}</records>`,
    ),
    fixture(
      "properties",
      "text/x-java-properties",
      records.map((record) => `key${record.index}=${record.text}`).join("\n"),
    ),
    fixture(
      "vtt",
      "text/vtt",
      `WEBVTT\n\n${records.map((record) => `${record.index}\n00:00:00.000 --> 00:00:01.000\n${record.text}`).join("\n\n")}\n`,
    ),
  ];
}

export async function runNativeParserBenchmark({ repetitions = 3, sizes = [10, 1000] } = {}) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20)
    throw new Error("Repetitions must be between 1 and 20");
  const { createApiDocumentParser } = await import("../apps/api/src/parser-options.ts");
  const parser = createApiDocumentParser({ env: {} });
  const results = [];
  for (const rows of sizes) {
    for (const fixture of nativeGoldenFixtures(rows)) {
      const samples = [];
      for (let iteration = 0; iteration < repetitions; iteration++) {
        const started = performance.now();
        const artifact = await parser.parse({
          body: fixture.body,
          documentAssetId: "00000000-0000-4000-8000-000000000001",
          filename: `golden.${fixture.extension}`,
          mimeType: fixture.mimeType,
          version: 1,
        });
        const elapsedMs = performance.now() - started;
        const text = artifact.elements.map((element) => element.text ?? "").join("\n");
        const markerCoverage =
          fixture.markers.filter((marker) => text.includes(marker)).length / fixture.markers.length;
        if (markerCoverage !== 1)
          throw new Error(`Golden marker missing: ${fixture.extension}/${rows}`);
        samples.push({
          elapsedMs,
          inputBytes: fixture.body.byteLength,
          outputBytes: artifact.metadata.parserExecution.outputBytes,
          peakRssKiB: artifact.metadata.parserExecution.peakRssKiB,
          markerCoverage,
        });
      }
      results.push({
        format: fixture.extension,
        rows,
        inputBytes: fixture.body.byteLength,
        ...summarizeParserSamples(samples),
      });
    }
  }
  return {
    benchmark: "parser-native-resource-golden-v1",
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    scope: "real-native-parsers-through-isolated-api-adapter",
    excludes: ["Unstructured image", "OCR accuracy", "retrieval recall", "production capacity"],
    results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runNativeParserBenchmark(), null, 2));
}
