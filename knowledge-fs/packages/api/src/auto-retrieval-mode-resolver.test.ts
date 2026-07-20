import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  AUTO_RETRIEVAL_MODE_PROMPT_VERSION,
  AutoRetrievalModeResolutionError,
  type GenerateRetrievalModeTextInput,
  createLlmAutoRetrievalModeResolver,
  resolveRetrievalModeRequest,
} from "./auto-retrieval-mode-resolver";
import { createInMemoryTraceRecorder } from "./tracing";

const reasoningModel: KnowledgeSpaceModelSelection = {
  model: "space-reasoning-model",
  pluginId: "vendor/reasoning-plugin",
  provider: "vendor",
};

describe("LLM auto retrieval mode resolver", () => {
  it("uses the space-selected plugin-daemon route and returns strict structured provenance", async () => {
    const generate = vi.fn(async (_input: GenerateRetrievalModeTextInput) => ({
      finishReason: "stop",
      metadata: {
        provider: "plugin-daemon",
        usage: { completionTokens: 9, promptTokens: 123, totalTokens: 132 },
      },
      model: reasoningModel.model,
      text: '{"mode":"research","reasonCode":"structured_research"}',
    }));
    const traces = createInMemoryTraceRecorder();
    const resolver = createLlmAutoRetrievalModeResolver({
      providerFactory: (selection) => {
        expect(selection).toEqual(reasoningModel);
        return { generate, kind: "plugin-daemon" };
      },
      traces,
    });

    await expect(
      resolver.resolve({
        defaultMode: "fast",
        query: "比较多个文档中的证据并说明差异",
        reasoningModel,
        tenantId: "tenant-a",
        traceId: "query-run-a",
      }),
    ).resolves.toEqual({
      finishReason: "stop",
      generationModel: reasoningModel.model,
      mode: "research",
      promptVersion: AUTO_RETRIEVAL_MODE_PROMPT_VERSION,
      provider: "plugin-daemon",
      reasonCode: "structured_research",
      usage: { completionTokens: 9, promptTokens: 123, totalTokens: 132 },
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 64,
        model: reasoningModel.model,
        temperature: 0,
        tenantId: "tenant-a",
      }),
    );
    const input = generate.mock.calls[0]?.[0];
    expect(input?.messages[0]?.content).toContain(
      "Do not choose a mode only because of the query language",
    );
    expect(input?.messages[1]?.content).toBe(
      JSON.stringify({ defaultMode: "fast", query: "比较多个文档中的证据并说明差异" }),
    );
    expect(traces.spans).toEqual([
      {
        attributes: expect.objectContaining({
          model: reasoningModel.model,
          pluginId: reasoningModel.pluginId,
          promptVersion: AUTO_RETRIEVAL_MODE_PROMPT_VERSION,
          provider: reasoningModel.provider,
          reasonCode: "structured_research",
          resolvedMode: "research",
          traceId: "query-run-a",
        }),
        name: "retrieval.auto_mode.resolve",
        status: "ok",
      },
    ]);
    expect(JSON.stringify(traces.spans)).not.toContain("多个文档");
  });

  it("accepts one JSON code fence but rejects invalid or mismatched decisions", async () => {
    const fenced = createLlmAutoRetrievalModeResolver({
      providerFactory: () => ({
        generate: async () => ({
          model: reasoningModel.model,
          text: '```json\n{"mode":"deep","reasonCode":"relationship_exploration"}\n```',
        }),
      }),
    });
    await expect(
      fenced.resolve({
        defaultMode: "fast",
        query: "Trace the dependency chain between these entities",
        reasoningModel,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ mode: "deep", reasonCode: "relationship_exploration" });

    for (const text of [
      "not-json",
      '{"mode":"research","reasonCode":"direct_lookup"}',
      '{"mode":"fast","reasonCode":"direct_lookup","extra":true}',
    ]) {
      const invalid = createLlmAutoRetrievalModeResolver({
        providerFactory: () => ({
          generate: async () => ({ model: reasoningModel.model, text }),
        }),
      });
      await expect(
        invalid.resolve({
          defaultMode: "fast",
          query: "query",
          reasoningModel,
          tenantId: "tenant-a",
        }),
      ).rejects.toBeInstanceOf(AutoRetrievalModeResolutionError);
    }
  });

  it("bypasses the LLM for explicit modes and falls back to the frozen default on LLM failure", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("provider secret must not escape");
    });

    await expect(
      resolveRetrievalModeRequest({
        fallbackMode: "research",
        query: "direct lookup",
        requestedMode: "fast",
        resolver: { resolve },
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({
      degraded: false,
      requestedMode: "fast",
      resolvedMode: "fast",
      resolver: "explicit",
    });
    expect(resolve).not.toHaveBeenCalled();

    const fallback = await resolveRetrievalModeRequest({
      fallbackMode: "research",
      query: "ambiguous query",
      reasoningModel,
      requestedMode: "auto",
      resolver: { resolve },
      tenantId: "tenant-a",
    });
    expect(fallback).toMatchObject({
      degraded: true,
      errorClass: "Error",
      requestedMode: "auto",
      resolvedMode: "research",
      resolver: "fallback",
    });
    expect(JSON.stringify(fallback)).not.toContain("provider secret");
  });

  it("times out once and never falls back when the caller-owned signal is canceled", async () => {
    const blockingProvider = () => ({
      // A provider adapter may fail to honor AbortSignal. The resolver's own race must still
      // enforce its wall-clock timeout and caller cancellation.
      generate: async () => new Promise<never>(() => undefined),
    });
    const resolver = createLlmAutoRetrievalModeResolver({
      providerFactory: blockingProvider,
      timeoutMs: 5,
    });
    await expect(
      resolveRetrievalModeRequest({
        fallbackMode: "fast",
        query: "query",
        reasoningModel,
        requestedMode: "auto",
        resolver,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ degraded: true, resolvedMode: "fast", resolver: "fallback" });

    const caller = new AbortController();
    caller.abort();
    await expect(
      resolveRetrievalModeRequest({
        fallbackMode: "fast",
        query: "query",
        reasoningModel,
        requestedMode: "auto",
        resolver,
        signal: caller.signal,
        tenantId: "tenant-a",
      }),
    ).rejects.toBeInstanceOf(AutoRetrievalModeResolutionError);
  });

  it("validates bounds and rejects a response from a different model identity", async () => {
    expect(() =>
      createLlmAutoRetrievalModeResolver({
        maxOutputTokens: 0,
        providerFactory: () => ({
          generate: async () => ({ text: "{}" }),
        }),
      }),
    ).toThrow("maxOutputTokens must be a positive integer");
    expect(() =>
      createLlmAutoRetrievalModeResolver({
        providerFactory: () => ({ generate: async () => ({ text: "{}" }) }),
        timeoutMs: 0,
      }),
    ).toThrow("timeoutMs must be a positive integer");

    const resolver = createLlmAutoRetrievalModeResolver({
      providerFactory: () => ({
        generate: async () => ({
          model: "different-model",
          text: '{"mode":"fast","reasonCode":"direct_lookup"}',
        }),
      }),
    });
    await expect(
      resolver.resolve({
        defaultMode: "fast",
        query: "query",
        reasoningModel,
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("did not match the selected reasoning model");
  });
});
