import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiAnswerGenerationOptions,
  createApiProfileReasoningCapability,
} from "./answer-generation-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiAnswerGenerationOptions", () => {
  it("stays disabled (extractive answers) unless plugin-daemon is selected", () => {
    expect(createApiAnswerGenerationOptions({})).toBeUndefined();
    expect(createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "off" })).toBeUndefined();
  });

  it("configures default and knowledge-space plugin-daemon answer providers", async () => {
    const options = createApiAnswerGenerationOptions({
      KNOWLEDGE_ANSWER_MODEL: "gpt-4.1-mini",
      KNOWLEDGE_ANSWER_PLUGIN_ID: "langgenius/openai",
      KNOWLEDGE_ANSWER_PLUGIN_PROVIDER: "openai",
      KNOWLEDGE_ANSWER_PROVIDER: "plugin-daemon",
    });

    expect(options?.model).toBe("gpt-4.1-mini");
    expect(options?.maxOutputTokens).toBe(1_024);
    expect(options?.provider.kind).toBe("plugin-daemon");
    const selected = options?.providerFactory({
      model: "claude-space-a",
      pluginId: "langgenius/anthropic",
      provider: "anthropic",
    });
    expect(selected?.kind).toBe("plugin-daemon");
    await expect(selected?.models()).resolves.toEqual([
      expect.objectContaining({ id: "claude-space-a", provider: "plugin-daemon" }),
    ]);
  });

  it("never forwards deployment credentials through the per-space reasoning factory", async () => {
    const requestBodies: Array<{ data?: { credentials?: unknown } }> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { data?: { credentials?: unknown } });
      return new Response(
        [
          `data: ${JSON.stringify({
            code: 0,
            data: { delta: { message: { content: "ok" } } },
            message: "",
          })}`,
          `data: ${JSON.stringify({
            code: 0,
            data: { delta: { finish_reason: "stop" } },
            message: "",
          })}`,
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);
    const options = createApiAnswerGenerationOptions({
      KNOWLEDGE_ANSWER_MODEL: "legacy-model",
      KNOWLEDGE_ANSWER_PLUGIN_CREDENTIALS_JSON: JSON.stringify({ apiKey: "deployment-secret" }),
      KNOWLEDGE_ANSWER_PLUGIN_ID: "vendor/reasoning",
      KNOWLEDGE_ANSWER_PLUGIN_PROVIDER: "vendor",
      KNOWLEDGE_ANSWER_PROVIDER: "plugin-daemon",
    });
    if (!options) throw new Error("Expected answer generation options");
    const generate = (provider: typeof options.provider, model: string, tenantId: string) =>
      provider.generate({
        maxOutputTokens: 16,
        messages: [{ content: "q", role: "user" }],
        model,
        temperature: 0,
        tenantId,
      });

    await generate(options.provider, "legacy-model", "tenant-1");
    await generate(
      options.providerFactory({
        model: "space-model",
        pluginId: "vendor/reasoning",
        provider: "vendor",
      }),
      "space-model",
      "tenant-2",
    );

    expect(requestBodies.map((body) => body.data?.credentials)).toEqual([
      { apiKey: "deployment-secret" },
      {},
    ]);
  });

  it("exposes profile reasoning independently of the legacy answer-provider switch", async () => {
    const capability = createApiProfileReasoningCapability({
      KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS: "1536",
      KNOWLEDGE_ANSWER_PROVIDER: "off",
    });
    const selected = capability.providerFactory({
      model: "space-chat-v3",
      pluginId: "langgenius/anthropic",
      provider: "anthropic",
    });

    expect(capability.maxOutputTokens).toBe(1_536);
    expect(selected.kind).toBe("plugin-daemon");
    await expect(selected.models()).resolves.toEqual([
      expect.objectContaining({ id: "space-chat-v3", provider: "plugin-daemon" }),
    ]);
  });

  it("keeps production answer assembly profile-scoped without a deployment model fallback", async () => {
    const { readFile } = await import("node:fs/promises");
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(indexSource).toContain("createApiProfileReasoningCapability");
    expect(indexSource).toContain(
      "reasoningProviderFactory: profileReasoningCapability.providerFactory",
    );
    expect(indexSource).not.toContain("createApiAnswerGenerationOptions()");
    expect(indexSource).not.toContain("legacyLlmGenerator:");
    expect(indexSource).not.toContain("model: answerGenerationOptions.model");
  });

  it("honors explicit output-token overrides", () => {
    const options = createApiAnswerGenerationOptions({
      KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS: "2048",
      KNOWLEDGE_ANSWER_MODEL: "gpt-4.1",
      KNOWLEDGE_ANSWER_PLUGIN_ID: "langgenius/openai",
      KNOWLEDGE_ANSWER_PLUGIN_PROVIDER: "openai",
      KNOWLEDGE_ANSWER_PROVIDER: "plugin-daemon",
    });

    expect(options?.model).toBe("gpt-4.1");
    expect(options?.maxOutputTokens).toBe(2_048);
  });

  it("requires plugin-daemon config and rejects unknown providers", () => {
    expect(() =>
      createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "plugin-daemon" }),
    ).toThrow("KNOWLEDGE_ANSWER_MODEL is required for answer generation");
    expect(() =>
      createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "mistral" }),
    ).toThrow("KNOWLEDGE_ANSWER_PROVIDER must be plugin-daemon or off");
  });
});
