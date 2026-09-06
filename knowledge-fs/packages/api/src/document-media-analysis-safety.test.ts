import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { createTypeScriptComputeRuntime } from "@knowledge/compute";
import { DocumentMultimodalAssetRefSchema, type ParseArtifact } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";
import { createUnderstandingDocumentMultimodalEnrichmentProvider } from "./document-multimodal-enrichment-providers";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import { createDocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import { createObjectStorageVisualEmbeddingProvider } from "./index-projection-builders";
import {
  createContentBlockMultimodalAnswerProvider,
  createObjectStorageContentBlockMultimodalAnswerProvider,
} from "./llm-multimodal-answer-provider";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const rejected = { reason: "variant-pixel-budget" as const };
const assetRef = {
  analysisUnavailable: rejected,
  contentType: "image/png",
  objectKey: "tenant/assets/image.png",
};

describe("rejected document image analysis", () => {
  it.each([
    ["count", ""],
    ["bytes", ""],
    ["count", " \n\t"],
    ["bytes", " \n\t"],
  ])(
    "keeps overlong inline sources recoverable but bounded in manifests after %s limits with prefix %j",
    async (limit, prefix) => {
      const uri = `${prefix}data:image/png;base64,${Buffer.alloc(4096).toString("base64")}`;
      const artifact: ParseArtifact = {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        elements: ["data:image/png;base64,AQID", uri].map((source, index) => ({
          id: `image-${index}`,
          type: "image",
          sectionPath: [],
          metadata: { assetRef: { uri: source } },
        })),
        metadata: {},
        parser: "native-markdown",
        version: 1,
      };
      const extracted = await extractDocumentMultimodalAssets({
        artifact,
        knowledgeSpaceId,
        tenantId: "tenant",
        objectStorage: createNodePlatformAdapter({ env: {} }).objectStorage,
        ...(limit === "count" ? { maxExtractedAssets: 1 } : { maxTotalAssetBytes: 3 }),
      });
      expect(extracted.artifact.elements[1]?.metadata.assetRef).toMatchObject({ uri });
      const manifest = createDocumentMultimodalManifestBuilder().build({
        artifact: extracted.artifact,
        knowledgeSpaceId,
      });
      const item = manifest.items[1];
      expect(item?.assetRef).toEqual({
        analysisUnavailable: {
          reason: limit === "count" ? "asset-count-budget" : "materialized-byte-budget",
        },
      });
      expect(item?.enrichment.asset).toBe("missing");
      expect(item?.sourceMetadata.assetRef).toMatchObject({
        sourceUriSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(JSON.stringify(manifest)).not.toContain(uri);
      const enriched = await createDocumentMultimodalManifestEnhancer({
        maxItems: 2,
        maxSourceTextChars: 100,
        model: "vision",
        promptVersion: "v1",
        provider: {
          enrich: async () => ({
            caption: "Text-only metadata",
            visualEmbeddingStatus: "provided",
          }),
        },
      }).enhance({ manifest, parseArtifact: extracted.artifact });
      expect(enriched.items[1]?.enrichment).toMatchObject({
        asset: "missing",
        visualEmbedding: "unsupported",
      });
    },
  );
  it("bounds the reason contract and preserves the marker through extraction, manifest, and nodes", async () => {
    expect(DocumentMultimodalAssetRefSchema.parse(assetRef)).toEqual(assetRef);
    expect(
      DocumentMultimodalAssetRefSchema.safeParse({
        ...assetRef,
        analysisUnavailable: { reason: "x".repeat(5000) },
      }).success,
    ).toBe(false);
    const objectStorage = createNodePlatformAdapter({ env: {} }).objectStorage;
    const parseArtifact: ParseArtifact = {
      artifactHash: "a".repeat(64),
      contentType: "mixed",
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      elements: [
        {
          id: "image-1",
          type: "image",
          sectionPath: [],
          text: "Readable caption",
          metadata: { assetRef: { uri: "data:image/png;base64,AQIDBA==" } },
        },
      ],
      metadata: {},
      parser: "native-markdown",
      version: 1,
    };
    const { artifact } = await extractDocumentMultimodalAssets({
      artifact: parseArtifact,
      objectStorage,
      knowledgeSpaceId,
      tenantId: "tenant",
      maxTotalVariantPixels: 1,
      imageVariantGenerator: { generate: vi.fn() },
    });
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const item = manifest.items[0];
    expect(item?.assetRef).toMatchObject({
      analysisUnavailable: rejected,
      objectKey: expect.any(String),
    });
    expect(item?.enrichment.visualEmbedding).toBe("unsupported");
    const nodes = createTypeScriptComputeRuntime().chunkParseArtifact({
      parseArtifact: artifact,
      knowledgeSpaceId,
    });
    expect(nodes[0]?.metadata.assetRef).toMatchObject({ analysisUnavailable: rejected });
    expect(nodes[0]?.text).toBe("Readable caption");
    const originalKey = item?.assetRef?.objectKey;
    const node = nodes[0];
    if (!originalKey || !node) throw new Error("Expected retained original and text node");
    expect(await objectStorage.getObject(originalKey)).not.toBeNull();
    const embedImages = vi.fn();
    const embedding = createObjectStorageVisualEmbeddingProvider({
      objectStorage,
      provider: { embedImages },
    });
    const result = await embedding.embedAssets({
      model: "vision",
      assets: [
        {
          assetRef: node.metadata.assetRef as Record<string, unknown>,
          documentAssetId: artifact.documentAssetId,
          metadata: {},
          modality: "image",
          nodeId: node.id,
          sourceText: "Readable caption",
        },
      ],
    });
    expect(result.dense).toEqual([]);
    expect(embedImages).not.toHaveBeenCalled();
  });

  it.each(["object", "url"])(
    "does not load rejected originals in %s answer consumers",
    async (kind) => {
      const objectStorage = createNodePlatformAdapter({ env: {} }).objectStorage;
      await objectStorage.putObject({
        key: assetRef.objectKey,
        body: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      });
      const get = vi.spyOn(objectStorage, "getObjectStream");
      const generate = vi.fn(async () => ({ text: "Answer from caption" }));
      const resolve = vi.fn(() => "https://example.com/original.png");
      const provider =
        kind === "object"
          ? createObjectStorageContentBlockMultimodalAnswerProvider({
              model: "vision",
              objectStorage,
              provider: { generate },
            })
          : createContentBlockMultimodalAnswerProvider({
              model: "vision",
              assetUrlResolver: resolve,
              provider: { generate },
            });
      await expect(
        provider.generate({
          query: "What does it show?",
          evidence: [],
          multimodalEvidence: [
            {
              assetRef,
              documentAssetId: "doc-1",
              modality: "image",
              parseElementId: "image-1",
              sectionPath: [],
              caption: "Readable caption",
            },
          ],
        }),
      ).resolves.toMatchObject({ metadata: { imageBlockCount: 0 } });
      expect(get).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      expect(JSON.stringify(generate.mock.calls)).toContain("parseElement=image-1");
    },
  );

  it("does not delegate flagged images to understanding providers or let enrichment clear the marker", async () => {
    const artifact: ParseArtifact = {
      artifactHash: "a".repeat(64),
      contentType: "mixed",
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      elements: [{ id: "image-1", type: "image", sectionPath: [], metadata: { assetRef } }],
      metadata: {},
      parser: "native-markdown",
      version: 1,
    };
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    const understand = vi.fn(async () => ({ caption: "Should not execute" }));
    const enhancer = createDocumentMultimodalManifestEnhancer({
      maxItems: 1,
      maxSourceTextChars: 100,
      model: "vision",
      promptVersion: "v1",
      provider: createUnderstandingDocumentMultimodalEnrichmentProvider({
        provider: { understand },
      }),
    });
    await enhancer.enhance({ manifest, parseArtifact: artifact });
    expect(understand).not.toHaveBeenCalled();
    const rewriting = createDocumentMultimodalManifestEnhancer({
      maxItems: 1,
      maxSourceTextChars: 100,
      model: "vision",
      promptVersion: "v1",
      provider: {
        enrich: async () => ({
          assetRef: { objectKey: assetRef.objectKey, contentType: "image/png" },
          caption: "Text-only caption",
        }),
      },
    });
    expect(
      (await rewriting.enhance({ manifest, parseArtifact: artifact })).items[0]?.assetRef,
    ).toMatchObject({ analysisUnavailable: rejected });
  });
});
