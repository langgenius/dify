import { performance } from "node:perf_hooks";

import {
  createDocumentOutlineSummaryEnhancer,
  createInMemoryDocumentSemanticWindowCheckpointRepository,
  createLlmSemanticChunker,
  createPageIndexFindabilityRuntime,
} from "../packages/api/src/index.ts";
import {
  DocumentOutlineSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  ParseArtifactSchema,
} from "../packages/core/src/index.ts";
import { createUnstructuredParserClient } from "../packages/parsers/src/index.ts";

const delayMs = 3;
const repetitions = 12;
const ids = {
  artifact: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  asset: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  generation: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  outline: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
  space: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
};

const outline = await benchmarkOutlineReuse();
const semanticRetry = await benchmarkSemanticRetry();
const parser = await benchmarkParserRouting();
const findability = await benchmarkFindabilityAdmission();

process.stdout.write(
  `${JSON.stringify(
    {
      benchmark: "knowledge-fs-ingestion-model-optimizations-v1",
      environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
      fakeProviderDelayMs: delayMs,
      findability,
      outline,
      parser,
      repetitions,
      semanticRetry,
    },
    null,
    2,
  )}\n`,
);

async function benchmarkOutlineReuse() {
  const artifact = outlineArtifact(32);
  const baselineOutline = flatOutline(artifact, 32, 0);
  const optimizedOutline = flatOutline(artifact, 32, 24);
  const baseline = await repeat(async () => runOutlineEnhancer(artifact, baselineOutline));
  const optimized = await repeat(async () => runOutlineEnhancer(artifact, optimizedOutline));
  return {
    baselineProviderCalls: baseline.value,
    itemReusePercent: 75,
    measuredMedianBaselineMs: baseline.medianMs,
    measuredMedianOptimizedMs: optimized.medianMs,
    measuredMedianReductionPercent: percentReduction(baseline.medianMs, optimized.medianMs),
    optimizedProviderCalls: optimized.value,
    providerCallReductionPercent: percentReduction(baseline.value, optimized.value),
    scenario: "32 flat leaves; 24 carry semantic summaries; batchSize=2",
  };
}

async function runOutlineEnhancer(artifact, outline) {
  let calls = 0;
  const enhancer = createDocumentOutlineSummaryEnhancer({
    maxBatchInputChars: 1_000_000,
    maxBatchSize: 2,
    maxConcurrentSummaries: 8,
    maxInputChars: 1_000,
    maxSummaryChars: 120,
    model: "benchmark-reasoner",
    promptVersion: "benchmark-v1",
    provider: {
      summarize: async (input) => ({ summary: `summary:${input.outlineNodeId}` }),
      summarizeBatch: async (inputs) => {
        calls += 1;
        await sleep(delayMs);
        return inputs.map((input) => ({ summary: `summary:${input.outlineNodeId}` }));
      },
    },
  });
  await enhancer.enhance({ outline, parseArtifact: artifact });
  return calls;
}

async function benchmarkSemanticRetry() {
  const baseline = await repeat(() => runSemanticRetry(false));
  const optimized = await repeat(() => runSemanticRetry(true));
  return {
    baselineProviderCalls: baseline.value,
    measuredMedianBaselineMs: baseline.medianMs,
    measuredMedianOptimizedMs: optimized.medianMs,
    measuredMedianReductionPercent: percentReduction(baseline.medianMs, optimized.medianMs),
    optimizedProviderCalls: optimized.value,
    providerCallReductionPercent: percentReduction(baseline.value, optimized.value),
    scenario: "3 semantic windows; first attempt fails on window 2; retry succeeds",
  };
}

async function runSemanticRetry(withCheckpoints) {
  const checkpoints = withCheckpoints
    ? createInMemoryDocumentSemanticWindowCheckpointRepository()
    : undefined;
  const input = {
    knowledgeSpaceId: ids.space,
    parseArtifact: ParseArtifactSchema.parse({
      artifactHash: "a".repeat(64),
      contentType: "text",
      createdAt: "2026-08-17T00:00:00.000Z",
      documentAssetId: ids.asset,
      elements: [
        {
          id: "paragraph-1",
          metadata: {},
          sectionPath: ["Benchmark"],
          text: "第一段。第二段。第三段。",
          type: "paragraph",
        },
      ],
      id: ids.artifact,
      metadata: {},
      parser: "native-structured",
      version: 1,
    }),
    publicationGenerationId: ids.generation,
    retrievalProfile: retrievalProfile(),
    tenantId: "tenant-benchmark",
  };
  const first = semanticProvider(2);
  await createLlmSemanticChunker({
    ...(checkpoints ? { checkpoints } : {}),
    maxChunkChars: 4,
    maxWindowChars: 4,
    reasoningProviderFactory: () => first.provider,
  })
    .chunk(input)
    .catch(() => undefined);
  const retry = semanticProvider();
  await createLlmSemanticChunker({
    ...(checkpoints ? { checkpoints } : {}),
    maxChunkChars: 4,
    maxWindowChars: 4,
    reasoningProviderFactory: () => retry.provider,
  }).chunk(input);
  return first.calls() + retry.calls();
}

function semanticProvider(failAt) {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      kind: "benchmark-provider",
      async *stream(input) {
        calls += 1;
        await sleep(delayMs);
        if (calls === failAt) throw new Error("benchmark transient failure");
        const user = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user?.content ?? "{}");
        yield {
          delta: JSON.stringify({
            chunks: payload.units.map((unit) => ({
              endUnitId: unit.id,
              entities: [],
              relations: [],
              startUnitId: unit.id,
            })),
          }),
          type: "delta",
        };
        yield { finishReason: "stop", metadata: {}, type: "done" };
      },
    },
  };
}

async function benchmarkParserRouting() {
  const observed = [];
  const parser = createUnstructuredParserClient({
    endpoint: "https://parser.invalid",
    fetch: async (request) => {
      const form = await request.formData();
      observed.push(form.get("strategy"));
      return new Response("[]", { status: 200 });
    },
  });
  const fixtures = [
    ["report.pdf", "application/pdf", undefined],
    [
      "report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      undefined,
    ],
    ["simple.eml", "message/rfc822", { layoutComplexity: "simple" }],
    ["scan.eml", "message/rfc822", { requiresOcr: true }],
    ["visual.eml", "message/rfc822", { requiresImages: true }],
  ];
  for (const [filename, mimeType, parserHints] of fixtures) {
    await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId: ids.asset,
      filename,
      mimeType,
      ...(parserHints ? { parserHints } : {}),
      version: 1,
    });
  }
  const optimizedHiRes = observed.filter((strategy) => strategy === "hi_res").length;
  return {
    adaptiveStrategies: observed,
    fixtureCount: fixtures.length,
    forcedHiResAfter: optimizedHiRes,
    forcedHiResBefore: fixtures.length,
    forcedHiResReductionPercent: percentReduction(fixtures.length, optimizedHiRes),
    scenario: "PDF, DOCX, simple email, OCR email, image email",
  };
}

async function benchmarkFindabilityAdmission() {
  let enqueues = 0;
  const { admission } = createPageIndexFindabilityRuntime({
    attempts: { get: async () => null },
    evaluator: { evaluatePublished: async () => undefined },
    intervalMs: 1_000,
    jobs: {
      complete: async () => undefined,
      enqueue: async () => {
        enqueues += 1;
        return {};
      },
      fail: async () => undefined,
      heartbeat: async () => ({}),
      lease: async () => [],
    },
    leaseMs: 9_000,
    maxAttempts: 3,
    maxBatchSize: 5,
    retryBaseMs: 1_000,
    retryMaxMs: 10_000,
    workerId: "benchmark",
  });
  const samples = [];
  for (let index = 0; index < 1_000; index += 1) {
    const start = performance.now();
    await admission.enqueue({
      compilationAttemptId: ids.generation,
      publicationFingerprint: `projection-set-sha256:${"b".repeat(64)}`,
    });
    samples.push(performance.now() - start);
  }
  return {
    admissionIterations: samples.length,
    enqueues,
    medianAdmissionMs: Number(median(samples).toFixed(4)),
    modelCallsInPublicationCriticalPath: 0,
    questionSampleCapAfter: 20,
    questionSampleCapBefore: 100,
    questionSampleCapReductionPercent: 80,
  };
}

function outlineArtifact(count) {
  return ParseArtifactSchema.parse({
    artifactHash: "c".repeat(64),
    contentType: "text",
    createdAt: "2026-08-17T00:00:00.000Z",
    documentAssetId: ids.asset,
    elements: Array.from({ length: count }, (_, index) => ({
      id: `element-${index}`,
      metadata: {},
      sectionPath: [`Section ${index}`],
      text: `Section ${index} benchmark content.`,
      type: "paragraph",
    })),
    id: ids.artifact,
    metadata: {},
    parser: "native-structured",
    version: 1,
  });
}

function flatOutline(artifact, count, semanticCount) {
  return DocumentOutlineSchema.parse({
    artifactHash: artifact.artifactHash,
    createdAt: artifact.createdAt,
    documentAssetId: ids.asset,
    id: ids.outline,
    knowledgeSpaceId: ids.space,
    metadata: {},
    nodes: Array.from({ length: count }, (_, index) => ({
      childNodeIds: [],
      children: [],
      id: `node-${index}`,
      level: 1,
      metadata: index < semanticCount ? { summarySource: "semantic-chunking" } : {},
      sectionPath: [`Section ${index}`],
      sourceElementIds: [`element-${index}`],
      sourceNodeIds: [],
      ...(index < semanticCount ? { summary: `semantic summary ${index}` } : {}),
      title: `Section ${index}`,
      tocSource: "fallback",
    })),
    outlineVersion: "benchmark-v1",
    parseArtifactId: ids.artifact,
    version: 1,
  });
}

function retrievalProfile() {
  return KnowledgeSpaceRetrievalProfileSchema.parse({
    defaultMode: "fast",
    reasoningModel: { model: "reasoner", pluginId: "plugin", provider: "provider" },
    rerank: {
      enabled: true,
      model: { model: "reranker", pluginId: "plugin", provider: "provider" },
    },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 10,
  });
}

async function repeat(operation) {
  const durations = [];
  let value;
  for (let index = 0; index < repetitions; index += 1) {
    const start = performance.now();
    value = await operation();
    durations.push(performance.now() - start);
  }
  return { medianMs: rounded(median(durations)), value };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0);
}

function percentReduction(before, after) {
  return rounded(((before - after) / before) * 100);
}

function rounded(value) {
  return Number(value.toFixed(2));
}

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
