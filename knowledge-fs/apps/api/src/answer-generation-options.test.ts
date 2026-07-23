import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiAnswerGenerationOptions,
  createApiProfileReasoningCapability,
} from "./answer-generation-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiAnswerGenerationOptions", () => {
  it("stays disabled (extractive answers) unless a Dify model runtime is selected", () => {
    expect(createApiAnswerGenerationOptions({})).toBeUndefined();
    expect(createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "off" })).toBeUndefined();
  });

  it("configures default and knowledge-space Dify answer providers", async () => {
    const options = createApiAnswerGenerationOptions({
      KNOWLEDGE_ANSWER_MODEL: "gpt-4.1-mini",
      KNOWLEDGE_ANSWER_PLUGIN_ID: "langgenius/openai",
      KNOWLEDGE_ANSWER_PLUGIN_PROVIDER: "openai",
      KNOWLEDGE_ANSWER_PROVIDER: "dify-model-runtime",
    });

    expect(options?.model).toBe("gpt-4.1-mini");
    expect(options?.maxOutputTokens).toBe(1_024);
    expect(options?.provider.kind).toBe("dify-model-runtime");
    const selected = options?.providerFactory({
      model: "claude-space-a",
      pluginId: "langgenius/anthropic",
      provider: "anthropic",
    });
    expect(selected?.kind).toBe("dify-model-runtime");
    await expect(selected?.models()).resolves.toEqual([
      expect.objectContaining({ id: "claude-space-a", provider: "dify-model-runtime" }),
    ]);
  });

  it("never includes model credentials in Dify LLM requests", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return difyLlmResponse([
        { data: { delta: { message: { content: "ok" } } }, error: "" },
        { data: { delta: { finish_reason: "stop" } }, error: "" },
      ]);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const options = createApiAnswerGenerationOptions({
      KNOWLEDGE_ANSWER_MODEL: "legacy-model",
      KNOWLEDGE_ANSWER_PLUGIN_ID: "vendor/reasoning",
      KNOWLEDGE_ANSWER_PLUGIN_PROVIDER: "vendor",
      KNOWLEDGE_ANSWER_PROVIDER: "dify-model-runtime",
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

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.every((body) => !("credentials" in body))).toBe(true);
    expect(requestBodies.map((body) => body.provider)).toEqual([
      "vendor/reasoning/vendor",
      "vendor/reasoning/vendor",
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
    expect(selected.kind).toBe("dify-model-runtime");
    await expect(selected.models()).resolves.toEqual([
      expect.objectContaining({ id: "space-chat-v3", provider: "dify-model-runtime" }),
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
      KNOWLEDGE_ANSWER_PROVIDER: "dify-model-runtime",
    });

    expect(options?.model).toBe("gpt-4.1");
    expect(options?.maxOutputTokens).toBe(2_048);
  });

  it("requires Dify model routing config and rejects unknown providers", () => {
    expect(() =>
      createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "dify-model-runtime" }),
    ).toThrow("KNOWLEDGE_ANSWER_MODEL is required for answer generation");
    expect(() =>
      createApiAnswerGenerationOptions({ KNOWLEDGE_ANSWER_PROVIDER: "mistral" }),
    ).toThrow("KNOWLEDGE_ANSWER_PROVIDER must be dify-model-runtime");
  });
});

function difyLlmResponse(frames: readonly unknown[]): Response {
  const encoded = frames.map(lengthPrefixedFrame);
  const total = encoded.reduce((sum, frame) => sum + frame.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const frame of encoded) {
    body.set(frame, offset);
    offset += frame.byteLength;
  }
  return new Response(body, { status: 200 });
}

function lengthPrefixedFrame(value: unknown): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  const frame = new Uint8Array(14 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 0x0f);
  view.setUint16(2, 10, true);
  view.setUint32(4, payload.byteLength, true);
  frame.set(payload, 14);
  return frame;
}
