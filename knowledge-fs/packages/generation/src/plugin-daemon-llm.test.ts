import type { PluginDaemonClient, PluginDaemonDispatchInput } from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import { ProviderInputError, createPluginDaemonLlmProvider } from "./index";

function fakeClient(
  onDispatch: (input: PluginDaemonDispatchInput) => readonly unknown[],
  capture?: (input: PluginDaemonDispatchInput) => void,
): PluginDaemonClient {
  return {
    dispatchDatasourceStream: () =>
      (async function* () {
        // unused by the LLM adapter
      })(),
    dispatchStream: (input) => {
      capture?.(input);
      const chunks = onDispatch(input);

      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
    dispatchUnary: async () => {
      throw new Error("unused by the LLM adapter");
    },
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

describe("createPluginDaemonLlmProvider", () => {
  it("streams delta events then a done event with usage, and maps the request", async () => {
    let captured: PluginDaemonDispatchInput | undefined;
    const provider = createPluginDaemonLlmProvider({
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
          provider: "plugin-daemon",
          usage: { completionTokens: 2, promptTokens: 5 },
        },
        type: "done",
      },
    ]);
    expect(captured).toMatchObject({
      data: {
        credentials: {},
        model: "gpt-4.1-mini",
        model_parameters: { max_tokens: 100, temperature: 0.7 },
        model_type: "llm",
        prompt_messages: [
          { content: "You are helpful.", role: "system" },
          { content: "Hi", role: "user" },
        ],
        provider: "openai",
        stream: true,
      },
      op: "llm",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
    });
  });

  it("aggregates the stream into a generate() result", async () => {
    const provider = createPluginDaemonLlmProvider({
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
      metadata: { provider: "plugin-daemon" },
      text: "The answer",
    });
  });

  it("requires a per-call tenantId and validates constructor options", async () => {
    const provider = createPluginDaemonLlmProvider({
      ...BASE,
      client: fakeClient(() => []),
    });

    const stream = provider.stream({
      messages: [{ content: "Q", role: "user" }],
      model: BASE.model,
    });

    await expect(stream.next()).rejects.toBeInstanceOf(ProviderInputError);

    expect(() =>
      createPluginDaemonLlmProvider({ ...BASE, client: fakeClient(() => []), pluginId: "  " }),
    ).toThrow(ProviderInputError);

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({ id: BASE.model, provider: "plugin-daemon", supportsStreaming: true }),
    ]);
  });

  it("validates construction and per-call inputs", async () => {
    const client = fakeClient(() => []);

    expect(() => createPluginDaemonLlmProvider({ ...BASE, client, pluginId: " " })).toThrow(
      "pluginId is required",
    );
    expect(() => createPluginDaemonLlmProvider({ ...BASE, client, provider: " " })).toThrow(
      "provider is required",
    );
    expect(() => createPluginDaemonLlmProvider({ ...BASE, client, model: " " })).toThrow(
      "model is required",
    );

    const provider = createPluginDaemonLlmProvider({ ...BASE, client });
    await expect(
      provider.generate({ messages: [{ content: "hi", role: "user" }], model: " ", tenantId: "t" }),
    ).rejects.toThrow("model is required");
    await expect(
      provider.generate({ messages: [{ content: "hi", role: "user" }], model: "gpt-4.1-mini" }),
    ).rejects.toThrow("requires a tenantId");
  });

  it("threads model parameters, skips unparseable chunks, and maps partial usage", async () => {
    let captured: PluginDaemonDispatchInput | undefined;
    const provider = createPluginDaemonLlmProvider({
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
    const data = captured?.data as { model_parameters: Record<string, unknown> };
    expect(data.model_parameters).toEqual({ max_tokens: 64, temperature: 0.2 });
  });
});
