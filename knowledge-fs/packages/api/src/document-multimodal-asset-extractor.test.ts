import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("extractDocumentMultimodalAssets", () => {
  it("stores embedded image data URIs and rewrites image asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const dataUri = "data:image/png;base64,AQIDBA==";

    const result = await extractDocumentMultimodalAssets({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                uri: dataUri,
              },
              caption: "Embedded diagram",
            },
            sectionPath: ["Architecture"],
            text: "Embedded diagram",
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      },
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(
          /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43\/assets\/figure-1-[a-f0-9]{12}\.png$/u,
        ),
        sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        sourceUriSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      caption: "Embedded diagram",
    });
    expect(result.artifact.elements[0]?.metadata).not.toHaveProperty("assetRef.uri");
    await expect(
      adapter.objectStorage.getObject(
        String(
          (
            result.artifact.elements[0]?.metadata.assetRef as
              | Readonly<Record<string, unknown>>
              | undefined
          )?.objectKey,
        ),
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("records dimensions for extracted image asset refs when headers expose them", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const pngBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0,
      0, 0, 0, 0, 0, 0,
    ]);

    const result = await extractDocumentMultimodalAssets({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                uri: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`,
              },
            },
            sectionPath: ["Architecture"],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      },
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        height: 3,
        width: 2,
      },
    });
  });

  it("stores generated image variants for extracted non-PDF assets", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await extractDocumentMultimodalAssets({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                uri: "data:image/png;base64,AQIDBA==",
              },
            },
            sectionPath: ["Architecture"],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      },
      imageVariantGenerator: {
        generate: async ({ body, contentType, elementId }) => {
          expect([...body]).toEqual([1, 2, 3, 4]);
          expect(contentType).toBe("image/png");
          expect(elementId).toBe("figure-1");
          return [
            {
              body: new Uint8Array([9, 8, 7]),
              contentType: "image/png",
              height: 24,
              name: "thumbnail",
              width: 32,
            },
          ];
        },
      },
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    const assetRef = result.artifact.elements[0]?.metadata.assetRef as
      | Readonly<Record<string, unknown>>
      | undefined;
    const variants = assetRef?.variants as Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    const thumbnail = variants.thumbnail;

    expect(thumbnail).toMatchObject({
      contentType: "image/png",
      height: 24,
      objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
      sha256: "06df4f7e1394f1c57cc6583fba4d8060a5a66f4f4771c14aeff6b9af8a28c9b3",
      width: 32,
    });
    await expect(adapter.objectStorage.getObject(String(thumbnail?.objectKey))).resolves.toEqual(
      new Uint8Array([9, 8, 7]),
    );
  });

  it("rejects unbounded or oversized embedded image assets", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const artifact = {
      artifactHash: "a".repeat(64),
      contentType: "mixed" as const,
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId,
      elements: [
        {
          id: "figure-1",
          metadata: {
            assetRef: {
              uri: "data:image/png;base64,AQIDBA==",
            },
          },
          sectionPath: [],
          type: "image" as const,
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "native-markdown" as const,
      version: 1,
    };

    await expect(
      extractDocumentMultimodalAssets({
        artifact,
        knowledgeSpaceId,
        maxEmbeddedAssetBytes: 0,
        objectStorage: adapter.objectStorage,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document multimodal embedded asset max bytes must be at least 1");

    await expect(
      extractDocumentMultimodalAssets({
        artifact,
        knowledgeSpaceId,
        maxEmbeddedAssetBytes: 3,
        objectStorage: adapter.objectStorage,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document multimodal embedded asset exceeds maxEmbeddedAssetBytes=3");
  });

  it("soft-caps extraction at maxExtractedAssets, leaving the rest inline (no throw, no orphans)", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await extractDocumentMultimodalAssets({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: { assetRef: { uri: "data:image/png;base64,AQIDBA==" } },
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { assetRef: { uri: "data:image/png;base64,BQYHCA==" } },
            sectionPath: [],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      },
      knowledgeSpaceId,
      maxExtractedAssets: 1,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(1);
    expect(result.skippedForCapCount).toBe(1);
    expect(result.artifact.metadata).toMatchObject({
      multimodalAssets: { extractedCount: 1, skippedForCapCount: 1 },
    });
    // The over-cap image is left inline (its data URI preserved), not extracted.
    const figure2 = result.artifact.elements.find((element) => element.id === "figure-2");
    expect(figure2?.metadata.assetRef).toEqual({ uri: "data:image/png;base64,BQYHCA==" });
    // Exactly one object was written (the extracted figure-1), so no orphan from figure-2.
    const figure1 = result.artifact.elements.find((element) => element.id === "figure-1");
    const objectKey = (figure1?.metadata.assetRef as { objectKey?: string } | undefined)?.objectKey;
    expect(objectKey).toBeTruthy();
    await expect(adapter.objectStorage.headObject(objectKey ?? "")).resolves.not.toBeNull();
  });

  it("stores allowlisted local image assets and leaves non-allowlisted paths untouched", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const allowedDir = await mkdtemp(join(tmpdir(), "knowledge-fs-visual-assets-"));
    const deniedDir = await mkdtemp(join(tmpdir(), "knowledge-fs-denied-assets-"));
    const allowedPath = join(allowedDir, "figure-1.png");
    const deniedPath = join(deniedDir, "figure-2.png");
    await writeFile(allowedPath, new Uint8Array([5, 6, 7, 8]));
    await writeFile(deniedPath, new Uint8Array([9, 10, 11, 12]));

    const result = await extractDocumentMultimodalAssets({
      allowLocalAssetPaths: [allowedDir],
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                uri: `file://${allowedPath}`,
              },
            },
            sectionPath: ["Architecture"],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: {
              assetRef: {
                uri: `file://${deniedPath}`,
              },
            },
            sectionPath: ["Architecture"],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(1);
    expect(result.artifact.metadata).toMatchObject({
      multimodalAssets: {
        extractedCount: 1,
        sources: ["local-file"],
      },
    });
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(/figure-1-[a-f0-9]{12}\.png$/u),
        sha256: "55e5509f8052998294266ee5b50cb592938191fb5d67f73cac2e60b0276b1bdd",
        source: "local-file",
      },
    });
    expect(result.artifact.elements[0]?.metadata).not.toHaveProperty("assetRef.uri");
    expect(result.artifact.elements[1]?.metadata).toMatchObject({
      assetRef: {
        uri: `file://${deniedPath}`,
      },
    });
    await expect(
      adapter.objectStorage.getObject(
        String(
          (
            result.artifact.elements[0]?.metadata.assetRef as
              | Readonly<Record<string, unknown>>
              | undefined
          )?.objectKey,
        ),
      ),
    ).resolves.toEqual(new Uint8Array([5, 6, 7, 8]));
  });
});
