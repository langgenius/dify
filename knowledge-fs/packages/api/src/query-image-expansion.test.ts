import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { QueryGenerationInput, QueryGenerator } from "./gateway-sse-responses";
import {
  QueryImageExpansionUnavailableError,
  createQueryImageAwareQueryGenerator,
} from "./query-image-expansion";

const IMAGE_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE: KnowledgeSpaceRetrievalProfile = {
  defaultMode: "research",
  reasoningModel: { model: "vision-llm", pluginId: "plugin", provider: "provider" },
  rerank: { enabled: false },
  revision: 1,
  scoreThreshold: { enabled: false, stage: "mode-final" },
  topK: 10,
};

describe("createQueryImageAwareQueryGenerator", () => {
  it("passes through text-only requests without manufacturing an image array", async () => {
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
    });

    await collect(wrapped, {
      ...input({ mode: "deep", query: "invoice" }),
      resolvedQueryImages: undefined,
    });

    expect(observed[0]?.resolvedQueryImages).toBeUndefined();
  });

  it("keeps Fast model-call free", async () => {
    const expand = vi.fn();
    const observed: QueryGenerationInput[] = [];
    const generator = capturingGenerator(observed);
    const wrapped = createQueryImageAwareQueryGenerator({ generator, provider: { expand } });

    await collect(wrapped, input({ mode: "fast", query: "", retrievalProfile: PROFILE }));

    expect(expand).not.toHaveBeenCalled();
    expect(observed[0]?.retrievalQuery).toBeUndefined();
  });

  it("expands once, persists the result, and preserves the original query", async () => {
    const expand = vi.fn(async () => ({
      description: "A red invoice",
      keywords: ["invoice", "red"],
      ocrText: "TOTAL 42",
    }));
    const persist = vi.fn(async () => undefined);
    const before = vi.fn(async () => undefined);
    const after = vi.fn(async () => undefined);
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
      provider: { expand },
    });

    const events = await collect(
      wrapped,
      input({
        mode: "research",
        onQueryImageExpansion: persist,
        query: "find total",
        researchModelCallObserver: { after, before },
      }),
    );

    expect(expand).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(before).toHaveBeenCalledWith(expect.objectContaining({ step: "query.image-expand" }));
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", step: "query.image-expand" }),
    );
    expect(observed[0]?.query).toBe("find total");
    expect(observed[0]?.retrievalQuery).toContain("find total");
    expect(observed[0]?.retrievalQuery).toContain("Image OCR: TOTAL 42");
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "trace-step" })]),
    );
  });

  it("forwards provider metadata to durable accounting and the trace", async () => {
    const metadata = { model: "vision-llm", usage: { totalTokens: 12 } };
    const after = vi.fn(async () => undefined);
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: {
        expand: async () => ({
          description: "invoice",
          keywords: [],
          metadata,
          ocrText: "",
        }),
      },
    });

    const events = await collect(
      wrapped,
      input({ researchModelCallObserver: { after, before: async () => undefined } }),
    );

    expect(after).toHaveBeenCalledWith(expect.objectContaining({ metadata }));
    expect(events).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({
          metadata: expect.objectContaining({ providerMetadata: metadata }),
        }),
        type: "trace-step",
      }),
    );
  });

  it("rejects an empty vision expansion for pure-image Research", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: {
        expand: async () => ({ description: " ", keywords: ["", "  "], ocrText: " " }),
      },
    });

    await expect(collect(wrapped, input({ mode: "research", query: "" }))).rejects.toThrow(
      "Pure-image Research requires a vision-capable reasoning model",
    );
  });

  it("fails closed when durable model-call reservation fails", async () => {
    const expand = vi.fn();
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: { expand },
    });

    await expect(
      collect(
        wrapped,
        input({
          query: "invoice",
          researchModelCallObserver: {
            after: async () => undefined,
            before: async () => Promise.reject(new Error("budget unavailable")),
          },
        }),
      ),
    ).rejects.toThrow("Research model call reservation failed");
    expect(expand).not.toHaveBeenCalled();
  });

  it("reuses a durable expansion without another VLM call", async () => {
    const expand = vi.fn();
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
      provider: { expand },
    });

    await collect(
      wrapped,
      input({ mode: "research", query: "", queryImageExpansion: "Image OCR: cached" }),
    );

    expect(expand).not.toHaveBeenCalled();
    expect(observed[0]?.retrievalQuery).toBe("Image OCR: cached");
  });

  it("fails pure-image Research but lets a mixed Deep query degrade", async () => {
    const provider = { expand: vi.fn(async () => Promise.reject(new Error("no vision"))) };
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider,
    });

    await expect(collect(wrapped, input({ mode: "research", query: "" }))).rejects.toBeInstanceOf(
      QueryImageExpansionUnavailableError,
    );
    await expect(collect(wrapped, input({ mode: "deep", query: "invoice" }))).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: expect.objectContaining({ status: "error" }) }),
        expect.objectContaining({
          metadata: {
            queryImageDegradationReasons: ["query-image-ignored-no-vision-model"],
          },
          type: "done",
        }),
      ]),
    );
  });

  it("records timeout and non-Error expansion failures as typed mixed-query degradation", async () => {
    const timeout = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: {
        expand: async () => {
          const { QueryImageExpansionTimeoutError } = await import("./query-image-expansion");
          throw new QueryImageExpansionTimeoutError();
        },
      },
    });
    const nonError = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: { expand: async () => Promise.reject("vision unavailable") },
    });

    const timeoutEvents = await collect(timeout, input({ mode: "deep", query: "invoice" }));
    const nonErrorEvents = await collect(nonError, input({ mode: "deep", query: "invoice" }));

    expect(timeoutEvents).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({
          metadata: expect.objectContaining({ degradationReason: "query-image-expansion-timeout" }),
        }),
      }),
    );
    expect(nonErrorEvents).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({
          metadata: expect.objectContaining({ errorClass: "string" }),
        }),
      }),
    );
  });

  it("allows Deep pure-image visual retrieval to continue without a text expansion", async () => {
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
    });

    const events = await collect(wrapped, input({ mode: "deep", query: "" }));

    expect(observed[0]?.retrievalQuery).toBeUndefined();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: { queryImageDegradationReasons: ["query-image-ignored-no-vision-model"] },
        type: "done",
      }),
    );
  });

  it("requires a configured expansion provider for pure-image Research", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({ generator: capturingGenerator([]) });

    await expect(collect(wrapped, input({ mode: "research", query: "" }))).rejects.toThrow(
      "Pure-image Research requires a configured vision expansion provider",
    );
  });

  it("merges a degradation reason with existing terminal metadata without duplicates", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: {
        stream: async function* () {
          yield {
            finishReason: "stop",
            metadata: {
              queryImageDegradationReasons: ["existing", "query-image-ignored-no-vision-model"],
            },
            type: "done" as const,
          };
        },
      },
    });

    const events = await collect(wrapped, input({ mode: "deep", query: "invoice" }));

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: {
          queryImageDegradationReasons: ["existing", "query-image-ignored-no-vision-model"],
        },
      }),
    );
  });
});

function input(overrides: Partial<QueryGenerationInput>): QueryGenerationInput {
  return {
    knowledgeSpaceId: "00000000-0000-4000-8000-000000000002",
    mode: "research",
    permissionScope: [],
    query: "",
    resolvedQueryImages: [
      {
        body: new Uint8Array([1, 2, 3]),
        byteSize: 3,
        mimeType: "image/png",
        sha256: "a".repeat(64),
        uploadFileId: IMAGE_ID,
      },
    ],
    retrievalProfile: PROFILE,
    subject: { scopes: [], subjectId: "dify-account:actor", tenantId: "tenant" },
    traceId: "00000000-0000-4000-8000-000000000003",
    ...overrides,
  };
}

function capturingGenerator(observed: QueryGenerationInput[]): QueryGenerator {
  return {
    stream: async function* (input) {
      observed.push(input);
      yield { finishReason: "stop", type: "done" };
    },
  };
}

async function collect(generator: QueryGenerator, input: QueryGenerationInput) {
  const events = [];
  for await (const event of generator.stream(input)) events.push(event);
  return events;
}
