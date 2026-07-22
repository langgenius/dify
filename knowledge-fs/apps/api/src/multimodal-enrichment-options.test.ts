import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it } from "vitest";

import { createApiMultimodalEnrichmentOptions } from "./multimodal-enrichment-options";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const manifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createApiMultimodalEnrichmentOptions", () => {
  it("leaves multimodal enrichment disabled by default or explicitly off", () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    expect(
      createApiMultimodalEnrichmentOptions({ env: {}, objectStorage: adapter.objectStorage }),
    ).toEqual({});
    expect(
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "off" },
        objectStorage: adapter.objectStorage,
      }),
    ).toEqual({});
  });

  it("creates a Dify-backed multimodal manifest enhancer", async () => {
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
          data: {
            delta: {
              message: {
                content: JSON.stringify({
                  caption: "Renewal chart",
                  ocrText: "Q1 renewal increased 12%",
                  summary: "The chart shows renewal growth.",
                  title: "Renewal growth",
                }),
              },
            },
          },
          error: "",
        },
      ]);
    }) as typeof fetch;

    const options = createApiMultimodalEnrichmentOptions({
      env: {
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL: "low",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS: "1",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS: "128",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL: "gpt-vision",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID: "langgenius/openai",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER: "openai",
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "dify-model-runtime",
      },
      objectStorage: adapter.objectStorage,
    });

    const enhanced = await options.documentMultimodalManifestEnhancer?.enhance({
      manifest: {
        artifactHash: "a".repeat(64),
        createdAt: "2026-06-24T00:00:00.000Z",
        documentAssetId,
        id: manifestId,
        items: [
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
            enrichment: {
              asset: "provided",
              caption: "missing",
              ocr: "missing",
              tableStructure: "unsupported",
              visualEmbedding: "missing",
            },
            id: "item-1",
            modality: "image",
            parseElementId: "image-1",
            sectionPath: ["Charts"],
            sourceMetadata: { chartTitle: "Renewals" },
          },
        ],
        knowledgeSpaceId,
        manifestVersion: "document-multimodal-manifest-v1",
        metadata: {},
        parseArtifactId,
        version: 1,
      },
      parseArtifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-24T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "image-1",
            metadata: {},
            sectionPath: ["Charts"],
            text: "Chart source text",
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      },
      tenantId: "tenant-1",
    });

    expect(enhanced?.items[0]).toMatchObject({
      caption: "Renewal chart",
      ocrText: "Q1 renewal increased 12%",
      textPreview: "The chart shows renewal growth.",
      title: "Renewal growth",
    });
    expect(enhanced?.items[0]?.sourceMetadata).toMatchObject({
      enrichment: {
        provider: "dify-model-runtime",
        status: "provided",
        task: "chart",
      },
    });
    const payload = (await requests[0]?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      completion_params: { max_tokens: 128, temperature: 0 },
      model: "gpt-vision",
    });
    expect(payload).not.toHaveProperty("credentials");
    const promptJson = JSON.stringify(payload.prompt_messages);
    expect(promptJson).toContain('"type":"image"');
    expect(promptJson).toContain('"base64_data":"AQID"');
    expect(promptJson).toContain('"mime_type":"image/png"');
    expect(promptJson).toContain('"format":"png"');
    expect(promptJson).toContain('"detail":"low"');
  });

  it("validates multimodal enrichment environment values", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "plugin-daemon" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL is required for multimodal enrichment");
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "local" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER must be dify-model-runtime");
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: {
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL: "full",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL: "gpt-vision",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID: "langgenius/openai",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER: "openai",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "plugin-daemon",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL must be auto, high, or low");
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
