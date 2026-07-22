import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import {
  type GenerateAnswerStreamInput,
  type LlmAnswerProvider,
  createLlmAnswerQueryGenerator,
} from "./llm-answer-query-generator";
import type { BasicHybridRetriever } from "./retrieval-types";

function oneItemRetriever(): BasicHybridRetriever {
  return {
    retrieve: async () => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
            documentVersion: 1,
            pageNumber: 2,
            sectionPath: ["Invoice"],
          },
          metadata: { text: "苏州语灵人工智能科技有限公司 发票号码 26322000003220128076" },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
          permissionScope: [],
          projectionIds: ["fts-1"],
          score: 0.9,
          sources: ["fts"],
        },
      ],
      plan: {
        denseTopK: 0,
        ftsTopK: 10,
        fusionLimit: 10,
        queryLanguage: "cjk",
        requestedMode: "research",
        rerankCandidateLimit: 10,
        resolvedMode: "research",
        strategyVersion: "retrieval-planner-v1",
        topK: 10,
      },
    }),
  };
}

function multimodalRetriever({
  caption,
  ocrText,
}: {
  readonly caption?: string;
  readonly ocrText?: string;
}): BasicHybridRetriever {
  return {
    retrieve: async () => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
            documentVersion: 1,
            pageNumber: 2,
            sectionPath: ["Charts"],
          },
          metadata: {
            multimodalCandidate: {
              assetRoute: "/knowledge-spaces/s/documents/d/multimodal/item-1/asset",
              ...(caption ? { caption } : {}),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              modality: "image",
              ...(ocrText ? { ocrText } : {}),
            },
            text: "chart node",
          },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
          permissionScope: [],
          projectionIds: ["dense-1"],
          score: 0.9,
          sources: ["dense"],
        },
      ],
    }),
  };
}

const QUERY_INPUT = {
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  mode: "research" as const,
  permissionScope: ["knowledge-spaces:read"],
  query: "苏州语灵人工智能科技有限公司",
  subject: {
    scopes: ["knowledge-spaces:read"],
    subjectId: "user-1",
    tenantId: "tenant-1",
  },
  traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
};

describe("llm answer query generator", () => {
  it("retrieves with the resolved knowledge-space vectorSpaceId", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const retrieveCalls: unknown[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.2, 0.4]],
          metadata: { dimension: 2, model: "space-model", provider: "dify-model-runtime" },
          model: "space-model",
        };
      },
      kind: "dify-model-runtime",
      models: async () => [],
    };
    const generator = createLlmAnswerQueryGenerator({
      embeddingResolver: {
        resolve: async () => ({
          model: "space-model",
          pluginId: "space/plugin",
          provider: "space-provider",
          providerInstance: embeddings,
          revision: 3,
          vectorSpaceId: "vs-space-r3",
        }),
      },
      limit: 3,
      maxAnswerChars: 1_000,
      model: "answer-model",
      provider: {
        stream: async function* () {
          yield { type: "done" };
        },
      },
      retriever: {
        retrieve: async (input) => {
          retrieveCalls.push(input);
          return { items: [] };
        },
      },
      topK: 10,
    });

    for await (const _event of generator.stream({ ...QUERY_INPUT, mode: "fast" })) {
      // Drain the stream.
    }

    expect(embedCalls).toEqual([
      {
        inputType: "search_query",
        model: "space-model",
        tenantId: "tenant-1",
        texts: [QUERY_INPUT.query],
      },
    ]);
    expect(retrieveCalls).toEqual([
      expect.objectContaining({
        denseProjectionModel: "vs-space-r3",
        queryVector: [0.2, 0.4],
      }),
    ]);
  });

  it("uses the versioned space Top K and reasoning model and reports the applied profile", async () => {
    const retrieveCalls: unknown[] = [];
    const baseRetriever = oneItemRetriever();
    const defaultProvider = {
      stream: vi.fn(async function* () {
        yield { delta: "wrong provider", type: "delta" as const };
      }),
    };
    const selectedProvider = {
      kind: "dify-model-runtime",
      stream: vi.fn(async function* (input: GenerateAnswerStreamInput) {
        yield { delta: `model=${input.model}`, type: "delta" as const };
        yield { finishReason: "stop", type: "done" as const };
      }),
    };
    const reasoningProviderFactory = vi.fn(() => selectedProvider);
    const retrievalProfile = {
      defaultMode: "deep" as const,
      reasoningModel: {
        model: "space-reasoning-v2",
        pluginId: "vendor/chat",
        provider: "vendor",
      },
      rerank: { enabled: false },
      revision: 4,
      scoreThreshold: { enabled: false, stage: "rerank" as const },
      topK: 7,
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "deployment-default-model",
      provider: defaultProvider,
      reasoningProviderFactory,
      retriever: {
        retrieve: async (input) => {
          retrieveCalls.push(input);
          return baseRetriever.retrieve(input);
        },
      },
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      ...QUERY_INPUT,
      mode: "deep",
      retrievalProfile,
    })) {
      events.push(event);
    }

    expect(reasoningProviderFactory).toHaveBeenCalledOnce();
    expect(reasoningProviderFactory).toHaveBeenCalledWith(retrievalProfile.reasoningModel);
    expect(defaultProvider.stream).not.toHaveBeenCalled();
    expect(selectedProvider.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "space-reasoning-v2", tenantId: "tenant-1" }),
    );
    expect(retrieveCalls).toEqual([
      expect.objectContaining({
        limit: 7,
        retrievalProfile,
        topK: 7,
      }),
    ]);
    expect(events.at(-1)).toMatchObject({
      metadata: {
        model: "space-reasoning-v2",
        retrievalProfile: {
          defaultMode: "deep",
          reasoningModel: retrievalProfile.reasoningModel,
          revision: 4,
          topK: 7,
        },
      },
      type: "done",
    });
  });

  it("supports profile reasoning without a deployment-level legacy LLM", async () => {
    const selectedProvider = {
      stream: vi.fn(async function* (input: GenerateAnswerStreamInput) {
        yield { delta: input.model, type: "delta" as const };
        yield { finishReason: "stop", type: "done" as const };
      }),
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      reasoningProviderFactory: vi.fn(() => selectedProvider),
      retriever: oneItemRetriever(),
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      ...QUERY_INPUT,
      retrievalProfile: {
        defaultMode: "research",
        reasoningModel: {
          model: "space-only-model",
          pluginId: "vendor/chat",
          provider: "vendor",
        },
        rerank: { enabled: false },
        revision: 1,
        scoreThreshold: { enabled: false, stage: "rerank" },
        topK: 5,
      },
    })) {
      events.push(event);
    }

    expect(selectedProvider.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "space-only-model" }),
    );
    expect(events).toContainEqual({ delta: "space-only-model", type: "delta" });
  });

  it("fails closed when a profile is configured without dynamic reasoning", async () => {
    const legacyProvider = {
      stream: vi.fn(async function* () {
        yield { delta: "legacy answer", type: "delta" as const };
      }),
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "legacy-model",
      provider: legacyProvider,
      retriever: oneItemRetriever(),
      topK: 10,
    });
    const drain = async () => {
      for await (const _event of generator.stream({
        ...QUERY_INPUT,
        retrievalProfile: {
          defaultMode: "research",
          reasoningModel: {
            model: "space-model",
            pluginId: "vendor/chat",
            provider: "vendor",
          },
          rerank: { enabled: false },
          revision: 1,
          scoreThreshold: { enabled: false, stage: "rerank" },
          topK: 5,
        },
      })) {
        // Drain the stream.
      }
    };

    await expect(drain()).rejects.toMatchObject({
      message:
        "Knowledge-space reasoning model is configured, but dynamic reasoning is unavailable",
      name: "ReasoningCapabilityUnavailableError",
    });
    expect(legacyProvider.stream).not.toHaveBeenCalled();
  });

  it("synthesizes a grounded answer from retrieved evidence", async () => {
    const providerCalls: GenerateAnswerStreamInput[] = [];
    const provider: LlmAnswerProvider = {
      kind: "gemini",
      stream: async function* (input) {
        providerCalls.push({
          ...input,
          messages: input.messages.map((message) => ({ ...message })),
        });
        yield { delta: "Answer ", type: "delta" };
        yield { delta: "[1].", type: "delta" };
        yield {
          finishReason: "STOP",
          metadata: { model: "gemini-2.5-flash", provider: "gemini" },
          type: "done",
        };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      maxOutputTokens: 512,
      model: "gemini-2.5-flash",
      provider,
      retriever: oneItemRetriever(),
      temperature: 0,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({
      maxOutputTokens: 512,
      model: "gemini-2.5-flash",
      temperature: 0,
    });
    expect(providerCalls[0]?.messages[0]?.role).toBe("system");
    expect(providerCalls[0]?.messages[0]?.content).toContain("ONLY");
    expect(providerCalls[0]?.messages[1]?.role).toBe("user");
    expect(providerCalls[0]?.messages[1]?.content).toContain(
      "Question: 苏州语灵人工智能科技有限公司",
    );
    expect(providerCalls[0]?.messages[1]?.content).toContain("1. Invoice:");
    expect(providerCalls[0]?.messages[1]?.content).toContain("发票号码 26322000003220128076");

    expect(events).toEqual([
      { delta: "Answer ", type: "delta" },
      { delta: "[1].", type: "delta" },
      expect.objectContaining({
        finishReason: "retrieval-evidence",
        metadata: expect.objectContaining({
          citations: [
            expect.objectContaining({
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              label: "node:018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
              sources: ["fts"],
            }),
          ],
          generator: "llm-answer",
          mode: "research",
          model: "gemini-2.5-flash",
          plan: expect.objectContaining({ resolvedMode: "research" }),
          provider: "gemini",
          providerFinishReason: "STOP",
        }),
        type: "done",
      }),
    ]);
  });

  it("prefers the VLM answer provider when there is multimodal evidence", async () => {
    const textCalls: GenerateAnswerStreamInput[] = [];
    const provider: LlmAnswerProvider = {
      kind: "gemini",
      stream: async function* (input) {
        textCalls.push(input);
        yield { delta: "text", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      multimodalAnswerProvider: {
        generate: async () => ({
          metadata: { blocks: 1 },
          text: "The chart shows revenue growth.",
        }),
      },
      provider,
      retriever: multimodalRetriever({ caption: "Revenue chart" }),
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    // The text LLM must NOT be invoked when the VLM produced an answer.
    expect(textCalls).toHaveLength(0);
    expect(events[0]).toEqual({ delta: "The chart shows revenue growth.", type: "delta" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        finishReason: "retrieval-evidence",
        metadata: expect.objectContaining({
          multimodalAnswer: expect.objectContaining({ provider: "configured" }),
          multimodalEvidence: expect.arrayContaining([
            expect.objectContaining({ caption: "Revenue chart", modality: "image" }),
          ]),
        }),
        type: "done",
      }),
    );
  });

  it("falls back to the text LLM (with visual evidence in the prompt) when the VLM fails", async () => {
    const textCalls: GenerateAnswerStreamInput[] = [];
    const provider: LlmAnswerProvider = {
      kind: "gemini",
      stream: async function* (input) {
        textCalls.push({ ...input, messages: input.messages.map((message) => ({ ...message })) });
        yield { delta: "fallback answer", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      multimodalAnswerProvider: {
        generate: async () => {
          throw new Error("vlm exploded");
        },
      },
      provider,
      retriever: multimodalRetriever({ caption: "Revenue chart", ocrText: "Q1 +12%" }),
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(textCalls).toHaveLength(1);
    // Visual OCR/caption text reaches the text-only model's prompt.
    expect(textCalls[0]?.messages[1]?.content).toContain("caption: Revenue chart");
    expect(textCalls[0]?.messages[1]?.content).toContain("OCR: Q1 +12%");
    expect(events[0]).toEqual({ delta: "fallback answer", type: "delta" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ multimodalAnswerFailure: "vlm exploded" }),
        type: "done",
      }),
    );
  });

  it("skips the LLM and reports no evidence when retrieval is empty", async () => {
    let providerInvocations = 0;
    const provider: LlmAnswerProvider = {
      kind: "gemini",
      stream: async function* () {
        providerInvocations += 1;
        yield { delta: "should not happen", type: "delta" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: { retrieve: async () => ({ items: [] }) },
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(providerInvocations).toBe(0);
    expect(events).toEqual([
      expect.objectContaining({ type: "delta" }),
      expect.objectContaining({
        finishReason: "no-retrieval-evidence",
        metadata: expect.objectContaining({ generator: "llm-answer", model: "gemini-2.5-flash" }),
        type: "done",
      }),
    ]);
  });

  it("caps streamed answer deltas at maxAnswerChars", async () => {
    const provider: LlmAnswerProvider = {
      kind: "gemini",
      stream: async function* () {
        yield { delta: "abcdefghij", type: "delta" };
        yield { delta: "klmnop", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 5,
      model: "gemini-2.5-flash",
      provider,
      retriever: oneItemRetriever(),
      topK: 10,
    });

    const deltas: string[] = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type === "delta") {
        deltas.push(event.delta);
      }
    }

    expect(deltas.join("")).toBe("abcde");
  });

  it("emits trace-step events for the retrieve and llm answer stages", async () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "Grounded answer.", type: "delta" as const };
        yield { finishReason: "STOP", type: "done" as const };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: oneItemRetriever(),
      topK: 10,
    });

    const steps = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type === "trace-step") {
        steps.push(event.step);
      }
    }

    expect(steps.map((step) => step.name)).toEqual(["query.retrieve", "query.answer"]);
    expect(steps[0]).toMatchObject({ metadata: { itemCount: 1 }, status: "ok" });
    expect(steps[1]).toMatchObject({
      metadata: {
        answerChars: "Grounded answer.".length,
        model: "gemini-2.5-flash",
        providerFinishReason: "STOP",
        synthesis: "llm",
      },
      status: "ok",
    });
    expect(typeof steps[1]?.metadata.durationMs).toBe("number");
  });

  it("validates model, embedding model, and numeric bounds at construction time", () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { finishReason: "STOP", type: "done" as const };
      },
    };
    const embeddings = {
      embed: async () => ({
        dense: [[0.1]],
        metadata: { model: "embed-1", provider: "static" as const },
        model: "embed-1",
      }),
      kind: "static" as const,
      models: async () => [],
    };
    const baseOptions = {
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: oneItemRetriever(),
      topK: 10,
    };

    expect(() => createLlmAnswerQueryGenerator({ ...baseOptions, embeddings })).toThrow(
      "embeddingModel is required when embeddings are configured",
    );
    expect(() =>
      createLlmAnswerQueryGenerator({ ...baseOptions, embeddingModel: "  ", embeddings }),
    ).toThrow("embeddingModel is required when embeddings are configured");
    expect(() => createLlmAnswerQueryGenerator({ ...baseOptions, model: "  " })).toThrow(
      "LLM answer query generator model is required",
    );
    expect(() => createLlmAnswerQueryGenerator({ ...baseOptions, limit: 0 })).toThrow(
      "LLM answer query generator limit must be at least 1",
    );
    expect(() => createLlmAnswerQueryGenerator({ ...baseOptions, topK: 0 })).toThrow(
      "LLM answer query generator topK must be at least 1",
    );
    expect(() => createLlmAnswerQueryGenerator({ ...baseOptions, maxAnswerChars: 0 })).toThrow(
      "LLM answer query generator maxAnswerChars must be at least 1",
    );
    expect(() =>
      createLlmAnswerQueryGenerator({ ...baseOptions, maxEvidenceCharsPerItem: 0 }),
    ).toThrow("LLM answer query generator maxEvidenceCharsPerItem must be at least 1");
  });

  it("embeds the query first and surfaces retrieval metrics in traces and metadata", async () => {
    const embedCalls: unknown[] = [];
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "Grounded.", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              documentVersion: 1,
              sectionPath: ["Invoice"],
            },
            metadata: { text: `evidence for ${input.queryVector.join(",")}` },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
            permissionScope: [],
            projectionIds: ["fts-1"],
            score: 0.9,
            sources: ["fts"],
          },
        ],
        metrics: {
          denseCandidates: 1,
          denseMs: 1,
          ftsCandidates: 1,
          ftsMs: 1,
          fusedCandidates: 1,
          fusionMs: 1,
          totalMs: 3,
        },
      }),
    };
    const generator = createLlmAnswerQueryGenerator({
      embeddingModel: "embed-1",
      embeddings: {
        embed: async (input) => {
          embedCalls.push({ ...input, texts: [...input.texts] });

          return {
            dense: [[0.4, 0.6]],
            metadata: { model: "embed-1", provider: "static" },
            model: "embed-1",
          };
        },
        kind: "static",
        models: async () => [],
      },
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever,
      topK: 10,
    });

    const steps = [];
    const events = [];
    for await (const event of generator.stream({ ...QUERY_INPUT, mode: "fast" })) {
      if (event.type === "trace-step") {
        steps.push(event.step);
      } else {
        events.push(event);
      }
    }

    expect(embedCalls).toEqual([
      {
        inputType: "search_query",
        model: "embed-1",
        tenantId: "tenant-1",
        texts: [QUERY_INPUT.query],
      },
    ]);
    expect(steps.map((step) => step.name)).toEqual([
      "query.embed",
      "query.retrieve",
      "query.answer",
    ]);
    expect(steps[0]).toMatchObject({ metadata: { model: "embed-1" }, status: "ok" });
    expect(steps[1]?.metadata.metrics).toMatchObject({ fusedCandidates: 1 });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          metrics: expect.objectContaining({ totalMs: 3 }),
          topScore: 0.9,
        }),
        type: "done",
      }),
    );
  });

  it("fails closed when an embedding provider returns no vectors for a blank tenant", async () => {
    const embedCalls: unknown[] = [];
    const retrieveCalls: unknown[] = [];
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "Answer.", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      embeddingModel: "embed-1",
      embeddings: {
        embed: async (input) => {
          embedCalls.push({ ...input, texts: [...input.texts] });

          return {
            dense: [],
            metadata: { model: "embed-1", provider: "static" },
            model: "embed-1",
          };
        },
        kind: "static",
        models: async () => [],
      },
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: {
        retrieve: async (input) => {
          retrieveCalls.push({ ...input, queryVector: [...input.queryVector] });

          return { items: [] };
        },
      },
      topK: 10,
    });

    const drain = async () => {
      for await (const _event of generator.stream({
        ...QUERY_INPUT,
        mode: "fast",
        subject: { ...QUERY_INPUT.subject, tenantId: "" },
      })) {
        // Drain the stream.
      }
    };

    await expect(drain()).rejects.toThrow(
      "LLM answer query embedding provider returned no query vector",
    );
    // A blank tenant id is not forwarded, and invalid embeddings never reach retrieval.
    expect(embedCalls[0]).not.toHaveProperty("tenantId");
    expect(retrieveCalls).toEqual([]);
  });

  it("omits provider finish reason and metadata when the stream ends without a done event", async () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "Answer without finish.", type: "delta" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: oneItemRetriever(),
      topK: 10,
    });

    const steps = [];
    const events = [];
    for await (const event of generator.stream({
      ...QUERY_INPUT,
      subject: { ...QUERY_INPUT.subject, tenantId: "" },
    })) {
      if (event.type === "trace-step") {
        steps.push(event.step);
      } else {
        events.push(event);
      }
    }

    const answerStep = steps.find((step) => step.name === "query.answer");
    expect(answerStep?.metadata).not.toHaveProperty("provider");
    expect(answerStep?.metadata).not.toHaveProperty("providerFinishReason");
    const done = events.at(-1);
    expect(done).toEqual(expect.objectContaining({ finishReason: "retrieval-evidence" }));
    const metadata = (done as { metadata: Record<string, unknown> }).metadata;
    expect(metadata).not.toHaveProperty("provider");
    expect(metadata).not.toHaveProperty("providerFinishReason");
    expect(metadata).not.toHaveProperty("providerMetadata");
  });

  it("reports the retrieval plan and metrics when no evidence is found", async () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "unused", type: "delta" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      provider,
      retriever: {
        retrieve: async () => ({
          items: [],
          metrics: {
            denseCandidates: 0,
            denseMs: 1,
            ftsCandidates: 0,
            ftsMs: 1,
            fusedCandidates: 0,
            fusionMs: 1,
            totalMs: 3,
          },
          plan: {
            denseTopK: 0,
            ftsTopK: 10,
            fusionLimit: 10,
            queryLanguage: "latin",
            requestedMode: "fast",
            rerankCandidateLimit: 10,
            resolvedMode: "fast",
            strategyVersion: "retrieval-planner-v1",
            topK: 10,
          },
        }),
      },
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        finishReason: "no-retrieval-evidence",
        metadata: expect.objectContaining({
          metrics: expect.objectContaining({ fusedCandidates: 0 }),
          plan: expect.objectContaining({ resolvedMode: "fast" }),
        }),
        type: "done",
      }),
    );
    const metadata = (events.at(-1) as { metadata: Record<string, unknown> }).metadata;
    expect(metadata).not.toHaveProperty("provider");
  });

  it("keeps VLM answers even when the provider returns no metadata or kind", async () => {
    const generateCalls: unknown[] = [];
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "text fallback", type: "delta" };
      },
    };
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              documentVersion: 1,
              sectionPath: ["Charts"],
            },
            metadata: {
              multimodalCandidate: {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
                modality: "image",
              },
              text: "chart node",
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
            permissionScope: [],
            projectionIds: ["dense-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
        metrics: {
          denseCandidates: 1,
          denseMs: 1,
          ftsCandidates: 0,
          ftsMs: 1,
          fusedCandidates: 1,
          fusionMs: 1,
          totalMs: 3,
        },
        plan: {
          denseTopK: 10,
          ftsTopK: 0,
          fusionLimit: 10,
          queryLanguage: "latin",
          requestedMode: "deep",
          rerankCandidateLimit: 10,
          resolvedMode: "deep",
          strategyVersion: "retrieval-planner-v1",
          topK: 10,
        },
      }),
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      multimodalAnswerProvider: {
        generate: async (input) => {
          generateCalls.push(input);

          return { text: "Visual answer." };
        },
      },
      provider,
      retriever,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      ...QUERY_INPUT,
      subject: { ...QUERY_INPUT.subject, tenantId: "" },
      traceId: "",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    // Without tenant/trace context, neither field is forwarded to the VLM.
    expect(generateCalls[0]).not.toHaveProperty("tenantId");
    expect(generateCalls[0]).not.toHaveProperty("traceId");
    expect(events[0]).toEqual({ delta: "Visual answer.", type: "delta" });
    const metadata = (events.at(-1) as { metadata: Record<string, unknown> }).metadata;
    expect(metadata).toMatchObject({
      metrics: expect.objectContaining({ totalMs: 3 }),
      multimodalAnswer: { metadata: {}, provider: "configured" },
      plan: expect.objectContaining({ resolvedMode: "deep" }),
      topScore: 0.9,
    });
    expect(metadata).not.toHaveProperty("provider");
  });

  it("falls back to the text LLM when the VLM answer is blank", async () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "text fallback", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      multimodalAnswerProvider: {
        generate: async () => ({ text: "   " }),
      },
      provider,
      retriever: multimodalRetriever({ caption: "Revenue chart" }),
      topK: 10,
    });

    const steps = [];
    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type === "trace-step") {
        steps.push(event.step);
      } else {
        events.push(event);
      }
    }

    const failedStep = steps.find((step) => step.status === "error");
    expect(failedStep).toMatchObject({
      metadata: { error: "empty-multimodal-answer", synthesis: "multimodal-provider" },
      name: "query.answer",
    });
    expect(events[0]).toEqual({ delta: "text fallback", type: "delta" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          multimodalAnswerFailure: "empty-multimodal-answer",
        }),
        type: "done",
      }),
    );
  });

  it("labels non-Error VLM failures with a generic failure reason", async () => {
    const provider: LlmAnswerProvider = {
      stream: async function* () {
        yield { delta: "text fallback", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      model: "gemini-2.5-flash",
      multimodalAnswerProvider: {
        generate: () => Promise.reject("vlm string failure"),
      },
      provider,
      retriever: multimodalRetriever({ ocrText: "Q1 +12%" }),
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream(QUERY_INPUT)) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          multimodalAnswerFailure: "multimodal-answer-failed",
        }),
        type: "done",
      }),
    );
  });

  it("truncates long evidence per item and labels empty section paths as Document", async () => {
    const providerCalls: GenerateAnswerStreamInput[] = [];
    const provider: LlmAnswerProvider = {
      stream: async function* (input) {
        providerCalls.push({
          ...input,
          messages: input.messages.map((message) => ({ ...message })),
        });
        yield { delta: "ok", type: "delta" };
        yield { finishReason: "STOP", type: "done" };
      },
    };
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              documentVersion: 1,
              sectionPath: [],
            },
            metadata: { text: "0123456789 much longer evidence" },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
            permissionScope: [],
            projectionIds: ["fts-1"],
            score: 0.9,
            sources: ["fts"],
          },
        ],
      }),
    };
    const generator = createLlmAnswerQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      maxEvidenceCharsPerItem: 10,
      model: "gemini-2.5-flash",
      provider,
      retriever,
      topK: 10,
    });

    for await (const _event of generator.stream(QUERY_INPUT)) {
      // Drain the stream.
    }

    expect(providerCalls[0]?.messages[1]?.content).toContain("1. Document: 0123456789");
    expect(providerCalls[0]?.messages[1]?.content).not.toContain("much longer evidence");
  });

  it("keeps Research answer synthesis independent from query embeddings", async () => {
    const queryVectors: number[][] = [];
    const generator = createLlmAnswerQueryGenerator({
      embeddingModel: "must-not-run",
      embeddings: {
        embed: async () => {
          throw new Error("Research must not call embeddings");
        },
        kind: "static",
        models: async () => [],
      },
      limit: 3,
      maxAnswerChars: 1_000,
      model: "answer-model",
      provider: {
        stream: async function* () {
          yield { delta: "ok", type: "delta" };
          yield { type: "done" };
        },
      },
      retriever: {
        retrieve: async (input) => {
          queryVectors.push([...input.queryVector]);
          return { items: [] };
        },
      },
      topK: 10,
    });

    for await (const _event of generator.stream({
      ...QUERY_INPUT,
      query: "research camera warranty",
    })) {
      // Drain the stream.
    }

    expect(queryVectors).toEqual([[0]]);
  });
});
