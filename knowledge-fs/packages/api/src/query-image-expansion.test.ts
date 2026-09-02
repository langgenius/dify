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

  it("does not load bytes for a mixed text query when the selected space is text-only", async () => {
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
    });

    const events = await collect(wrapped, {
      ...input({
        embeddingInputModalities: ["text"],
        query: "find this diagram",
        reasoningInputModalities: ["text"],
        resolvedQueryImages: undefined,
      }),
      queryImages: [{ uploadFileId: IMAGE_ID }],
    });

    expect(observed[0]?.resolvedQueryImages).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({
          metadata: expect.objectContaining({
            degradationReason: "query-image-ignored-no-vision-model",
            imageCount: 1,
          }),
          status: "skipped",
        }),
      }),
    );
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: {
          queryImageDegradationReasons: ["query-image-ignored-no-vision-model"],
        },
      }),
    );
  });

  it("rejects unresolved image bytes when the selected space claims vision capability", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({ generator: capturingGenerator([]) });

    await expect(
      collect(wrapped, {
        ...input({
          embeddingInputModalities: ["text", "image"],
          query: "find this diagram",
          resolvedQueryImages: undefined,
        }),
        queryImages: [{ uploadFileId: IMAGE_ID }],
      }),
    ).rejects.toThrow("Query image bytes are unavailable for a vision-capable knowledge space");
  });

  it("rejects an unresolved pure-image request for a text-only space", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({ generator: capturingGenerator([]) });

    await expect(
      collect(wrapped, {
        ...input({
          embeddingInputModalities: ["text"],
          query: "",
          reasoningInputModalities: ["text"],
          resolvedQueryImages: undefined,
        }),
        queryImages: [{ uploadFileId: IMAGE_ID }],
      }),
    ).rejects.toThrow(
      "Pure-image retrieval requires a vision-capable embedding or reasoning model",
    );
  });

  it("keeps Fast model-call free when direct visual retrieval is available", async () => {
    const expand = vi.fn();
    const observed: QueryGenerationInput[] = [];
    const generator = capturingGenerator(observed);
    const wrapped = createQueryImageAwareQueryGenerator({ generator, provider: { expand } });

    await collect(
      wrapped,
      input({
        embeddingInputModalities: ["text", "image"],
        mode: "fast",
        query: "find this",
        retrievalProfile: PROFILE,
      }),
    );

    expect(expand).not.toHaveBeenCalled();
    expect(observed[0]?.retrievalQuery).toBeUndefined();
  });

  it("expands a mixed Fast query when only the reasoning model can see the image", async () => {
    const expand = vi.fn(async () => ({
      description: "A circuit diagram",
      keywords: ["circuit"],
      ocrText: "R1 10K",
    }));
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
      provider: { expand },
    });

    await collect(
      wrapped,
      input({
        embeddingInputModalities: ["text"],
        mode: "fast",
        query: "find this component",
        reasoningInputModalities: ["text", "image"],
      }),
    );

    expect(expand).toHaveBeenCalledOnce();
    expect(observed[0]?.retrievalQuery).toContain("find this component");
    expect(observed[0]?.retrievalQuery).toContain("Image OCR: R1 10K");
  });

  it("expands a pure-image Fast query when the embedding profile is text-only", async () => {
    const expand = vi.fn(async () => ({
      description: "A circuit diagram",
      keywords: ["circuit"],
      ocrText: "R1 10K",
    }));
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
      provider: { expand },
    });

    await collect(
      wrapped,
      input({
        embeddingInputModalities: ["text"],
        mode: "fast",
        query: "",
        reasoningInputModalities: ["text", "image"],
      }),
    );

    expect(expand).toHaveBeenCalledOnce();
    expect(observed[0]?.retrievalQuery).toContain("Image OCR: R1 10K");
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
        reasoningInputModalities: ["text", "image"],
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
      input({
        reasoningInputModalities: ["text", "image"],
        researchModelCallObserver: { after, before: async () => undefined },
      }),
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

    await expect(
      collect(
        wrapped,
        input({ mode: "research", query: "", reasoningInputModalities: ["text", "image"] }),
      ),
    ).rejects.toThrow(
      "Pure-image retrieval requires a vision-capable embedding or reasoning model",
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
          reasoningInputModalities: ["text", "image"],
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

    await expect(
      collect(
        wrapped,
        input({ mode: "research", query: "", reasoningInputModalities: ["text", "image"] }),
      ),
    ).rejects.toBeInstanceOf(QueryImageExpansionUnavailableError);
    await expect(
      collect(
        wrapped,
        input({ mode: "deep", query: "invoice", reasoningInputModalities: ["text", "image"] }),
      ),
    ).resolves.toEqual(
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

    const timeoutEvents = await collect(
      timeout,
      input({ mode: "deep", query: "invoice", reasoningInputModalities: ["text", "image"] }),
    );
    const nonErrorEvents = await collect(
      nonError,
      input({ mode: "deep", query: "invoice", reasoningInputModalities: ["text", "image"] }),
    );

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

  it("allows Deep pure-image visual retrieval without a misleading degradation", async () => {
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
    });

    const events = await collect(
      wrapped,
      input({ embeddingInputModalities: ["text", "image"], mode: "deep", query: "" }),
    );

    expect(observed[0]?.retrievalQuery).toBeUndefined();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "done" }));
    expect(events.at(-1)).not.toHaveProperty("metadata.queryImageDegradationReasons");
  });

  it("requires a vision-capable reasoning model for pure-image Research", async () => {
    const wrapped = createQueryImageAwareQueryGenerator({ generator: capturingGenerator([]) });

    await expect(collect(wrapped, input({ mode: "research", query: "" }))).rejects.toThrow(
      "Pure-image retrieval requires a vision-capable embedding or reasoning model",
    );
  });

  it("does not call the expansion provider for a text-only reasoning profile", async () => {
    const expand = vi.fn();
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator([]),
      provider: { expand },
    });

    await collect(
      wrapped,
      input({ mode: "deep", query: "invoice", reasoningInputModalities: ["text"] }),
    );

    expect(expand).not.toHaveBeenCalled();
  });

  it("propagates cancellation instead of degrading into a text-only query", async () => {
    const controller = new AbortController();
    const aborted = new Error("retrieval lease lost");
    const observed: QueryGenerationInput[] = [];
    const wrapped = createQueryImageAwareQueryGenerator({
      generator: capturingGenerator(observed),
      provider: {
        expand: async ({ signal }) => {
          controller.abort(aborted);
          signal?.throwIfAborted();
          return { description: "unexpected", keywords: [], ocrText: "" };
        },
      },
    });

    await expect(
      collect(wrapped, input({ mode: "deep", query: "invoice", signal: controller.signal })),
    ).rejects.toBe(aborted);
    expect(observed).toHaveLength(0);
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
    reasoningInputModalities: ["text", "image"],
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
