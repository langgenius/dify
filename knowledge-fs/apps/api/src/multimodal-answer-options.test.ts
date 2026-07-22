import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it } from "vitest";

import { createApiMultimodalAnswerOptions } from "./multimodal-answer-options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createApiMultimodalAnswerOptions", () => {
  it("leaves multimodal answer generation disabled by default or explicitly off", () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    expect(
      createApiMultimodalAnswerOptions({ env: {}, objectStorage: adapter.objectStorage }),
    ).toEqual({});
    expect(
      createApiMultimodalAnswerOptions({
        env: { KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER: "off" },
        objectStorage: adapter.objectStorage,
      }),
    ).toEqual({});
  });

  it("creates a Dify-backed multimodal answer provider", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const requests: Request[] = [];
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
    });
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      expect(request.url).toBe("http://localhost:5001/inner/api/invoke/llm");

      return difyLlmResponse([
        {
          data: { delta: { message: { content: "Chart answer." } }, model: "gpt-vision-2026" },
          error: "",
        },
        { data: { delta: { finish_reason: "stop" } }, error: "" },
      ]);
    }) as typeof fetch;

    const options = createApiMultimodalAnswerOptions({
      env: {
        KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL: "high",
        KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_ATTACHMENTS: "2",
        KNOWLEDGE_MULTIMODAL_ANSWER_MAX_OUTPUT_TOKENS: "256",
        KNOWLEDGE_MULTIMODAL_ANSWER_MODEL: "gpt-vision",
        KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID: "langgenius/openai",
        KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_PROVIDER: "openai",
        KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER: "dify-model-runtime",
      },
      objectStorage: adapter.objectStorage,
    });

    await expect(
      options.multimodalAnswerProvider?.generate({
        evidence: [],
        multimodalEvidence: [
          {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/documents/doc/assets/chart.png",
              variants: {
                thumbnail: {
                  contentType: "image/png",
                  objectKey: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
                },
              },
            },
            documentAssetId: "doc-1",
            modality: "image",
            parseElementId: "chart-1",
            sectionPath: ["Charts"],
          },
        ],
        query: "What does the chart show?",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      metadata: { imageBlockCount: 1, provider: "dify-model-runtime" },
      text: "Chart answer.",
    });
    const payload = (await requests[0]?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      completion_params: { max_tokens: 256, temperature: 0 },
      model: "gpt-vision",
      model_type: "llm",
      provider: "langgenius/openai/openai",
    });
    expect(payload).not.toHaveProperty("credentials");
    const promptJson = JSON.stringify(payload.prompt_messages);
    expect(promptJson).toContain('"type":"image"');
    expect(promptJson).toContain('"base64_data":"AQID"');
    expect(promptJson).toContain('"mime_type":"image/png"');
    expect(promptJson).toContain('"format":"png"');
    expect(promptJson).toContain('"detail":"high"');
    expect(promptJson).toContain('"type":"text"');
    // dify text parts carry the text in `data` (not OpenAI's `text`).
    expect(promptJson).toContain('"data":"');
  });

  it("validates multimodal answer environment values", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    expect(() =>
      createApiMultimodalAnswerOptions({
        env: { KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER: "plugin-daemon" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ANSWER_MODEL is required for multimodal answer generation");
    expect(() =>
      createApiMultimodalAnswerOptions({
        env: { KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER: "local" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER must be dify-model-runtime");
    expect(() =>
      createApiMultimodalAnswerOptions({
        env: {
          KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL: "full",
          KNOWLEDGE_MULTIMODAL_ANSWER_MODEL: "gpt-vision",
          KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID: "langgenius/openai",
          KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_PROVIDER: "openai",
          KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER: "plugin-daemon",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL must be auto, high, or low");
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
