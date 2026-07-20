import { describe, expect, it } from "vitest";

import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import {
  createCachedDocumentMultimodalManifestEnhancer,
  createDocumentMultimodalManifestEnhancer,
} from "./document-multimodal-manifest-enhancer";
import { createInMemoryDocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const sha256 = "a".repeat(64);

describe("createDocumentMultimodalManifestEnhancer", () => {
  it("applies bounded provider enrichment to multimodal manifest items", async () => {
    const artifact = {
      artifactHash: sha256,
      contentType: "mixed" as const,
      createdAt: "2026-06-22T00:00:00.000Z",
      documentAssetId,
      elements: [
        {
          id: "image-1",
          metadata: {},
          pageNumber: 2,
          sectionPath: ["Charts"],
          text: "Existing OCR text that is passed to the provider",
          type: "image" as const,
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "unstructured" as const,
      version: 1,
    };
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const providerInputs: unknown[] = [];
    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxItems: 1,
      maxSourceTextChars: 18,
      model: "vision-model",
      promptVersion: "multimodal-enrichment-v1",
      provider: {
        enrich: async (input) => {
          providerInputs.push(input);

          return {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant-dev/spaces/space/artifacts/image-1.png",
              sha256: "b".repeat(64),
            },
            caption: "Provider caption",
            metadata: { latencyMs: 12 },
            ocrText: "Provider OCR",
            textPreview: "Provider preview",
            visualEmbeddingStatus: "provided",
          };
        },
      },
    });

    const enhanced = await enhancer.enhance({
      manifest,
      parseArtifact: artifact,
      traceId: "trace-1",
    });

    expect(providerInputs).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ parseElementId: "image-1" }),
        model: "vision-model",
        promptVersion: "multimodal-enrichment-v1",
        sourceText: "Existing OCR text ",
        traceId: "trace-1",
      }),
    ]);
    expect(enhanced.items[0]).toMatchObject({
      assetRef: { contentType: "image/png", sha256: "b".repeat(64) },
      caption: "Provider caption",
      enrichment: {
        asset: "provided",
        caption: "provided",
        ocr: "provided",
        visualEmbedding: "provided",
      },
      ocrText: "Provider OCR",
      sourceMetadata: { enrichment: { latencyMs: 12 } },
      textPreview: "Provider preview",
    });
    expect(enhanced.metadata).toMatchObject({
      enrichment: {
        attemptedItems: 1,
        enhancedItems: 1,
        failedItems: 0,
        model: "vision-model",
        providerBudget: {
          maxItems: 1,
          maxSourceTextChars: 18,
        },
        promptVersion: "multimodal-enrichment-v1",
        skippedItems: 0,
        source: "provider",
      },
      missingAssetCount: 0,
      missingVisualEmbeddingCount: 0,
    });
  });

  it("reports provider budget usage, skipped items, and failed enrichment states", async () => {
    const artifact = {
      artifactHash: sha256,
      contentType: "mixed" as const,
      createdAt: "2026-06-22T00:00:00.000Z",
      documentAssetId,
      elements: [
        {
          id: "image-1",
          metadata: {},
          sectionPath: ["Charts"],
          type: "image" as const,
        },
        {
          id: "image-2",
          metadata: {},
          sectionPath: ["Charts"],
          type: "image" as const,
        },
        {
          id: "image-3",
          metadata: {},
          sectionPath: ["Charts"],
          type: "image" as const,
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "unstructured" as const,
      version: 1,
    };
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const providerInputs: unknown[] = [];
    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxItems: 2,
      maxSourceTextChars: 100,
      model: "vision-model",
      promptVersion: "multimodal-enrichment-v1",
      provider: {
        enrich: async (input) => {
          providerInputs.push(input);

          return input.item.parseElementId === "image-2"
            ? {
                metadata: {
                  error: "provider quota exceeded",
                  status: "failed",
                },
              }
            : {
                caption: "Provider caption",
                metadata: { status: "provided" },
              };
        },
      },
    });

    const enhanced = await enhancer.enhance({ manifest, parseArtifact: artifact });

    expect(providerInputs).toHaveLength(2);
    expect(enhanced.items[1]?.sourceMetadata).toMatchObject({
      enrichment: {
        error: "provider quota exceeded",
        status: "failed",
      },
    });
    expect(enhanced.items[2]?.sourceMetadata).not.toHaveProperty("enrichment");
    expect(enhanced.metadata).toMatchObject({
      enrichment: {
        attemptedItems: 2,
        enhancedItems: 2,
        failedItems: 1,
        providerBudget: {
          maxItems: 2,
          maxSourceTextChars: 100,
        },
        skippedItems: 1,
      },
    });
  });

  it("rejects unbounded enhancer options", () => {
    const provider = { enrich: async () => ({}) };

    expect(() =>
      createDocumentMultimodalManifestEnhancer({
        maxItems: 0,
        maxSourceTextChars: 10,
        model: "vision-model",
        promptVersion: "multimodal-enrichment-v1",
        provider,
      }),
    ).toThrow("Document multimodal manifest enhancer maxItems must be at least 1");
    expect(() =>
      createDocumentMultimodalManifestEnhancer({
        maxItems: 1,
        maxSourceTextChars: 0,
        model: "vision-model",
        promptVersion: "multimodal-enrichment-v1",
        provider,
      }),
    ).toThrow("Document multimodal manifest enhancer maxSourceTextChars must be at least 1");
  });

  it("caches enhanced manifests and refreshes stale parse artifacts", async () => {
    const artifact = manifestArtifact();
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const providerInputs: unknown[] = [];
    const enhancer = createCachedDocumentMultimodalManifestEnhancer({
      enhancer: createDocumentMultimodalManifestEnhancer({
        maxItems: 1,
        maxSourceTextChars: 100,
        model: "vision-model",
        promptVersion: "multimodal-enrichment-v1",
        provider: {
          enrich: async (input) => {
            providerInputs.push(input);

            return { caption: `Provider caption ${providerInputs.length}` };
          },
        },
      }),
      manifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 }),
    });

    const first = await enhancer.enhance({ manifest, parseArtifact: artifact });
    const second = await enhancer.enhance({ manifest, parseArtifact: artifact });
    const staleManifest = {
      ...manifest,
      artifactHash: "c".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56",
    };
    const refreshed = await enhancer.enhance({
      manifest: staleManifest,
      parseArtifact: {
        ...artifact,
        artifactHash: "c".repeat(64),
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56",
      },
    });

    expect(providerInputs).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ caption: "Provider caption 1" });
    expect(second.items[0]).toMatchObject({ caption: "Provider caption 1" });
    expect(refreshed.items[0]).toMatchObject({ caption: "Provider caption 2" });
  });

  it("isolates cached manifests by publication generation", async () => {
    const artifact = manifestArtifact();
    const builder = createDocumentMultimodalManifestBuilder();
    const manifests = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 });
    let calls = 0;
    const enhancer = createCachedDocumentMultimodalManifestEnhancer({
      enhancer: createDocumentMultimodalManifestEnhancer({
        maxItems: 1,
        maxSourceTextChars: 100,
        model: "vision-model",
        promptVersion: "v1",
        provider: {
          enrich: async () => {
            calls += 1;
            return { caption: `generation ${calls}` };
          },
        },
      }),
      manifests,
    });
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61";
    const first = builder.build({
      artifact,
      knowledgeSpaceId,
      publicationGenerationId: firstGeneration,
    });
    const second = builder.build({
      artifact,
      knowledgeSpaceId,
      publicationGenerationId: secondGeneration,
    });

    const enhancedFirst = await enhancer.enhance({ manifest: first, parseArtifact: artifact });
    const enhancedSecond = await enhancer.enhance({ manifest: second, parseArtifact: artifact });
    const cachedFirst = await enhancer.enhance({ manifest: first, parseArtifact: artifact });

    expect(calls).toBe(2);
    expect(enhancedFirst.items[0]).toMatchObject({ caption: "generation 1" });
    expect(enhancedSecond.items[0]).toMatchObject({ caption: "generation 2" });
    expect(cachedFirst.items[0]).toMatchObject({ caption: "generation 1" });
  });

  it("does not downgrade an existing object-backed assetRef to a weaker provider result", async () => {
    const artifact = {
      artifactHash: sha256,
      contentType: "mixed" as const,
      createdAt: "2026-06-22T00:00:00.000Z",
      documentAssetId,
      elements: [
        {
          id: "image-1",
          metadata: {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant-1/spaces/space/documents/doc/assets/image-1.png",
              sha256: "b".repeat(64),
            },
          },
          sectionPath: ["Charts"],
          type: "image" as const,
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "unstructured" as const,
      version: 1,
    };
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    expect(manifest.items[0]?.assetRef?.objectKey).toBeTruthy();

    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxItems: 1,
      maxSourceTextChars: 100,
      model: "vision-model",
      promptVersion: "v1",
      // Provider returns a weaker uri-only assetRef and a "missing" visual-embedding status.
      provider: {
        enrich: async () => ({
          assetRef: { uri: "https://example.com/thumb.png" },
          caption: "A chart",
          visualEmbeddingStatus: "missing",
        }),
      },
    });

    const enhanced = await enhancer.enhance({ manifest, parseArtifact: artifact });

    // The real object-backed assetRef is preserved (not replaced by the uri-only one).
    expect(enhanced.items[0]?.assetRef).toMatchObject({
      objectKey: "tenant-1/spaces/space/documents/doc/assets/image-1.png",
      sha256: "b".repeat(64),
    });
    expect(enhanced.items[0]?.enrichment.asset).toBe("provided");
  });

  it("counts only items the provider actually changed as enhanced", async () => {
    const artifact = imageArtifact(2);
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxItems: 5,
      maxSourceTextChars: 100,
      model: "vision-model",
      promptVersion: "v1",
      provider: { enrich: async () => ({}) },
    });

    const enhanced = await enhancer.enhance({ manifest, parseArtifact: artifact });

    expect(enhanced.metadata).toMatchObject({
      enrichment: { attemptedItems: 2, enhancedItems: 0, failedItems: 0 },
    });
  });

  it("bounds provider concurrency to maxConcurrency", async () => {
    const artifact = imageArtifact(20);
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    let active = 0;
    let peak = 0;
    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxConcurrency: 4,
      maxItems: 20,
      maxSourceTextChars: 100,
      model: "vision-model",
      promptVersion: "v1",
      provider: {
        enrich: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 0));
          active -= 1;

          return { caption: "c" };
        },
      },
    });

    await enhancer.enhance({ manifest, parseArtifact: artifact });

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("single-flights concurrent first-reads of the same document version", async () => {
    const artifact = manifestArtifact();
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enhancer = createCachedDocumentMultimodalManifestEnhancer({
      enhancer: createDocumentMultimodalManifestEnhancer({
        maxItems: 1,
        maxSourceTextChars: 100,
        model: "vision-model",
        promptVersion: "v1",
        provider: {
          enrich: async () => {
            calls += 1;
            await gate;

            return { caption: "c" };
          },
        },
      }),
      manifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 }),
    });

    const both = Promise.all([
      enhancer.enhance({ manifest, parseArtifact: artifact }),
      enhancer.enhance({ manifest, parseArtifact: artifact }),
    ]);
    release?.();
    const [a, b] = await both;

    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it("treats a cached manifest from a different model/promptVersion as stale", async () => {
    const artifact = manifestArtifact();
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const manifests = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 });
    let calls = 0;
    const build = (model: string, promptVersion: string) =>
      createCachedDocumentMultimodalManifestEnhancer({
        enhancer: createDocumentMultimodalManifestEnhancer({
          maxItems: 1,
          maxSourceTextChars: 100,
          model,
          promptVersion,
          provider: {
            enrich: async () => {
              calls += 1;

              return { caption: `caption ${calls}` };
            },
          },
        }),
        manifests,
      });

    await build("vision-A", "v1").enhance({ manifest, parseArtifact: artifact });
    // Same repo, different model → the cached entry is stale and must be re-enriched.
    const refreshed = await build("vision-B", "v2").enhance({ manifest, parseArtifact: artifact });

    expect(calls).toBe(2);
    expect(refreshed.items[0]).toMatchObject({ caption: "caption 2" });
    expect(refreshed.metadata).toMatchObject({
      enrichment: { model: "vision-B", promptVersion: "v2" },
    });
  });
});

function imageArtifact(count: number) {
  return {
    artifactHash: sha256,
    contentType: "mixed" as const,
    createdAt: "2026-06-22T00:00:00.000Z",
    documentAssetId,
    elements: Array.from({ length: count }, (_unused, index) => ({
      id: `image-${index + 1}`,
      metadata: {},
      sectionPath: ["Charts"],
      type: "image" as const,
    })),
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured" as const,
    version: 1,
  };
}

function manifestArtifact() {
  return {
    artifactHash: sha256,
    contentType: "mixed" as const,
    createdAt: "2026-06-22T00:00:00.000Z",
    documentAssetId,
    elements: [
      {
        id: "image-1",
        metadata: {},
        pageNumber: 2,
        sectionPath: ["Charts"],
        text: "Existing OCR text",
        type: "image" as const,
      },
    ],
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured" as const,
    version: 1,
  };
}
