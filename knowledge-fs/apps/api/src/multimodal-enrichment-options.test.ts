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

function sseResponse(chunks: readonly Record<string, unknown>[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

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

  it("creates a plugin-daemon object-backed multimodal manifest enhancer", async () => {
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
      expect(request.url).toBe("http://localhost:5002/plugin/tenant-1/dispatch/llm/invoke");

      return sseResponse([
        {
          code: 0,
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
          message: "",
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
        KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "plugin-daemon",
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
        provider: "plugin-daemon",
        status: "provided",
        task: "chart",
      },
    });
    const payload = (await requests[0]?.json()) as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      model: "gpt-vision",
      model_parameters: { max_tokens: 128, temperature: 0 },
    });
    const promptJson = JSON.stringify(payload.data.prompt_messages);
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
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER must be plugin-daemon or off");
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
