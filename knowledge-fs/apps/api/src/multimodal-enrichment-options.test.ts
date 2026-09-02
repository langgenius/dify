import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import type { ConcurrencyGate } from "@knowledge/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiMultimodalEnrichmentOptions,
  createApiProfileMultimodalEnrichmentOptions,
} from "./multimodal-enrichment-options";

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
    const objectStorage = memoryObjectStorage();

    expect(createApiMultimodalEnrichmentOptions({ env: {}, objectStorage })).toEqual({});
    expect(
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "off" },
        objectStorage,
      }),
    ).toEqual({});
  });

  it("creates a Dify-backed multimodal manifest enhancer", async () => {
    const objectStorage = memoryObjectStorage();
    const requests: Request[] = [];
    await objectStorage.putObject({
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
      objectStorage,
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
    const objectStorage = memoryObjectStorage();
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "dify-model-runtime" },
        objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL is required for multimodal enrichment");
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "local" },
        objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER must be dify-model-runtime");
    expect(() =>
      createApiMultimodalEnrichmentOptions({
        env: {
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL: "full",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL: "gpt-vision",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID: "langgenius/openai",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER: "openai",
          KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER: "dify-model-runtime",
        },
        objectStorage,
      }),
    ).toThrow("KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL must be auto, high, or low");
  });

  it("skips VLM enrichment when the active reasoning model is text-only", async () => {
    const objectStorage = memoryObjectStorage();
    const resolve = async () => runtimeSnapshot(["text"]);
    const options = createApiProfileMultimodalEnrichmentOptions({
      env: {},
      modelInputModalityResolver: { resolve: async () => ["text"] },
      objectStorage,
      runtimeSnapshots: { assertReady: async () => undefined, resolve },
    });

    const enhanced = await options.documentMultimodalManifestEnhancer?.enhance({
      manifest: manifestFixture(),
      parseArtifact: parseArtifactFixture(),
      tenantId: "tenant-1",
    });

    expect(enhanced?.metadata.enrichment).toMatchObject({
      attemptedItems: 0,
      model: `profile-reasoning:sha256:${"b".repeat(64)}:text`,
      skippedReason: "reasoning-model-text-only",
    });
  });

  it("fails closed for an older invalid capability snapshot instead of invoking the VLM", async () => {
    const objectStorage = memoryObjectStorage();
    const resolveModalities = vi.fn();
    const enhancer = createApiProfileMultimodalEnrichmentOptions({
      env: {},
      modelInputModalityResolver: { resolve: resolveModalities },
      objectStorage,
      runtimeSnapshots: {
        assertReady: async () => undefined,
        resolve: async () => ({
          ...runtimeSnapshot(["text", "image"]),
          retrievalCapabilitySnapshot: { reasoning: { source: "legacy-preflight" } },
        }),
      } as never,
    }).documentMultimodalManifestEnhancer;
    if (!enhancer) throw new Error("profile enhancer unavailable");

    await expect(
      enhancer.enhance({
        manifest: manifestFixture(),
        parseArtifact: parseArtifactFixture(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      metadata: {
        enrichment: {
          model: "profile-reasoning:capability-invalid:text",
          skippedReason: "reasoning-model-text-only",
        },
      },
    });
    expect(resolveModalities).not.toHaveBeenCalled();
  });

  it("changes cache identity when a legacy capability recovers from text-only degradation", async () => {
    const objectStorage = memoryObjectStorage();
    let modalities: readonly ("text" | "image")[] = ["text"];
    const enhancer = createApiProfileMultimodalEnrichmentOptions({
      env: {},
      modelInputModalityResolver: { resolve: async () => modalities },
      objectStorage,
      runtimeSnapshots: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(["text", "image"]),
      },
    }).documentMultimodalManifestEnhancer;
    if (!enhancer?.cacheIdentity) throw new Error("profile enhancer unavailable");

    await expect(
      enhancer.cacheIdentity({
        manifest: manifestFixture(),
        parseArtifact: parseArtifactFixture(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ model: expect.stringMatching(/:text$/) });
    modalities = ["text", "image"];
    await expect(
      enhancer.cacheIdentity({
        manifest: manifestFixture(),
        parseArtifact: parseArtifactFixture(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ model: expect.stringMatching(/:text\+image$/) });
  });

  it("uses one frozen profile resolution for cache identity and vision enrichment", async () => {
    const objectStorage = memoryObjectStorage();
    await objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "chart.png",
    });
    const resolve = vi.fn(async () => runtimeSnapshot(["text", "image"]));
    const requests: Request[] = [];
    globalThis.fetch = vi.fn(async (request, init) => {
      requests.push(new Request(request, init).clone());
      return difyLlmResponse([
        {
          data: {
            delta: {
              message: {
                content: JSON.stringify({
                  caption: "A profile-routed chart",
                  ocrText: "Q1 42",
                  summary: "Quarterly chart",
                  title: "Q1",
                }),
              },
            },
          },
          error: "",
        },
      ]);
    }) as typeof fetch;
    const modelGateRun = vi.fn();
    const modelRequestGate: ConcurrencyGate = {
      run: async (operation) => {
        modelGateRun();
        return operation();
      },
    };
    const options = createApiProfileMultimodalEnrichmentOptions({
      env: {},
      modelInputModalityResolver: { resolve: async () => ["text", "image"] },
      modelRequestGate,
      objectStorage,
      runtimeSnapshots: { assertReady: async () => undefined, resolve },
    });
    const enhancer = options.documentMultimodalManifestEnhancer;
    if (!enhancer?.cacheIdentity) throw new Error("profile enhancer unavailable");
    const input = {
      manifest: visualManifestFixture(),
      parseArtifact: parseArtifactFixture(),
      tenantId: "tenant-1",
    };

    await expect(enhancer.cacheIdentity(input)).resolves.toEqual({
      model: `profile-reasoning:sha256:${"b".repeat(64)}:text+image`,
      promptVersion: "multimodal-understanding-v1",
    });
    await expect(enhancer.enhance(input)).resolves.toMatchObject({
      items: [expect.objectContaining({ caption: "A profile-routed chart" })],
    });

    expect(resolve).toHaveBeenCalledOnce();
    await expect(requests[0]?.json()).resolves.toMatchObject({
      model: "profile-model",
      provider: "profile-plugin/profile/profile",
    });
    expect(modelGateRun).toHaveBeenCalledOnce();
  });

  it("streams image evidence with a hard per-item byte limit", async () => {
    const objectStorage = memoryObjectStorage();
    await objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "chart.png",
    });
    const getObject = vi.fn(async () => {
      throw new Error("unbounded object read must not be used");
    });
    objectStorage.getObject = getObject;
    const requests: Request[] = [];
    globalThis.fetch = vi.fn(async (request, init) => {
      requests.push(new Request(request, init).clone());
      return difyLlmResponse([
        {
          data: {
            delta: { message: { content: JSON.stringify({ caption: "text-only fallback" }) } },
          },
          error: "",
        },
      ]);
    }) as typeof fetch;
    const enhancer = createApiProfileMultimodalEnrichmentOptions({
      env: { KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES: "2" },
      modelInputModalityResolver: { resolve: async () => ["text", "image"] },
      objectStorage,
      runtimeSnapshots: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(["text", "image"]),
      },
    }).documentMultimodalManifestEnhancer;
    if (!enhancer) throw new Error("profile enhancer unavailable");

    await expect(
      enhancer.enhance({
        manifest: visualManifestFixture(),
        parseArtifact: parseArtifactFixture(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ caption: "text-only fallback" })],
    });
    expect(getObject).not.toHaveBeenCalled();
    expect(JSON.stringify(await requests[0]?.json())).not.toContain("base64_data");
  });

  it("cancels a stalled enrichment image stream before invoking the reasoning model", async () => {
    const objectStorage = memoryObjectStorage();
    const cancel = vi.fn();
    let markReading: () => void = () => undefined;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    objectStorage.getObjectStream = async () => {
      return new ReadableStream<Uint8Array>({
        cancel,
        pull: () => {
          markReading();
          return new Promise(() => undefined);
        },
      });
    };
    const fetch = vi.fn();
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const enhancer = createApiProfileMultimodalEnrichmentOptions({
      env: {},
      modelInputModalityResolver: { resolve: async () => ["text", "image"] },
      objectStorage,
      runtimeSnapshots: {
        assertReady: async () => undefined,
        resolve: async () => runtimeSnapshot(["text", "image"]),
      },
    }).documentMultimodalManifestEnhancer;
    if (!enhancer) throw new Error("profile enhancer unavailable");
    const controller = new AbortController();
    const aborted = new Error("compilation lease lost");
    const pending = enhancer.enhance({
      manifest: visualManifestFixture(),
      parseArtifact: parseArtifactFixture(),
      signal: controller.signal,
      tenantId: "tenant-1",
    });

    await reading;
    controller.abort(aborted);

    await expect(pending).rejects.toBe(aborted);
    expect(cancel).toHaveBeenCalledWith(aborted);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function memoryObjectStorage() {
  return createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 20 * 1024 * 1024 });
}

function runtimeSnapshot(inputModalities: readonly ("text" | "image")[]) {
  const selection = {
    model: "profile-model",
    pluginId: "profile-plugin/profile",
    provider: "profile",
  };
  return {
    embeddingCapabilitySnapshot: undefined,
    embeddingProfile: undefined,
    projectionSnapshot: {
      fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
      headRevision: 1,
      knowledgeSpaceId,
      projectionVersion: 1,
      publicationId: "publication-1",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: {
        capabilityDigest: `sha256:${"b".repeat(64)}`,
        checkedAt: "2026-09-01T00:00:00.000Z",
        inputModalities,
        kind: "reasoning" as const,
        pluginUniqueIdentifier: "profile-plugin/profile@1",
        schemaFingerprint: `sha256:${"c".repeat(64)}`,
        selection,
      },
    },
    retrievalProfile: {
      defaultMode: "research" as const,
      reasoningModel: selection,
      rerank: { enabled: false as const },
      revision: 1,
      scoreThreshold: { enabled: false as const, stage: "mode-final" as const },
      topK: 10,
    },
  };
}

function manifestFixture() {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-06-24T00:00:00.000Z",
    documentAssetId,
    id: manifestId,
    items: [],
    knowledgeSpaceId,
    manifestVersion: "document-multimodal-manifest-v1" as const,
    metadata: {},
    parseArtifactId,
    version: 1,
  };
}

function visualManifestFixture() {
  return {
    ...manifestFixture(),
    items: [
      {
        assetRef: { contentType: "image/png", objectKey: "chart.png" },
        enrichment: {
          asset: "provided" as const,
          caption: "missing" as const,
          ocr: "missing" as const,
          tableStructure: "unsupported" as const,
          visualEmbedding: "missing" as const,
        },
        id: "item-1",
        modality: "image" as const,
        parseElementId: "image-1",
        sectionPath: ["Charts"],
        sourceMetadata: {},
      },
    ],
  };
}

function parseArtifactFixture() {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed" as const,
    createdAt: "2026-06-24T00:00:00.000Z",
    documentAssetId,
    elements: [],
    id: parseArtifactId,
    metadata: {},
    parser: "native-markdown" as const,
    version: 1,
  };
}

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
