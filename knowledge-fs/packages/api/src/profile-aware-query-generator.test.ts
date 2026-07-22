import { describe, expect, it, vi } from "vitest";

import type {
  QueryGenerationEvent,
  QueryGenerationInput,
  QueryGenerator,
} from "./gateway-sse-responses";
import {
  ReasoningCapabilityUnavailableError,
  createProfileAwareQueryGenerator,
} from "./profile-aware-query-generator";

const INPUT: QueryGenerationInput = {
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  mode: "fast",
  permissionScope: ["knowledge-spaces:read"],
  query: "What is the warranty?",
  subject: {
    scopes: ["knowledge-spaces:read"],
    subjectId: "user-1",
    tenantId: "tenant-1",
  },
  traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
};

const PROFILE = {
  defaultMode: "fast" as const,
  reasoningModel: {
    model: "space-chat-v2",
    pluginId: "vendor/chat",
    provider: "vendor",
  },
  rerank: { enabled: false },
  revision: 2,
  scoreThreshold: { enabled: false, stage: "rerank" as const },
  topK: 5,
};

describe("profile-aware query generator", () => {
  it("requires the dynamic LLM path whenever a retrieval profile is configured", async () => {
    const extractive = recordingGenerator("extractive");
    const legacy = recordingGenerator("legacy-llm");
    const profile = recordingGenerator("profile-llm");
    const generator = createProfileAwareQueryGenerator({
      extractiveGenerator: extractive.generator,
      legacyLlmGenerator: legacy.generator,
      profileLlmGenerator: profile.generator,
    });

    await expect(drain(generator, { ...INPUT, retrievalProfile: PROFILE })).resolves.toEqual([
      expect.objectContaining({ delta: "profile-llm", type: "delta" }),
    ]);
    expect(profile.stream).toHaveBeenCalledOnce();
    expect(legacy.stream).not.toHaveBeenCalled();
    expect(extractive.stream).not.toHaveBeenCalled();
  });

  it("preserves the deployment-level legacy LLM for spaces without a profile", async () => {
    const extractive = recordingGenerator("extractive");
    const legacy = recordingGenerator("legacy-llm");
    const generator = createProfileAwareQueryGenerator({
      extractiveGenerator: extractive.generator,
      legacyLlmGenerator: legacy.generator,
    });

    await expect(drain(generator, INPUT)).resolves.toEqual([
      expect.objectContaining({ delta: "legacy-llm", type: "delta" }),
    ]);
    expect(legacy.stream).toHaveBeenCalledOnce();
    expect(extractive.stream).not.toHaveBeenCalled();
  });

  it("preserves extractive answers for spaces without a profile or legacy LLM", async () => {
    const extractive = recordingGenerator("extractive");
    const generator = createProfileAwareQueryGenerator({
      extractiveGenerator: extractive.generator,
    });

    await expect(drain(generator, INPUT)).resolves.toEqual([
      expect.objectContaining({ delta: "extractive", type: "delta" }),
    ]);
    expect(extractive.stream).toHaveBeenCalledOnce();
  });

  it("fails closed instead of falling back when profile reasoning is unavailable", async () => {
    const extractive = recordingGenerator("extractive");
    const legacy = recordingGenerator("legacy-llm");
    const generator = createProfileAwareQueryGenerator({
      extractiveGenerator: extractive.generator,
      legacyLlmGenerator: legacy.generator,
    });

    await expect(drain(generator, { ...INPUT, retrievalProfile: PROFILE })).rejects.toEqual(
      expect.objectContaining({
        message:
          "Knowledge-space reasoning model is configured, but dynamic reasoning is unavailable",
        name: "ReasoningCapabilityUnavailableError",
      }),
    );
    expect(extractive.stream).not.toHaveBeenCalled();
    expect(legacy.stream).not.toHaveBeenCalled();
  });

  it("does not mask failures from the dynamic reasoning path", async () => {
    const extractive = recordingGenerator("extractive");
    const failure = new Error("plugin-daemon capability unavailable");
    const profileLlmGenerator: QueryGenerator = {
      stream: async function* () {
        const unreachable = await Promise.reject<QueryGenerationEvent>(failure);
        yield unreachable;
      },
    };
    const generator = createProfileAwareQueryGenerator({
      extractiveGenerator: extractive.generator,
      profileLlmGenerator,
    });

    await expect(drain(generator, { ...INPUT, retrievalProfile: PROFILE })).rejects.toBe(failure);
    expect(extractive.stream).not.toHaveBeenCalled();
  });

  it("exposes a dedicated error class for capability failures", () => {
    expect(new ReasoningCapabilityUnavailableError("unavailable")).toMatchObject({
      message: "unavailable",
      name: "ReasoningCapabilityUnavailableError",
    });
  });
});

function recordingGenerator(delta: string): {
  readonly generator: QueryGenerator;
  readonly stream: ReturnType<typeof vi.fn>;
} {
  const stream = vi.fn(async function* () {
    yield { delta, type: "delta" as const };
  });

  return { generator: { stream }, stream };
}

async function drain(
  generator: QueryGenerator,
  input: QueryGenerationInput,
): Promise<QueryGenerationEvent[]> {
  const events: QueryGenerationEvent[] = [];

  for await (const event of generator.stream(input)) {
    events.push(event);
  }

  return events;
}
