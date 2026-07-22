import type { DifyLlmInput, DifyModelRuntimeClient } from "@knowledge/dify-model-runtime-client";
import { describe, expect, it } from "vitest";

import { ProviderInputError, createDifyModelRuntimeLlmProvider } from "./index";

function fakeClient(
  onInvoke: (input: DifyLlmInput) => readonly unknown[],
  capture?: (input: DifyLlmInput) => void,
): DifyModelRuntimeClient {
  return {
    invokeLlm: (input) => {
      capture?.(input);
      const chunks = onInvoke(input);

      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
    invokeMultimodalEmbedding: async () => undefined,
    invokeRerank: async () => undefined,
    invokeTextEmbedding: async () => undefined,
    listModels: async () => ({ items: [] }),
  };
}

const BASE = {
  model: "gpt-4.1-mini",
  pluginId: "langgenius/openai",
  provider: "openai",
} as const;

function deltaChunk(content: string): unknown {
  return { delta: { message: { content } } };
}

describe("Dify model runtime LLM provider", () => {
  it("streams delta events then a done event with usage, and maps the request", async () => {
    let captured: DifyLlmInput | undefined;
    const provider = createDifyModelRuntimeLlmProvider({
      ...BASE,
      client: fakeClient(
        () => [
          { delta: { message: { content: "Hel" } }, model: "gpt-4.1-mini-2025" },
          deltaChunk("lo"),
          { delta: { finish_reason: "stop", usage: { completion_tokens: 2, prompt_tokens: 5 } } },
        ],
        (input) => {
          captured = input;
        },
      ),
    });

    const events: unknown[] = [];

    for await (const event of provider.stream({
      maxOutputTokens: 100,
      messages: [
        { content: "You are helpful.", role: "system" },
        { content: "Hi", role: "user" },
      ],
      model: BASE.model,
      temperature: 0.7,
      tenantId: "tenant-abc",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { delta: "Hel", type: "delta" },
      { delta: "lo", type: "delta" },
      {
        finishReason: "stop",
        metadata: {
          model: "gpt-4.1-mini-2025",
          provider: "dify-model-runtime",
          usage: { completionTokens: 2, promptTokens: 5 },
        },
        type: "done",
      },
    ]);
    expect(captured).toMatchObject({
      completionParams: { max_tokens: 100, temperature: 0.7 },
      model: "gpt-4.1-mini",
      pluginId: "langgenius/openai",
      promptMessages: [
        { content: "You are helpful.", role: "system" },
        { content: "Hi", role: "user" },
      ],
      provider: "openai",
      tenantId: "tenant-abc",
    });
  });

  it("aggregates the stream into a generate() result", async () => {
    const provider = createDifyModelRuntimeLlmProvider({
      ...BASE,
      client: fakeClient(() => [
        deltaChunk("The "),
        deltaChunk("answer"),
        { delta: { finish_reason: "stop" } },
      ]),
    });

    const result = await provider.generate({
      messages: [{ content: "Q", role: "user" }],
      model: BASE.model,
      tenantId: "tenant-abc",
    });

    expect(result).toMatchObject({
      finishReason: "stop",
      metadata: { provider: "dify-model-runtime" },
      text: "The answer",
    });
  });

  it("requires a per-call tenantId and validates constructor options", async () => {
    const provider = createDifyModelRuntimeLlmProvider({
      ...BASE,
      client: fakeClient(() => []),
    });

    const stream = provider.stream({
      messages: [{ content: "Q", role: "user" }],
      model: BASE.model,
    });

    await expect(stream.next()).rejects.toBeInstanceOf(ProviderInputError);

    expect(() =>
      createDifyModelRuntimeLlmProvider({ ...BASE, client: fakeClient(() => []), pluginId: "  " }),
    ).toThrow(ProviderInputError);

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({
        id: BASE.model,
        provider: "dify-model-runtime",
        supportsStreaming: true,
      }),
    ]);
  });

  it("validates construction and per-call inputs", async () => {
    const client = fakeClient(() => []);

    expect(() => createDifyModelRuntimeLlmProvider({ ...BASE, client, pluginId: " " })).toThrow(
      "pluginId is required",
    );
    expect(() => createDifyModelRuntimeLlmProvider({ ...BASE, client, provider: " " })).toThrow(
      "provider is required",
    );
    expect(() => createDifyModelRuntimeLlmProvider({ ...BASE, client, model: " " })).toThrow(
      "model is required",
    );

    const provider = createDifyModelRuntimeLlmProvider({ ...BASE, client });
    await expect(
      provider.generate({ messages: [{ content: "hi", role: "user" }], model: " ", tenantId: "t" }),
    ).rejects.toThrow("model is required");
    await expect(
      provider.generate({ messages: [{ content: "hi", role: "user" }], model: "gpt-4.1-mini" }),
    ).rejects.toThrow("requires a tenantId");
  });

  it("threads model parameters, skips unparseable chunks, and maps partial usage", async () => {
    let captured: DifyLlmInput | undefined;
    const provider = createDifyModelRuntimeLlmProvider({
      ...BASE,
      client: fakeClient(
        () => [
          "garbage-chunk",
          deltaChunk("Hi"),
          { delta: { finish_reason: "length", usage: { total_tokens: 9 } } },
        ],
        (input) => {
          captured = input;
        },
      ),
    });

    const result = await provider.generate({
      maxOutputTokens: 64,
      messages: [{ content: "hi", role: "user" }],
      model: "gpt-4.1-mini",
      temperature: 0.2,
      tenantId: "tenant-1",
    });

    expect(result.text).toBe("Hi");
    expect(result.finishReason).toBe("length");
    expect(result.metadata.usage).toEqual({ totalTokens: 9 });
    expect(captured?.completionParams).toEqual({ max_tokens: 64, temperature: 0.2 });
  });
});
