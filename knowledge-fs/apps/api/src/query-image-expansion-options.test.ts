import type { ConcurrencyGate } from "@knowledge/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiQueryImageExpansionProvider } from "./query-image-expansion-options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createApiQueryImageExpansionProvider", () => {
  it("uses the frozen reasoning model for one structured vision expansion", async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return difyLlmResponse([
        {
          data: {
            delta: {
              message: {
                content: JSON.stringify({
                  description: "An invoice",
                  keywords: ["invoice", "total"],
                  ocrText: "TOTAL 42",
                }),
              },
            },
            model: "vision-2026",
          },
          error: "",
        },
        { data: { delta: { finish_reason: "stop" } }, error: "" },
      ]);
    }) as typeof fetch;
    const modelGateRun = vi.fn();
    const modelRequestGate: ConcurrencyGate = {
      run: async (operation) => {
        modelGateRun();
        return operation();
      },
    };
    const provider = createApiQueryImageExpansionProvider(
      {
        DIFY_INNER_API_KEY: "inner-key",
        DIFY_INNER_API_URL: "http://api:5001",
      },
      modelRequestGate,
    );

    await expect(
      provider.expand({
        images: [
          {
            body: new Uint8Array([1, 2, 3]),
            byteSize: 3,
            mimeType: "image/png",
            sha256: "a".repeat(64),
            uploadFileId: "00000000-0000-4000-8000-000000000001",
          },
        ],
        model: { model: "vision", pluginId: "langgenius/openai", provider: "openai" },
        query: "find total",
        tenantId: "tenant-1",
        traceId: "trace-1",
      }),
    ).resolves.toMatchObject({
      description: "An invoice",
      keywords: ["invoice", "total"],
      metadata: { model: "vision-2026", provider: "openai" },
      ocrText: "TOTAL 42",
    });

    const payload = (await requests[0]?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      completion_params: { max_tokens: 512, temperature: 0 },
      model: "vision",
      model_type: "llm",
      provider: "langgenius/openai/openai",
    });
    const prompt = JSON.stringify(payload.prompt_messages);
    expect(prompt).toContain("Optional text query: find total");
    expect(prompt).toContain('"base64_data":"AQID"');
    expect(modelGateRun).toHaveBeenCalledOnce();
  });

  it("rejects invalid structured output and timeout configuration", async () => {
    globalThis.fetch = (async () =>
      difyLlmResponse([
        { data: { delta: { message: { content: '{"description":"missing fields"}' } } } },
      ])) as typeof fetch;
    const provider = createApiQueryImageExpansionProvider({});
    await expect(
      provider.expand({
        images: [],
        model: { model: "vision", pluginId: "organization/plugin", provider: "provider" },
        query: "query",
        tenantId: "tenant",
        traceId: "trace",
      }),
    ).rejects.toThrow("required contract");
    expect(() =>
      createApiQueryImageExpansionProvider({ KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS: "0" }),
    ).toThrow("must be a positive integer");
  });

  it("propagates the owning retrieval cancellation into the Dify model request", async () => {
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal | undefined;
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
            once: true,
          });
        }),
    ) as typeof fetch;
    const provider = createApiQueryImageExpansionProvider({
      DIFY_INNER_API_KEY: "inner-key",
      DIFY_INNER_API_URL: "http://api:5001",
    });
    const controller = new AbortController();
    const canceled = new Error("retrieval lease lost");
    const pending = provider.expand({
      images: [],
      model: { model: "vision", pluginId: "organization/plugin", provider: "provider" },
      query: "query",
      signal: controller.signal,
      tenantId: "tenant",
      traceId: "trace",
    });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    controller.abort(canceled);

    await expect(pending).rejects.toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toBe(canceled);
  });
});

function difyLlmResponse(frames: readonly unknown[]): Response {
  const encoded = frames.map(lengthPrefixedFrame);
  const body = new Uint8Array(encoded.reduce((sum, frame) => sum + frame.byteLength, 0));
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
