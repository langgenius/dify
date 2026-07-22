import type { ComputeRuntime, PackEvidenceInput, PackedEvidence } from "@knowledge/compute";
import type { CacheAdapter } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type GenerateTextInput,
  type GenerateTextResult,
  GenerationModelUnavailableError,
  type LlmProvider,
  type LlmStreamEvent,
  createAutomaticGoldenQuestionGenerator,
  createCitationNormalizer,
  createClaimEvidenceAlignmentChecker,
  createContextWindowPacker,
  createEvidencePromptTemplateRegistry,
  createGenerationCache,
  createGenerationCostTracker,
  createGenerationQualityFlagger,
  createGenerationSkipPath,
  createGoldenQuestionReviewWorkflow,
  createLlmClaimEvidenceAlignmentJudge,
  createLlmRouter,
  createStaticLlmProvider,
  withGenerationCostTracking,
} from "./index";

function createRecordingLlmProvider(
  kind: "anthropic" | "openai" | "static" = "static",
): LlmProvider & {
  readonly generateCalls: GenerateTextInput[];
  readonly streamCalls: GenerateTextInput[];
} {
  const generateCalls: GenerateTextInput[] = [];
  const streamCalls: GenerateTextInput[] = [];

  return {
    generateCalls,
    kind,
    streamCalls,
    generate: async (input): Promise<GenerateTextResult> => {
      generateCalls.push({
        ...input,
        messages: input.messages.map((message) => ({ ...message })),
      });

      return {
        finishReason: "stop",
        metadata: {
          model: input.model,
          provider: kind,
        },
        model: input.model,
        text: `${kind}:${input.model}`,
      };
    },
    models: async () => [
      {
        contextWindowTokens: 128_000,
        id: `${kind}-model`,
        maxOutputTokens: 4096,
        provider: kind,
        supportsStreaming: true,
        version: "test",
      },
    ],
    stream: async function* (input): AsyncGenerator<LlmStreamEvent> {
      streamCalls.push({
        ...input,
        messages: input.messages.map((message) => ({ ...message })),
      });
      yield { delta: `${kind}:${input.model}`, type: "delta" };
      yield {
        finishReason: "stop",
        metadata: { model: input.model, provider: kind },
        type: "done",
      };
    },
  };
}

function createRecordingComputeRuntime(): ComputeRuntime & {
  readonly packEvidenceCalls: PackEvidenceInput[];
} {
  const packEvidenceCalls: PackEvidenceInput[] = [];

  return {
    packEvidenceCalls,
    chunkParseArtifact: () => {
      throw new Error("not used");
    },
    countApproxTokens: (input) => input.split(/\s+/).filter(Boolean).length,
    countTokens: (input) => input.split(/\s+/).filter(Boolean).length,
    diffText: () => {
      throw new Error("not used");
    },
    packEvidence: (input): PackedEvidence => {
      packEvidenceCalls.push({
        ...input,
        evidenceBundle: JSON.parse(JSON.stringify(input.evidenceBundle)),
      });

      return {
        context: "[E1] Packed evidence.",
        items: [
          {
            citations: [],
            marker: "E1",
            nodeId: "node-a",
            score: 0.9,
            text: "Packed evidence.",
            tokens: 3,
          },
        ],
        model: input.model,
        omitted: [],
        tokenBudget: input.tokenBudget,
        usedTokens: 3,
      };
    },
    rrfFuse: () => [],
  };
}

function createRecordingCache(): CacheAdapter & {
  readonly keys: string[];
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();
  const keys: string[] = [];

  return {
    kind: "memory",
    keys,
    values,
    delete: async (key) => {
      values.delete(key);
    },
    get: async (key) => {
      keys.push(key);
      const value = values.get(key);

      return value ? new Uint8Array(value) : null;
    },
    health: async () => true,
    set: async (key, value) => {
      keys.push(key);
      values.set(key, new Uint8Array(value));
    },
    stats: async () => ({
      entries: values.size,
      totalBytes: [...values.values()].reduce((total, value) => total + value.byteLength, 0),
    }),
  };
}

describe("LLM generation providers", () => {
  it("provides deterministic static generation for tests and local fallback", async () => {
    const provider = createStaticLlmProvider({
      model: "static-answer",
      response: "Static response.",
    });

    await expect(
      provider.generate({
        messages: [{ content: "question", role: "user" }],
        model: "static-answer",
      }),
    ).resolves.toEqual({
      finishReason: "stop",
      metadata: {
        model: "static-answer",
        provider: "static",
      },
      model: "static-answer",
      text: "Static response.",
    });

    const events: unknown[] = [];
    for await (const event of provider.stream({
      messages: [{ content: "question", role: "user" }],
      model: "static-answer",
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { delta: "Static response.", type: "delta" },
      {
        finishReason: "stop",
        metadata: { model: "static-answer", provider: "static" },
        type: "done",
      },
    ]);
  });

  it("adds model pricing cost breakdowns to generated and streamed LLM results", async () => {
    const provider: LlmProvider = {
      kind: "openai",
      generate: async () => ({
        finishReason: "stop",
        metadata: {
          model: "gpt-cost",
          provider: "openai",
          usage: {
            completionTokens: 500,
            promptTokens: 1000,
            totalTokens: 1500,
          },
        },
        model: "gpt-cost",
        text: "costed answer",
      }),
      models: async () => [
        {
          contextWindowTokens: 128_000,
          id: "gpt-cost",
          maxOutputTokens: 4096,
          provider: "openai",
          supportsStreaming: true,
          version: "2026-05-11",
        },
      ],
      stream: async function* () {
        yield { delta: "costed", type: "delta" };
        yield {
          finishReason: "stop",
          metadata: {
            model: "gpt-cost",
            provider: "openai",
            usage: {
              completionTokens: 250,
              promptTokens: 1000,
              totalTokens: 1250,
            },
          },
          type: "done",
        };
      },
    };
    const tracker = createGenerationCostTracker({
      priceVersion: "pricing-v1",
      prices: [
        {
          inputUsdPerMillionTokens: 2,
          model: "gpt-cost",
          outputUsdPerMillionTokens: 8,
          provider: "openai",
        },
      ],
    });
    const wrapped = withGenerationCostTracking({ provider, tracker });

    await expect(
      wrapped.generate({ messages: [{ content: "cost", role: "user" }], model: "gpt-cost" }),
    ).resolves.toMatchObject({
      metadata: {
        cost: {
          currency: "USD",
          inputCostUsd: 0.002,
          outputCostUsd: 0.004,
          priceVersion: "pricing-v1",
          totalCostUsd: 0.006,
        },
      },
    });

    const events: LlmStreamEvent[] = [];
    for await (const event of wrapped.stream({
      messages: [{ content: "cost", role: "user" }],
      model: "gpt-cost",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { delta: "costed", type: "delta" },
      {
        finishReason: "stop",
        metadata: {
          cost: {
            completionTokens: 250,
            currency: "USD",
            inputCostUsd: 0.002,
            outputCostUsd: 0.002,
            outputTokens: 250,
            priceVersion: "pricing-v1",
            promptTokens: 1000,
            provider: "openai",
            totalCostUsd: 0.004,
            totalTokens: 1250,
            model: "gpt-cost",
          },
          model: "gpt-cost",
          provider: "openai",
          usage: {
            completionTokens: 250,
            promptTokens: 1000,
            totalTokens: 1250,
          },
        },
        type: "done",
      },
    ]);
  });

  it("rejects unsafe generation cost tracking configuration and missing prices", () => {
    expect(() => createGenerationCostTracker({ priceVersion: " ", prices: [] })).toThrow(
      "Generation cost priceVersion is required",
    );
    expect(() =>
      createGenerationCostTracker({
        priceVersion: "pricing-v1",
        prices: [
          {
            inputUsdPerMillionTokens: 0,
            model: "gpt-cost",
            outputUsdPerMillionTokens: 8,
            provider: "openai",
          },
        ],
      }),
    ).toThrow("Generation cost inputUsdPerMillionTokens must be positive");

    const tracker = createGenerationCostTracker({
      priceVersion: "pricing-v1",
      prices: [
        {
          inputUsdPerMillionTokens: 2,
          model: "gpt-cost",
          outputUsdPerMillionTokens: 8,
          provider: "openai",
        },
      ],
    });

    expect(() =>
      tracker.estimate({
        model: "missing-model",
        provider: "openai",
        usage: { completionTokens: 1, promptTokens: 1, totalTokens: 2 },
      }),
    ).toThrow("Generation pricing is not configured for openai/missing-model");
    expect(() =>
      tracker.estimate({
        model: "gpt-cost",
        provider: "openai",
        usage: { completionTokens: -1, promptTokens: 1, totalTokens: 0 },
      }),
    ).toThrow("Generation usage tokens must be non-negative integers");
  });

  it("normalizes generated citations by removing orphan markers and mapping valid evidence", () => {
    const normalizer = createCitationNormalizer();
    const normalized = normalizer.normalize({
      evidenceItems: packedContextWindow().packedEvidence.items,
      text: "Packed evidence is relevant [E1]. Unsupported claim [E9]. Repeated citation [E1].",
    });

    expect(normalized).toEqual({
      citations: [
        {
          citations: [],
          marker: "E1",
          nodeId: "node-a",
          score: 0.9,
        },
      ],
      orphanMarkers: ["E9"],
      text: "Packed evidence is relevant [E1]. Unsupported claim. Repeated citation [E1].",
    });
  });

  it("rejects unsafe citation normalization inputs", () => {
    const normalizer = createCitationNormalizer({ maxAnswerBytes: 8, maxCitations: 1 });

    expect(() =>
      normalizer.normalize({
        evidenceItems: packedContextWindow().packedEvidence.items,
        text: "answer too long",
      }),
    ).toThrow("Citation normalization answer exceeds maxAnswerBytes=8");
    expect(() =>
      createCitationNormalizer({
        maxAnswerBytes: 0,
      }),
    ).toThrow("Citation normalization maxAnswerBytes must be at least 1");
    expect(() =>
      createCitationNormalizer({
        maxCitations: 0,
      }),
    ).toThrow("Citation normalization maxCitations must be at least 1");
    expect(() =>
      createCitationNormalizer().normalize({
        evidenceItems: [
          ...packedContextWindow().packedEvidence.items,
          {
            citations: [],
            marker: "E1",
            nodeId: "node-duplicate",
            score: 0.7,
            text: "Duplicate marker.",
            tokens: 2,
          },
        ],
        text: "duplicate [E1]",
      }),
    ).toThrow("Citation normalization evidence marker E1 is duplicated");
    expect(() =>
      createCitationNormalizer({ maxCitations: 1 }).normalize({
        evidenceItems: [
          ...packedContextWindow().packedEvidence.items,
          {
            citations: [],
            marker: "E2",
            nodeId: "node-b",
            score: 0.8,
            text: "More evidence.",
            tokens: 2,
          },
        ],
        text: "[E1] [E2]",
      }),
    ).toThrow("Citation normalization citation count exceeds maxCitations=1");
  });

  it("checks claim-evidence alignment with a bounded rule-based fast path", () => {
    const checker = createClaimEvidenceAlignmentChecker({
      maxAnswerBytes: 4_000,
      maxClaims: 8,
      mode: "fast",
    });
    const normalized = createCitationNormalizer().normalize({
      evidenceItems: [
        ...packedContextWindow().packedEvidence.items,
        {
          citations: [],
          marker: "E2",
          nodeId: "node-b",
          score: 0.8,
          text: "Security controls require quarterly review.",
          tokens: 6,
        },
      ],
      text: [
        "Packed evidence is relevant [E1].",
        "Quarterly review is required [E2].",
        "Uncited roadmap claim.",
        "The vendor renewal date is 2028 [E1].",
      ].join(" "),
    });

    const report = checker.check({
      citations: normalized.citations,
      evidenceItems: [
        ...packedContextWindow().packedEvidence.items,
        {
          citations: [],
          marker: "E2",
          nodeId: "node-b",
          score: 0.8,
          text: "Security controls require quarterly review.",
          tokens: 6,
        },
      ],
      text: normalized.text,
    });

    expect(report).toEqual({
      claims: [
        {
          evidenceMarkers: ["E1"],
          evidenceNodeIds: ["node-a"],
          reason: "citation-overlap",
          status: "grounded",
          text: "Packed evidence is relevant [E1].",
        },
        {
          evidenceMarkers: ["E2"],
          evidenceNodeIds: ["node-b"],
          reason: "citation-overlap",
          status: "grounded",
          text: "Quarterly review is required [E2].",
        },
        {
          evidenceMarkers: [],
          evidenceNodeIds: [],
          reason: "missing-citation",
          status: "ungrounded",
          text: "Uncited roadmap claim.",
        },
        {
          evidenceMarkers: ["E1"],
          evidenceNodeIds: ["node-a"],
          reason: "citation-without-evidence-overlap",
          status: "ungrounded",
          text: "The vendor renewal date is 2028 [E1].",
        },
      ],
      metadata: {
        checker: "rule-based",
        checkedClaims: 4,
        evidenceReferences: 2,
        mode: "fast",
      },
      ungroundedClaims: [
        {
          evidenceMarkers: [],
          evidenceNodeIds: [],
          reason: "missing-citation",
          status: "ungrounded",
          text: "Uncited roadmap claim.",
        },
        {
          evidenceMarkers: ["E1"],
          evidenceNodeIds: ["node-a"],
          reason: "citation-without-evidence-overlap",
          status: "ungrounded",
          text: "The vendor renewal date is 2028 [E1].",
        },
      ],
    });
  });

  it("uses an LLM judge for deep claim-evidence alignment with validated output", async () => {
    const provider = createRecordingLlmProvider("openai");
    provider.generate = async (input) => {
      provider.generateCalls.push({
        ...input,
        messages: input.messages.map((message) => ({ ...message })),
      });

      return generatedAnswer(
        JSON.stringify({
          claims: [
            {
              evidenceMarkers: ["E1"],
              reason: "judge-confirmed",
              status: "grounded",
              text: "Packed evidence is relevant [E1].",
            },
          ],
          summary: "All cited claims are grounded.",
        }),
      );
    };
    const judge = createLlmClaimEvidenceAlignmentJudge({
      maxClaims: 4,
      maxEvidenceBytes: 8_000,
      model: "judge-model",
      provider,
    });

    const report = await judge.check({
      citations: createCitationNormalizer().normalize({
        evidenceItems: packedContextWindow().packedEvidence.items,
        text: "Packed evidence is relevant [E1].",
      }).citations,
      evidenceItems: packedContextWindow().packedEvidence.items,
      mode: "deep",
      text: "Packed evidence is relevant [E1].",
    });

    expect(report).toEqual({
      claims: [
        {
          evidenceMarkers: ["E1"],
          evidenceNodeIds: ["node-a"],
          reason: "judge-confirmed",
          status: "grounded",
          text: "Packed evidence is relevant [E1].",
        },
      ],
      metadata: {
        checker: "llm-judge",
        checkedClaims: 1,
        evidenceReferences: 1,
        mode: "deep",
        model: "judge-model",
      },
      ungroundedClaims: [],
    });
    expect(provider.generateCalls[0]).toMatchObject({
      maxOutputTokens: 1024,
      model: "judge-model",
      temperature: 0,
    });
    expect(provider.generateCalls[0]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("rejects unsafe claim-evidence alignment inputs and malformed judge output", async () => {
    expect(() => createClaimEvidenceAlignmentChecker({ maxClaims: 0 })).toThrow(
      "Claim-evidence alignment maxClaims must be at least 1",
    );
    expect(() =>
      createClaimEvidenceAlignmentChecker({ maxAnswerBytes: 8 }).check({
        citations: [],
        evidenceItems: [],
        text: "answer too long",
      }),
    ).toThrow("Claim-evidence alignment answer exceeds maxAnswerBytes=8");
    expect(() =>
      createClaimEvidenceAlignmentChecker({ maxClaims: 1 }).check({
        citations: [],
        evidenceItems: [],
        text: "First claim. Second claim.",
      }),
    ).toThrow("Claim-evidence alignment claim count exceeds maxClaims=1");
    expect(() =>
      createClaimEvidenceAlignmentChecker({ maxClaimBytes: 4 }).check({
        citations: [],
        evidenceItems: [],
        text: "claim",
      }),
    ).toThrow("Claim-evidence alignment claim exceeds maxClaimBytes=4");
    expect(() => createClaimEvidenceAlignmentChecker({ minOverlapTerms: 0 })).toThrow(
      "Claim-evidence alignment minOverlapTerms must be at least 1",
    );
    expect(() =>
      createClaimEvidenceAlignmentChecker().check({
        citations: [
          { citations: [], marker: "E1", nodeId: "node-a", score: 0.9 },
          { citations: [], marker: "E1", nodeId: "node-b", score: 0.8 },
        ],
        evidenceItems: [],
        text: "Duplicate citation [E1].",
      }),
    ).toThrow("Claim-evidence alignment citation marker E1 is duplicated");
    expect(() =>
      createClaimEvidenceAlignmentChecker().check({
        citations: [{ citations: [], marker: "E1", nodeId: "node-a", score: 0.9 }],
        evidenceItems: [
          { citations: [], marker: "E1", nodeId: "node-a", score: 0.9, text: "A", tokens: 1 },
          { citations: [], marker: "E1", nodeId: "node-b", score: 0.8, text: "B", tokens: 1 },
        ],
        text: "Duplicate evidence [E1].",
      }),
    ).toThrow("Claim-evidence alignment evidence marker E1 is duplicated");
    expect(() =>
      createLlmClaimEvidenceAlignmentJudge({
        maxEvidenceBytes: 0,
        model: "judge-model",
        provider: createStaticLlmProvider({ model: "judge-model", response: "{}" }),
      }),
    ).toThrow("Claim-evidence alignment maxEvidenceBytes must be at least 1");
    expect(() =>
      createLlmClaimEvidenceAlignmentJudge({
        maxOutputTokens: 0,
        model: "judge-model",
        provider: createStaticLlmProvider({ model: "judge-model", response: "{}" }),
      }),
    ).toThrow("Claim-evidence alignment maxOutputTokens must be at least 1");
    expect(() =>
      createLlmClaimEvidenceAlignmentJudge({
        model: " ",
        provider: createStaticLlmProvider({ model: "judge-model", response: "{}" }),
      }),
    ).toThrow("Claim-evidence alignment judge model is required");

    const malformedJudge = createLlmClaimEvidenceAlignmentJudge({
      model: "judge-model",
      provider: createStaticLlmProvider({
        model: "judge-model",
        response: JSON.stringify({
          claims: Array.from({ length: 101 }, (_, index) => ({
            evidenceMarkers: [],
            status: "ungrounded",
            text: `claim-${index}`,
          })),
        }),
      }),
    });

    await expect(
      malformedJudge.check({
        citations: [],
        evidenceItems: [],
        mode: "research",
        text: "Claim.",
      }),
    ).rejects.toThrow("Claim-evidence judge returned invalid output");
    await expect(
      createLlmClaimEvidenceAlignmentJudge({
        model: "judge-model",
        provider: createStaticLlmProvider({
          model: "judge-model",
          response: "not json",
        }),
      }).check({
        citations: [],
        evidenceItems: [],
        mode: "research",
        text: "Claim.",
      }),
    ).rejects.toThrow("Claim-evidence judge returned invalid output");
  });

  it("adds ungrounded-claim and stale-evidence quality flags to generated responses", async () => {
    const evidenceItems = [
      ...packedContextWindow().packedEvidence.items,
      {
        citations: [],
        marker: "E2",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        score: 0.7,
        text: "Security controls require quarterly review.",
        tokens: 6,
      },
    ];
    const normalized = createCitationNormalizer().normalize({
      evidenceItems,
      text: "Packed evidence is relevant [E1]. Security controls require quarterly review [E2]. Uncited roadmap claim.",
    });
    const flagger = createGenerationQualityFlagger({
      alignmentChecker: createClaimEvidenceAlignmentChecker({ mode: "fast" }),
    });
    const bundle = evidenceBundle();
    const baseEvidenceItem = bundle.items[0];

    if (!baseEvidenceItem) {
      throw new Error("Expected test evidence item");
    }

    const flagged = await flagger.flag({
      evidenceBundle: {
        ...bundle,
        items: [
          baseEvidenceItem,
          {
            ...baseEvidenceItem,
            freshness: {
              observedAt: "2026-05-11T09:00:00.000Z",
              sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
              status: "stale" as const,
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
            score: 0.7,
            text: "Security controls require quarterly review.",
          },
        ],
      },
      evidenceItems,
      mode: "fast",
      normalized,
      result: generatedAnswer(normalized.text),
    });

    expect(flagged.metadata.quality).toEqual({
      alignment: {
        checker: "rule-based",
        checkedClaims: 3,
        evidenceReferences: 2,
        mode: "fast",
      },
      flags: ["ungrounded-claims", "stale-evidence"],
      staleEvidence: [
        {
          marker: "E2",
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
          observedAt: "2026-05-11T09:00:00.000Z",
          sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
          status: "stale",
        },
      ],
      staleEvidenceCount: 1,
      ungroundedClaimCount: 1,
      ungroundedClaims: [
        {
          evidenceMarkers: [],
          evidenceNodeIds: [],
          reason: "missing-citation",
          status: "ungrounded",
          text: "Uncited roadmap claim.",
        },
      ],
    });
    expect(flagged.text).toBe(normalized.text);
  });

  it("routes fast, deep, and research generation to configured model policies", async () => {
    const fastProvider = createRecordingLlmProvider("openai");
    const strongProvider = createRecordingLlmProvider("anthropic");
    const router = createLlmRouter({
      policies: {
        deep: { maxOutputTokens: 1024, model: "deep-model", provider: "strong" },
        fast: {
          maxOutputTokens: 256,
          model: "fast-model",
          provider: "fast",
          temperature: 0,
        },
        research: { maxOutputTokens: 2048, model: "research-model", provider: "strong" },
      },
      policyVersion: "llm-routing-v1",
      providers: {
        fast: fastProvider,
        strong: strongProvider,
      },
    });

    const fast = await router.generate({
      messages: [{ content: "short answer", role: "user" }],
      mode: "fast",
    });
    const deep = await router.generate({
      maxOutputTokens: 800,
      messages: [{ content: "deeper answer", role: "user" }],
      mode: "deep",
    });
    const research = await router.generate({
      messages: [{ content: "research answer", role: "user" }],
      mode: "research",
    });

    expect(fastProvider.generateCalls).toEqual([
      {
        maxOutputTokens: 256,
        messages: [{ content: "short answer", role: "user" }],
        model: "fast-model",
        temperature: 0,
      },
    ]);
    expect(strongProvider.generateCalls).toEqual([
      {
        maxOutputTokens: 800,
        messages: [{ content: "deeper answer", role: "user" }],
        model: "deep-model",
      },
      {
        maxOutputTokens: 2048,
        messages: [{ content: "research answer", role: "user" }],
        model: "research-model",
      },
    ]);
    expect(fast.metadata.routing).toEqual({
      mode: "fast",
      policyVersion: "llm-routing-v1",
      provider: "fast",
    });
    expect(deep.metadata.routing).toEqual({
      mode: "deep",
      policyVersion: "llm-routing-v1",
      provider: "strong",
    });
    expect(research.model).toBe("research-model");
  });

  it("falls back to configured LLM providers and marks degraded routing", async () => {
    const fallbackProvider = createRecordingLlmProvider("static");
    const primaryProvider: LlmProvider = {
      kind: "openai",
      generate: async () => {
        throw new Error("primary unavailable");
      },
      models: async () => [],
      stream: async function* () {
        yield* [] as LlmStreamEvent[];
        throw new Error("primary stream unavailable");
      },
    };
    const router = createLlmRouter({
      policies: {
        fast: {
          fallback: {
            maxOutputTokens: 128,
            model: "fallback-model",
            provider: "fallback",
          },
          maxOutputTokens: 256,
          model: "fast-model",
          provider: "primary",
        },
      },
      policyVersion: "llm-routing-v3",
      providers: {
        fallback: fallbackProvider,
        primary: primaryProvider,
      },
    });

    const generated = await router.generate({
      messages: [{ content: "answer", role: "user" }],
      mode: "fast",
    });
    const streamed: LlmStreamEvent[] = [];
    for await (const event of router.stream({
      messages: [{ content: "stream answer", role: "user" }],
      mode: "fast",
    })) {
      streamed.push(event);
    }

    expect(generated).toEqual({
      finishReason: "stop",
      metadata: {
        model: "fallback-model",
        provider: "static",
        routing: {
          degraded: true,
          fallbackFromProvider: "primary",
          fallbackReason: "Error",
          mode: "fast",
          policyVersion: "llm-routing-v3",
          provider: "fallback",
        },
      },
      model: "fallback-model",
      text: "static:fallback-model",
    });
    expect(fallbackProvider.generateCalls).toEqual([
      {
        maxOutputTokens: 128,
        messages: [{ content: "answer", role: "user" }],
        model: "fallback-model",
      },
    ]);
    expect(streamed.at(-1)).toEqual({
      finishReason: "stop",
      metadata: {
        model: "fallback-model",
        provider: "static",
        routing: {
          degraded: true,
          fallbackFromProvider: "primary",
          fallbackReason: "Error",
          mode: "fast",
          policyVersion: "llm-routing-v3",
          provider: "fallback",
        },
      },
      type: "done",
    });
    const inheritedFallback = createLlmRouter({
      policies: {
        fast: {
          fallback: {
            model: "fallback-model",
            provider: "fallback",
          },
          maxOutputTokens: 256,
          model: "fast-model",
          provider: "primary",
          temperature: 0.2,
        },
      },
      policyVersion: "llm-routing-v3",
      providers: {
        fallback: fallbackProvider,
        primary: primaryProvider,
      },
    });
    await inheritedFallback.generate({
      maxOutputTokens: 200,
      messages: [{ content: "inherit", role: "user" }],
      mode: "fast",
    });
    expect(fallbackProvider.generateCalls.at(-1)).toEqual({
      maxOutputTokens: 200,
      messages: [{ content: "inherit", role: "user" }],
      model: "fallback-model",
      temperature: 0.2,
    });
    await expect(
      createLlmRouter({
        policies: {
          fast: {
            maxOutputTokens: 256,
            model: "fast-model",
            provider: "primary",
          },
        },
        policyVersion: "llm-routing-v3",
        providers: { primary: primaryProvider },
      }).generate({
        messages: [{ content: "no fallback", role: "user" }],
        mode: "fast",
      }),
    ).rejects.toThrow("primary unavailable");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: {
            fallback: { model: "fallback-model", provider: "missing" },
            maxOutputTokens: 256,
            model: "fast-model",
            provider: "primary",
          },
        },
        policyVersion: "llm-routing-v3",
        providers: { primary: primaryProvider },
      }),
    ).toThrow("LLM route policy fast fallback references unknown provider missing");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: {
            fallback: { model: " ", provider: "fallback" },
            maxOutputTokens: 256,
            model: "fast-model",
            provider: "primary",
          },
        },
        policyVersion: "llm-routing-v3",
        providers: { fallback: fallbackProvider, primary: primaryProvider },
      }),
    ).toThrow("LLM route policy fast fallback model is required");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: {
            fallback: { maxOutputTokens: 0, model: "fallback-model", provider: "fallback" },
            maxOutputTokens: 256,
            model: "fast-model",
            provider: "primary",
          },
        },
        policyVersion: "llm-routing-v3",
        providers: { fallback: fallbackProvider, primary: primaryProvider },
      }),
    ).toThrow("LLM route policy fast fallback maxOutputTokens must be at least 1");
  });

  it("routes streaming generation and annotates the terminal event", async () => {
    const provider = createRecordingLlmProvider("openai");
    const router = createLlmRouter({
      defaultMode: "research",
      policies: {
        research: { maxOutputTokens: 2048, model: "research-model", provider: "primary" },
      },
      policyVersion: "llm-routing-v2",
      providers: { primary: provider },
    });

    const events: unknown[] = [];
    for await (const event of router.stream({
      messages: [{ content: "stream", role: "user" }],
    })) {
      events.push(event);
    }

    expect(provider.streamCalls).toEqual([
      {
        maxOutputTokens: 2048,
        messages: [{ content: "stream", role: "user" }],
        model: "research-model",
      },
    ]);
    expect(events).toEqual([
      { delta: "openai:research-model", type: "delta" },
      {
        finishReason: "stop",
        metadata: {
          model: "research-model",
          provider: "openai",
          routing: {
            mode: "research",
            policyVersion: "llm-routing-v2",
            provider: "primary",
          },
        },
        type: "done",
      },
    ]);
  });

  it("rejects invalid LLM routing configuration before provider calls", async () => {
    const provider = createRecordingLlmProvider("static");

    expect(() =>
      createLlmRouter({
        policies: {
          fast: { maxOutputTokens: 128, model: "fast-model", provider: "missing" },
        },
        policyVersion: "llm-routing-v1",
        providers: { primary: provider },
      }),
    ).toThrow("LLM route policy fast references unknown provider missing");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: { maxOutputTokens: 0, model: "fast-model", provider: "primary" },
        },
        policyVersion: "llm-routing-v1",
        providers: { primary: provider },
      }),
    ).toThrow("LLM route policy fast maxOutputTokens must be at least 1");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: { maxOutputTokens: 128, model: " ", provider: "primary" },
        },
        policyVersion: "llm-routing-v1",
        providers: { primary: provider },
      }),
    ).toThrow("LLM route policy fast model is required");
    expect(() =>
      createLlmRouter({
        policies: {
          fast: { maxOutputTokens: 128, model: "fast-model", provider: "primary" },
        },
        policyVersion: " ",
        providers: { primary: provider },
      }),
    ).toThrow("LLM router policyVersion is required");

    const router = createLlmRouter({
      policies: {
        fast: { maxOutputTokens: 128, model: "fast-model", provider: "primary" },
      },
      policyVersion: "llm-routing-v1",
      providers: { primary: provider },
    });
    await expect(
      router.generate({
        messages: [{ content: "unknown", role: "user" }],
        mode: "deep",
      }),
    ).rejects.toThrow("LLM route policy deep is not configured");
    expect(provider.generateCalls).toHaveLength(0);
  });

  it("packs context windows with explicit system, evidence, and output budgets", () => {
    const compute = createRecordingComputeRuntime();
    const packer = createContextWindowPacker({
      compute,
      defaultSafetyMarginTokens: 5,
    });

    const packed = packer.pack({
      contextWindowTokens: 100,
      evidenceBundle: evidenceBundle(),
      evidenceConfig: { maxItems: 8 },
      model: "gpt-test",
      outputTokens: 20,
      systemPrompt: "You answer with citations.",
    });

    expect(compute.packEvidenceCalls).toEqual([
      {
        config: { maxItems: 8 },
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        tokenBudget: 71,
      },
    ]);
    expect(packed).toEqual({
      budgets: {
        contextWindowTokens: 100,
        evidenceTokens: 3,
        outputTokens: 20,
        remainingTokens: 68,
        safetyMarginTokens: 5,
        systemTokens: 4,
      },
      model: "gpt-test",
      packedEvidence: {
        context: "[E1] Packed evidence.",
        items: [
          {
            citations: [],
            marker: "E1",
            nodeId: "node-a",
            score: 0.9,
            text: "Packed evidence.",
            tokens: 3,
          },
        ],
        model: "gpt-test",
        omitted: [],
        tokenBudget: 71,
        usedTokens: 3,
      },
      systemPrompt: "You answer with citations.",
    });
  });

  it("rejects impossible context window budgets before evidence packing", () => {
    const compute = createRecordingComputeRuntime();
    const packer = createContextWindowPacker({ compute });

    expect(() =>
      packer.pack({
        contextWindowTokens: 8,
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        outputTokens: 4,
        safetyMarginTokens: 1,
        systemPrompt: "system prompt takes four",
      }),
    ).toThrow("Context window budget leaves no room for evidence");
    expect(compute.packEvidenceCalls).toHaveLength(0);
    expect(() =>
      createContextWindowPacker({
        compute,
        defaultSafetyMarginTokens: -1,
      }),
    ).toThrow("Context window defaultSafetyMarginTokens must be non-negative");
    expect(() =>
      packer.pack({
        contextWindowTokens: 0,
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        outputTokens: 4,
        systemPrompt: "system",
      }),
    ).toThrow("Context window contextWindowTokens must be at least 1");
    expect(() =>
      packer.pack({
        contextWindowTokens: 64,
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        outputTokens: 0,
        systemPrompt: "system",
      }),
    ).toThrow("Context window outputTokens must be at least 1");
    expect(() =>
      packer.pack({
        contextWindowTokens: 64,
        evidenceBundle: evidenceBundle(),
        model: " ",
        outputTokens: 4,
        systemPrompt: "system",
      }),
    ).toThrow("Context window model is required");
    expect(() =>
      packer.pack({
        contextWindowTokens: 64,
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        outputTokens: 4,
        systemPrompt: " ",
      }),
    ).toThrow("Context window systemPrompt is required");
    expect(() =>
      packer.pack({
        contextWindowTokens: 64,
        evidenceBundle: evidenceBundle(),
        model: "gpt-test",
        outputTokens: 4,
        safetyMarginTokens: -1,
        systemPrompt: "system",
      }),
    ).toThrow("Context window safetyMarginTokens must be non-negative");
  });

  it("renders versioned evidence-driven prompt messages for fast, deep, and research modes", () => {
    const registry = createEvidencePromptTemplateRegistry();

    const fast = registry.render({
      evidenceBundle: evidenceBundle(),
      mode: "fast",
      packedContextWindow: packedContextWindow(),
      query: "What is packed?",
    });
    const deep = registry.render({
      evidenceBundle: { ...evidenceBundle(), state: "partial" },
      mode: "deep",
      packedContextWindow: packedContextWindow(),
      query: "Explain the packing behavior.",
    });
    const research = registry.render({
      evidenceBundle: { ...evidenceBundle(), state: "conflict" },
      mode: "research",
      packedContextWindow: packedContextWindow(),
      query: "Compare the evidence.",
    });

    expect(fast.metadata).toEqual({
      answerabilityState: "answerable",
      evidenceItemCount: 1,
      mode: "fast",
      omittedEvidenceCount: 1,
      templateId: "knowledge-answer-fast",
      templateVersion: "prompt-v1",
      usedEvidenceTokens: 3,
    });
    expect(fast.messages).toEqual([
      {
        content:
          "You are KnowledgeFS answer synthesis. Answer only from supplied evidence. Cite evidence markers like [E1]. If evidence is insufficient, say so plainly.",
        role: "system",
      },
      {
        content:
          "Answer briefly with citations.\n\nAnswerability state: answerable\nQuestion:\nWhat is packed?\n\nEvidence context:\n[E1] Packed evidence.\n\nOmitted evidence: node-b: token-budget\nToken budget: used 3 of 71",
        role: "user",
      },
    ]);
    expect(deep.metadata.templateId).toBe("knowledge-answer-deep");
    expect(deep.messages[1]?.content).toContain("Give a structured answer");
    expect(research.metadata.templateId).toBe("knowledge-answer-research");
    expect(research.messages[1]?.content).toContain("Compare evidence, call out conflicts");
  });

  it("rejects unsafe or unbounded prompt template inputs before rendering", () => {
    const registry = createEvidencePromptTemplateRegistry({
      maxEvidenceContextBytes: 8,
      maxQueryBytes: 8,
    });

    expect(() =>
      registry.render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: packedContextWindow(),
        query: "too long query",
      }),
    ).toThrow("Prompt template query exceeds maxQueryBytes=8");
    expect(() =>
      registry.render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: {
          ...packedContextWindow(),
          packedEvidence: {
            ...packedContextWindow().packedEvidence,
            context: "too long evidence",
          },
        },
        query: "short",
      }),
    ).toThrow("Prompt template evidence context exceeds maxEvidenceContextBytes=8");
    expect(() =>
      registry.render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: packedContextWindow(),
        query: " ",
      }),
    ).toThrow("Prompt template query is required");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "custom",
            mode: "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: "v1",
          },
          {
            id: "duplicate",
            mode: "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: "v1",
          },
        ],
      }),
    ).toThrow("Prompt template mode fast is already registered");
    expect(() => createEvidencePromptTemplateRegistry({ maxEvidenceContextBytes: 0 })).toThrow(
      "Prompt template maxEvidenceContextBytes must be at least 1",
    );
    expect(() => createEvidencePromptTemplateRegistry({ maxQueryBytes: 0 })).toThrow(
      "Prompt template maxQueryBytes must be at least 1",
    );
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: " ",
            mode: "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: "v1",
          },
        ],
      }),
    ).toThrow("Prompt template id is required");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "custom",
            mode: "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: " ",
          },
        ],
      }),
    ).toThrow("Prompt template version is required");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "custom",
            mode: "fastest" as "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: "v1",
          },
        ],
      }),
    ).toThrow("Prompt template mode fastest is not supported");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "custom",
            mode: "fast",
            render: () => [{ content: "ok", role: "user" }],
            version: "v1",
          },
        ],
      }).render({
        evidenceBundle: evidenceBundle(),
        mode: "deep",
        packedContextWindow: packedContextWindow(),
        query: "short",
      }),
    ).toThrow("Prompt template mode deep is not configured");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "empty",
            mode: "fast",
            render: () => [],
            version: "v1",
          },
        ],
      }).render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: packedContextWindow(),
        query: "short",
      }),
    ).toThrow("Prompt template must render at least one message");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "bad-role",
            mode: "fast",
            render: () => [{ content: "ok", role: "tool" as "user" }],
            version: "v1",
          },
        ],
      }).render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: packedContextWindow(),
        query: "short",
      }),
    ).toThrow("Prompt template message role tool is not supported");
    expect(() =>
      createEvidencePromptTemplateRegistry({
        templates: [
          {
            id: "blank",
            mode: "fast",
            render: () => [{ content: " ", role: "user" }],
            version: "v1",
          },
        ],
      }).render({
        evidenceBundle: evidenceBundle(),
        mode: "fast",
        packedContextWindow: packedContextWindow(),
        query: "short",
      }),
    ).toThrow("Prompt template message content is required");
  });

  it("renders empty evidence context and omitted evidence without leaking mutable messages", () => {
    const registry = createEvidencePromptTemplateRegistry();
    const context = {
      ...packedContextWindow(),
      packedEvidence: {
        ...packedContextWindow().packedEvidence,
        context: "",
        omitted: [],
      },
    };

    const rendered = registry.render({
      evidenceBundle: evidenceBundle(),
      mode: "fast",
      packedContextWindow: context,
      query: "What is missing?",
    });

    expect(rendered.messages[1]?.content).toContain("(no evidence provided)");
    expect(rendered.messages[1]?.content).toContain("Omitted evidence: none");
  });
});

describe("automatic golden question generation", () => {
  it("generates pending review proposals from bounded source nodes", async () => {
    const provider = createRecordingLlmProvider();
    provider.generate = async (input): Promise<GenerateTextResult> => {
      provider.generateCalls.push({
        ...input,
        messages: input.messages.map((message) => ({ ...message })),
      });

      return {
        finishReason: "stop",
        metadata: { model: input.model, provider: "static" },
        model: input.model,
        text: JSON.stringify({
          questions: [
            {
              expectedEvidenceIds: ["node-roadmap-1"],
              question: "What parser guardrail did the roadmap add?",
              tags: ["parser", "phase-6"],
            },
          ],
        }),
      };
    };
    const generator = createAutomaticGoldenQuestionGenerator({
      generateId: () => "proposal-1",
      model: "question-generator",
      now: () => "2026-05-12T18:10:00.000Z",
      provider,
    });

    const result = await generator.generate({
      knowledgeSpaceId: "space-1",
      sourceNodes: [
        {
          id: "node-roadmap-1",
          sectionPath: ["Roadmap"],
          text: "The roadmap added parser health checks and bounded upload intake.",
        },
      ],
      tags: ["evaluation"],
    });

    expect(result.proposals).toEqual([
      {
        createdAt: "2026-05-12T18:10:00.000Z",
        expectedEvidenceIds: ["node-roadmap-1"],
        id: "proposal-1",
        knowledgeSpaceId: "space-1",
        metadata: {
          generatedBy: {
            model: "question-generator",
            provider: "static",
          },
        },
        question: "What parser guardrail did the roadmap add?",
        sourceNodeIds: ["node-roadmap-1"],
        status: "pending_review",
        tags: ["evaluation", "parser", "phase-6"],
      },
    ]);
    expect(provider.generateCalls[0]).toMatchObject({
      maxOutputTokens: 800,
      model: "question-generator",
      temperature: 0.2,
    });
    expect(provider.generateCalls[0]?.messages.at(-1)?.content).toContain("node-roadmap-1");
  });

  it("requires approval before turning proposals into golden question inputs", () => {
    const workflow = createGoldenQuestionReviewWorkflow({
      now: () => "2026-05-12T18:20:00.000Z",
    });
    const proposal = {
      createdAt: "2026-05-12T18:10:00.000Z",
      expectedEvidenceIds: ["node-roadmap-1"],
      id: "proposal-1",
      knowledgeSpaceId: "space-1",
      metadata: { generatedBy: { model: "question-generator", provider: "static" as const } },
      question: "What parser guardrail did the roadmap add?",
      sourceNodeIds: ["node-roadmap-1"],
      status: "pending_review" as const,
      tags: ["evaluation"],
    };

    const approved = workflow.approve({
      proposal,
      reviewerId: "reviewer-1",
    });

    expect(approved).toMatchObject({
      goldenQuestion: {
        expectedEvidenceIds: ["node-roadmap-1"],
        knowledgeSpaceId: "space-1",
        metadata: {
          approvedAt: "2026-05-12T18:20:00.000Z",
          generatedQuestionProposalId: "proposal-1",
          reviewedBy: "reviewer-1",
        },
        question: "What parser guardrail did the roadmap add?",
        tags: ["evaluation"],
      },
      proposal: {
        reviewedAt: "2026-05-12T18:20:00.000Z",
        reviewerId: "reviewer-1",
        status: "approved",
      },
    });
    expect(() =>
      workflow.approve({
        proposal: { ...approved.proposal, status: "approved" },
        reviewerId: "reviewer-2",
      }),
    ).toThrow("Golden question proposal must be pending review");
    expect(
      workflow.reject({
        proposal,
        reason: "Too broad",
        reviewerId: "reviewer-1",
      }),
    ).toMatchObject({
      rejectionReason: "Too broad",
      status: "rejected",
    });
  });

  it("rejects unbounded inputs and invalid provider output", async () => {
    const provider = createRecordingLlmProvider();
    expect(() =>
      createAutomaticGoldenQuestionGenerator({
        maxQuestionsPerRun: 0,
        model: "question-generator",
        provider,
      }),
    ).toThrow("Golden question generation maxQuestionsPerRun must be at least 1");

    const generator = createAutomaticGoldenQuestionGenerator({
      maxQuestionsPerRun: 1,
      maxSourceNodes: 1,
      maxSourceTextBytes: 12,
      model: "question-generator",
      provider,
    });

    await expect(
      generator.generate({
        knowledgeSpaceId: " ",
        sourceNodes: [{ id: "node-1", text: "short" }],
      }),
    ).rejects.toThrow("Golden question generation knowledgeSpaceId is required");
    await expect(
      generator.generate({
        knowledgeSpaceId: "space-1",
        sourceNodes: [],
      }),
    ).rejects.toThrow("Golden question generation sourceNodes is required");
    await expect(
      generator.generate({
        knowledgeSpaceId: "space-1",
        maxQuestions: 0,
        sourceNodes: [{ id: "node-1", text: "short" }],
      }),
    ).rejects.toThrow("Golden question generation maxQuestions must be between 1 and 1");
    await expect(
      generator.generate({
        knowledgeSpaceId: "space-1",
        sourceNodes: [
          { id: "node-1", text: "short" },
          { id: "node-2", text: "short" },
        ],
      }),
    ).rejects.toThrow("Golden question generation sourceNodes exceeds maxSourceNodes=1");
    await expect(
      generator.generate({
        knowledgeSpaceId: "space-1",
        sourceNodes: [{ id: "node-1", text: "this text is too long" }],
      }),
    ).rejects.toThrow("Golden question generation source text exceeds maxSourceTextBytes=12");

    provider.generate = async (input) => ({
      finishReason: "stop",
      metadata: { model: input.model, provider: "static" },
      model: input.model,
      text: "not-json",
    });
    await expect(
      createAutomaticGoldenQuestionGenerator({
        model: "question-generator",
        provider,
      }).generate({
        knowledgeSpaceId: "space-1",
        sourceNodes: [{ id: "node-1", text: "source text" }],
      }),
    ).rejects.toThrow("Golden question generation response is invalid JSON");

    provider.generate = async (input) => ({
      finishReason: "stop",
      metadata: { model: input.model, provider: "static" },
      model: input.model,
      text: JSON.stringify({
        questions: [
          { expectedEvidenceIds: ["node-1"], question: "First?", tags: [] },
          { expectedEvidenceIds: ["node-1"], question: "Second?", tags: [] },
        ],
      }),
    });
    await expect(
      createAutomaticGoldenQuestionGenerator({
        maxQuestionsPerRun: 2,
        model: "question-generator",
        provider,
      }).generate({
        knowledgeSpaceId: "space-1",
        maxQuestions: 1,
        sourceNodes: [{ id: "node-1", text: "source text" }],
      }),
    ).rejects.toThrow("Golden question generation returned 2 questions over maxQuestions=1");

    provider.generate = async (input) => ({
      finishReason: "stop",
      metadata: { model: input.model, provider: "static" },
      model: input.model,
      text: JSON.stringify({
        questions: [
          {
            expectedEvidenceIds: ["missing-node"],
            question: "Which source is missing?",
            tags: [],
          },
        ],
      }),
    });
    await expect(
      createAutomaticGoldenQuestionGenerator({
        model: "question-generator",
        provider,
      }).generate({
        knowledgeSpaceId: "space-1",
        sourceNodes: [{ id: "node-1", text: "source text" }],
      }),
    ).rejects.toThrow("Golden question generation expectedEvidenceIds must reference source nodes");
  });
});

describe("generation cache and skip path", () => {
  it("caches generated answers by evidence, prompt template, model version, and generation parameters", async () => {
    const cache = createRecordingCache();
    const generationCache = createGenerationCache({
      cache,
      cacheVersion: "generation-cache-v1",
      ttlMs: 60_000,
    });
    const keyInput = generationCacheKeyInput();
    const result = generatedAnswer();

    expect(await generationCache.get(keyInput)).toBeNull();
    await generationCache.set(keyInput, result);

    const cached = await generationCache.get(keyInput);
    expect(cached).toEqual(result);
    expect(cache.keys.every((key) => !key.includes("What is packed?"))).toBe(true);
    expect(cache.keys.every((key) => !key.includes("Packed evidence."))).toBe(true);

    if (cached?.metadata.usage) {
      cached.metadata.usage.promptTokens = 999;
    }

    expect((await generationCache.get(keyInput))?.metadata.usage?.promptTokens).toBe(11);
    expect(
      await generationCache.get({
        ...keyInput,
        promptTemplateVersion: "prompt-v2",
      }),
    ).toBeNull();
  });

  it("bypasses generation cache for session-context prompts and rejects unsafe cache bounds", async () => {
    const cache = createRecordingCache();
    const generationCache = createGenerationCache({
      cache,
      maxEntryBytes: 64,
      ttlMs: 60_000,
    });

    await generationCache.set(
      {
        ...generationCacheKeyInput(),
        hasSessionContext: true,
      },
      generatedAnswer(),
    );

    expect(
      await generationCache.get({
        ...generationCacheKeyInput(),
        hasSessionContext: true,
      }),
    ).toBeNull();
    expect(cache.values.size).toBe(0);
    await expect(generationCache.set(generationCacheKeyInput(), generatedAnswer())).rejects.toThrow(
      "Generation cache entry exceeds maxEntryBytes=64",
    );
    await expect(
      generationCache.key({
        ...generationCacheKeyInput(),
        hasSessionContext: true,
      }),
    ).rejects.toThrow("Generation cache is disabled for session-context prompts");
    expect(() =>
      createGenerationCache({
        cache,
        cacheVersion: " ",
        ttlMs: 60_000,
      }),
    ).toThrow("Generation cache cacheVersion is required");
    expect(() =>
      createGenerationCache({
        cache,
        maxEntryBytes: 0,
        ttlMs: 60_000,
      }),
    ).toThrow("Generation cache maxEntryBytes must be at least 1");
    expect(() =>
      createGenerationCache({
        cache,
        ttlMs: 0,
      }),
    ).toThrow("Generation cache ttlMs must be at least 1");
  });

  it("ignores malformed or oversized cache entries and validates cache key inputs", async () => {
    const cache = createRecordingCache();
    const generationCache = createGenerationCache({
      cache,
      maxEntryBytes: 80,
      ttlMs: 60_000,
    });
    const keyInput = generationCacheKeyInput();
    const key = await generationCache.key(keyInput);

    cache.values.set(key, new TextEncoder().encode("{"));
    expect(await generationCache.get(keyInput)).toBeNull();
    cache.values.set(key, new Uint8Array(128));
    expect(await generationCache.get(keyInput)).toBeNull();

    const largeEntryCache = createGenerationCache({
      cache,
      maxEntryBytes: 512,
      ttlMs: 60_000,
    });
    await largeEntryCache.set(keyInput, {
      ...generatedAnswer(),
      metadata: {
        model: "gpt-test",
        provider: "openai",
      },
    });
    expect((await largeEntryCache.get(keyInput))?.metadata.usage).toBeUndefined();

    await expect(
      largeEntryCache.key({
        ...keyInput,
        promptTemplateId: " ",
      }),
    ).rejects.toThrow("Generation cache promptTemplateId is required");
    await expect(
      largeEntryCache.key({
        ...keyInput,
        promptTemplateVersion: " ",
      }),
    ).rejects.toThrow("Generation cache promptTemplateVersion is required");
    await expect(
      largeEntryCache.key({
        ...keyInput,
        model: " ",
      }),
    ).rejects.toThrow("Generation cache model is required");
    await expect(
      largeEntryCache.key({
        ...keyInput,
        modelVersion: " ",
      }),
    ).rejects.toThrow("Generation cache modelVersion is required");
    await expect(
      largeEntryCache.key({
        ...keyInput,
        generationParameters: { maxOutputTokens: 0 },
      }),
    ).rejects.toThrow("Generation cache maxOutputTokens must be at least 1");
    await expect(
      largeEntryCache.key({
        ...keyInput,
        generationParameters: { temperature: -1 },
      }),
    ).rejects.toThrow("Generation cache temperature must be non-negative");
  });

  it("uses cached generation results before calling providers and stores misses", async () => {
    const cache = createRecordingCache();
    const generationCache = createGenerationCache({ cache, ttlMs: 60_000 });
    const skipPath = createGenerationSkipPath({ cache: generationCache });
    const keyInput = generationCacheKeyInput();
    let calls = 0;

    await generationCache.set(keyInput, generatedAnswer("cached [E1]"));

    const cached = await skipPath.generate({
      cacheKey: keyInput,
      evidenceBundle: evidenceBundle(),
      generate: async () => {
        calls += 1;
        return generatedAnswer("provider [E1]");
      },
    });

    expect(cached).toEqual({
      cacheHit: true,
      generationSkipped: false,
      result: generatedAnswer("cached [E1]"),
      type: "generated",
    });
    expect(calls).toBe(0);

    const missed = await skipPath.generate({
      cacheKey: {
        ...keyInput,
        generationParameters: { ...keyInput.generationParameters, temperature: 0.1 },
      },
      evidenceBundle: evidenceBundle(),
      generate: async () => {
        calls += 1;
        return generatedAnswer("provider [E1]");
      },
    });

    expect(missed).toEqual({
      cacheHit: false,
      generationSkipped: false,
      result: generatedAnswer("provider [E1]"),
      type: "generated",
    });
    expect(calls).toBe(1);
  });

  it("skips generation and returns the EvidenceBundle for budget exhaustion or model unavailability", async () => {
    const skipPath = createGenerationSkipPath();
    let calls = 0;

    const budgetSkipped = await skipPath.generate({
      estimatedCostUsd: 0.03,
      evidenceBundle: evidenceBundle(),
      generate: async () => {
        calls += 1;
        return generatedAnswer();
      },
      remainingBudgetUsd: 0.01,
    });

    expect(budgetSkipped).toEqual({
      evidenceBundle: evidenceBundle(),
      generationSkipped: true,
      reason: "budget_exhausted",
      type: "skipped",
    });
    expect(calls).toBe(0);

    const unavailableSkipped = await skipPath.generate({
      evidenceBundle: evidenceBundle(),
      generate: async () => {
        throw new GenerationModelUnavailableError("model offline");
      },
    });

    expect(unavailableSkipped).toEqual({
      evidenceBundle: evidenceBundle(),
      generationSkipped: true,
      reason: "model_unavailable",
      type: "skipped",
    });
    await expect(
      skipPath.generate({
        estimatedCostUsd: -1,
        evidenceBundle: evidenceBundle(),
        generate: async () => generatedAnswer(),
      }),
    ).rejects.toThrow("Generation skip path estimatedCostUsd must be non-negative");
    await expect(
      skipPath.generate({
        evidenceBundle: evidenceBundle(),
        generate: async () => generatedAnswer(),
        remainingBudgetUsd: -1,
      }),
    ).rejects.toThrow("Generation skip path remainingBudgetUsd must be non-negative");
    await expect(
      createGenerationSkipPath().generate({
        estimatedCostUsd: 0.03,
        evidenceBundle: evidenceBundle(),
        generate: async () => generatedAnswer(),
      }),
    ).resolves.toEqual({
      cacheHit: false,
      generationSkipped: false,
      result: generatedAnswer(),
      type: "generated",
    });
    await expect(
      createGenerationSkipPath({ maxEstimatedCostUsd: 0.01 }).generate({
        estimatedCostUsd: 0.03,
        evidenceBundle: evidenceBundle(),
        generate: async () => {
          throw new Error("should not call provider");
        },
      }),
    ).resolves.toEqual({
      evidenceBundle: evidenceBundle(),
      generationSkipped: true,
      reason: "budget_exhausted",
      type: "skipped",
    });
    await expect(
      skipPath.generate({
        evidenceBundle: evidenceBundle(),
        generate: async () => {
          throw new Error("provider exploded");
        },
      }),
    ).rejects.toThrow("provider exploded");
    expect(() => createGenerationSkipPath({ maxEstimatedCostUsd: -1 })).toThrow(
      "Generation skip path maxEstimatedCostUsd must be non-negative",
    );
  });
});

function evidenceBundle() {
  return {
    createdAt: "2026-05-11T10:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
    items: [
      {
        citations: [
          {
            artifactHash: "a".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            documentVersion: 1,
            sectionPath: ["Intro"],
          },
        ],
        conflicts: [],
        freshness: { status: "fresh" as const },
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        score: 0.9,
        scores: {
          final: 0.9,
          retrieval: 0.9,
        },
        text: "Packed evidence.",
      },
    ],
    missingEvidence: [],
    query: "What is packed?",
    state: "answerable" as const,
  };
}

function generationCacheKeyInput() {
  return {
    evidenceBundle: evidenceBundle(),
    generationParameters: {
      maxOutputTokens: 512,
      mode: "fast" as const,
      temperature: 0,
    },
    model: "gpt-test",
    modelVersion: "2026-05-11",
    promptTemplateId: "knowledge-answer-fast",
    promptTemplateVersion: "prompt-v1",
    provider: "openai" as const,
  };
}

function generatedAnswer(text = "Generated answer [E1]."): GenerateTextResult {
  return {
    finishReason: "stop",
    metadata: {
      model: "gpt-test",
      provider: "openai",
      usage: {
        completionTokens: 7,
        promptTokens: 11,
        totalTokens: 18,
      },
    },
    model: "gpt-test",
    text,
  };
}

function packedContextWindow() {
  return {
    budgets: {
      contextWindowTokens: 100,
      evidenceTokens: 3,
      outputTokens: 20,
      remainingTokens: 68,
      safetyMarginTokens: 5,
      systemTokens: 4,
    },
    model: "gpt-test",
    packedEvidence: {
      context: "[E1] Packed evidence.",
      items: [
        {
          citations: [],
          marker: "E1",
          nodeId: "node-a",
          score: 0.9,
          text: "Packed evidence.",
          tokens: 3,
        },
      ],
      model: "gpt-test",
      omitted: [{ nodeId: "node-b", reason: "token-budget", tokens: 12 }],
      tokenBudget: 71,
      usedTokens: 3,
    },
    systemPrompt: "You are KnowledgeFS answer synthesis.",
  };
}

describe("generate input and router config validation", () => {
  it("rejects invalid generate inputs on the static provider", async () => {
    const provider = createStaticLlmProvider({ model: "static-model", response: "ok" });

    await expect(
      provider.generate({ messages: [{ content: "hi", role: "user" }], model: " " }),
    ).rejects.toThrow("LLM model is required");
    await expect(provider.generate({ messages: [], model: "static-model" })).rejects.toThrow(
      "must include at least one message",
    );
    await expect(
      provider.generate({
        messages: Array.from({ length: 65 }, () => ({ content: "m", role: "user" as const })),
        model: "static-model",
      }),
    ).rejects.toThrow(/exceeds maxMessages=/u);
    await expect(
      provider.generate({
        messages: [{ content: "x".repeat(600 * 1024), role: "user" }],
        model: "static-model",
      }),
    ).rejects.toThrow(/exceeds maxTextBytes=/u);
  });

  it("rejects invalid router configuration", () => {
    const provider = createStaticLlmProvider({ model: "static-model", response: "ok" });
    const policy = { maxOutputTokens: 256, model: "static-model", provider: "primary" };

    expect(() =>
      createLlmRouter({
        policies: { fast: policy },
        policyVersion: " ",
        providers: { primary: provider },
      }),
    ).toThrow("policyVersion is required");
    expect(() =>
      createLlmRouter({
        defaultMode: "deep",
        policies: { fast: policy },
        policyVersion: "v1",
        providers: { primary: provider },
      }),
    ).toThrow("LLM route policy deep is not configured");
    expect(() =>
      createLlmRouter({
        policies: { fast: { ...policy, provider: "missing" } },
        policyVersion: "v1",
        providers: { primary: provider },
      }),
    ).toThrow("references unknown provider missing");
    expect(() =>
      createLlmRouter({
        policies: { fast: { ...policy, model: " " } },
        policyVersion: "v1",
        providers: { primary: provider },
      }),
    ).toThrow("model is required");
    expect(() =>
      createLlmRouter({
        policies: { fast: { ...policy, maxOutputTokens: 0 } },
        policyVersion: "v1",
        providers: { primary: provider },
      }),
    ).toThrow(/maxOutputTokens/u);
  });
});
