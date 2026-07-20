import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParseArtifact, ParseElement } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

const pngBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0,
  0, 0, 0, 0, 0,
]);

describe("extractDocumentMultimodalAssets branch coverage", () => {
  it("validates local byte and extraction count caps", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const artifact = buildArtifact([imageElement("figure-1", { assetRef: { uri: "x" } })]);

    await expect(
      extractDocumentMultimodalAssets({
        artifact,
        knowledgeSpaceId,
        maxLocalAssetBytes: 0,
        objectStorage: adapter.objectStorage,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document multimodal local asset max bytes must be at least 1");
    await expect(
      extractDocumentMultimodalAssets({
        artifact,
        knowledgeSpaceId,
        maxExtractedAssets: 0,
        objectStorage: adapter.objectStorage,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document multimodal max extracted assets must be at least 1");
  });

  it("leaves image elements without asset refs or with empty data uris inline", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const artifact = buildArtifact([
      imageElement("figure-no-ref", {}),
      imageElement("figure-empty-data", { assetRef: { uri: "data:image/png;base64,====" } }),
    ]);

    const result = await extractDocumentMultimodalAssets({
      artifact,
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(0);
    expect(result.skippedForCapCount).toBe(0);
    // The artifact is returned untouched when nothing was extracted.
    expect(result.artifact).toBe(artifact);
  });

  it("preserves pre-existing asset ref variants when no generator runs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await extractDocumentMultimodalAssets({
      artifact: buildArtifact([
        imageElement("figure-1", {
          assetRef: {
            uri: "data:image/png;base64,AQIDBA==",
            variants: { existing: { contentType: "image/png", objectKey: "prior-key.png" } },
          },
        }),
      ]),
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        variants: { existing: { contentType: "image/png", objectKey: "prior-key.png" } },
      },
    });
  });

  it("merges generated variants over existing ones and omits missing dimensions", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await extractDocumentMultimodalAssets({
      artifact: buildArtifact([
        imageElement("figure-1", {
          assetRef: {
            uri: "data:image/png;base64,AQIDBA==",
            variants: { existing: { contentType: "image/png", objectKey: "prior-key.png" } },
          },
        }),
      ]),
      imageVariantGenerator: {
        generate: async () => [
          {
            body: new Uint8Array([9, 8, 7]),
            contentType: "image/png",
            name: "thumbnail",
          },
        ],
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

    expect(variants.existing).toEqual({ contentType: "image/png", objectKey: "prior-key.png" });
    expect(variants.thumbnail).toMatchObject({
      contentType: "image/png",
      objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
    });
    expect(variants.thumbnail).not.toHaveProperty("height");
    expect(variants.thumbnail).not.toHaveProperty("width");
  });

  it("reads dimensions from jpeg, gif, and webp data uris", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ]);
    const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 3, 0]);
    const webpBytes = new Uint8Array(30);
    webpBytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webpBytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    webpBytes.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
    webpBytes[20] = 0x2f;
    // width-1 = 1, height-1 = 2 packed as 14-bit fields.
    webpBytes[21] = 0x01;
    webpBytes[22] = 0x80;
    webpBytes[23] = 0x00;
    webpBytes[24] = 0x00;

    const result = await extractDocumentMultimodalAssets({
      artifact: buildArtifact([
        imageElement("figure-jpeg", {
          assetRef: { uri: `data:image/jpeg;base64,${Buffer.from(jpegBytes).toString("base64")}` },
        }),
        imageElement("figure-gif", {
          assetRef: { uri: `data:image/gif;base64,${Buffer.from(gifBytes).toString("base64")}` },
        }),
        imageElement("figure-webp", {
          assetRef: { uri: `data:image/webp;base64,${Buffer.from(webpBytes).toString("base64")}` },
        }),
      ]),
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(3);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: { contentType: "image/jpeg", height: 3, width: 2 },
    });
    expect(result.artifact.elements[1]?.metadata).toMatchObject({
      assetRef: { contentType: "image/gif", height: 3, width: 2 },
    });
    expect(result.artifact.elements[2]?.metadata).toMatchObject({
      assetRef: { contentType: "image/webp", height: 3, width: 2 },
    });
  });

  it("scans past non-SOF jpeg segments and reads VP8X/VP8 webp headers", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    // APP0 segment (FF E0, length 4) preceded by a stray non-marker byte, then SOF0.
    const jpegWithApp0 = new Uint8Array([
      0xff, 0xd8, 0x00, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00,
      0x05, 0x00, 0x04, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    // SOS-like segment whose declared length overruns the buffer: dimensions are unreadable.
    const truncatedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]);
    // Valid APP0 segment but the scan ends without ever finding an SOF marker.
    const jpegWithoutSof = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0, 0, 0, 0]);
    const vp8xBytes = new Uint8Array(30);
    vp8xBytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    vp8xBytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    vp8xBytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
    vp8xBytes.set([1, 0, 0], 24); // width-1 = 1
    vp8xBytes.set([2, 0, 0], 27); // height-1 = 2
    const vp8Bytes = new Uint8Array(30);
    vp8Bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    vp8Bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    vp8Bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
    vp8Bytes.set([2, 0], 26); // width & 0x3fff = 2
    vp8Bytes.set([3, 0], 28); // height & 0x3fff = 3
    const unknownChunkBytes = new Uint8Array(30);
    unknownChunkBytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    unknownChunkBytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    unknownChunkBytes.set([0x41, 0x4c, 0x50, 0x48], 12); // ALPH (unsupported chunk)

    const dataUri = (contentType: string, bytes: Uint8Array) =>
      `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    const result = await extractDocumentMultimodalAssets({
      artifact: buildArtifact([
        imageElement("figure-app0", { assetRef: { uri: dataUri("image/jpeg", jpegWithApp0) } }),
        imageElement("figure-truncated", {
          assetRef: { uri: dataUri("image/jpeg", truncatedJpeg) },
        }),
        imageElement("figure-no-sof", {
          assetRef: { uri: dataUri("image/jpeg", jpegWithoutSof) },
        }),
        imageElement("figure-vp8x", { assetRef: { uri: dataUri("image/webp", vp8xBytes) } }),
        imageElement("figure-vp8", { assetRef: { uri: dataUri("image/webp", vp8Bytes) } }),
        imageElement("figure-alph", {
          assetRef: { uri: dataUri("image/webp", unknownChunkBytes) },
        }),
      ]),
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(6);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: { height: 5, width: 4 },
    });
    expect(result.artifact.elements[1]?.metadata.assetRef).not.toHaveProperty("width");
    expect(result.artifact.elements[2]?.metadata.assetRef).not.toHaveProperty("width");
    expect(result.artifact.elements[3]?.metadata).toMatchObject({
      assetRef: { height: 3, width: 2 },
    });
    expect(result.artifact.elements[4]?.metadata).toMatchObject({
      assetRef: { height: 3, width: 2 },
    });
    expect(result.artifact.elements[5]?.metadata.assetRef).not.toHaveProperty("width");
  });

  it("handles local asset edge cases: no uri, non-file paths, unknown types, and absolute paths", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const allowedDir = await mkdtemp(join(tmpdir(), "knowledge-fs-extractor-coverage-"));
    const unknownTypePath = join(allowedDir, "note.dat");
    const realPngPath = join(allowedDir, "real.png");
    await writeFile(unknownTypePath, new Uint8Array([1, 2, 3]));
    await writeFile(realPngPath, pngBytes);

    const result = await extractDocumentMultimodalAssets({
      allowLocalAssetPaths: [allowedDir],
      artifact: buildArtifact([
        // No uri at all: nothing to resolve even with allowlisted roots.
        imageElement("figure-no-uri", { assetRef: { contentType: "image/png" } }),
        // Remote uri is never treated as a local path.
        imageElement("figure-remote", { assetRef: { uri: "https://example.test/x.png" } }),
        // Allowlisted directory itself is not a file.
        imageElement("figure-dir", {
          assetRef: { contentType: "image/png", uri: `file://${allowedDir}` },
        }),
        // Unknown extension with no declared content type cannot be typed.
        imageElement("figure-unknown-type", { assetRef: { uri: `file://${unknownTypePath}` } }),
        // Plain absolute path (no file:// scheme) with an explicit image content type.
        imageElement("figure-absolute", {
          assetRef: { contentType: "image/png", uri: realPngPath },
        }),
      ]),
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata.assetRef).toEqual({ contentType: "image/png" });
    expect(result.artifact.elements[1]?.metadata.assetRef).toEqual({
      uri: "https://example.test/x.png",
    });
    expect(result.artifact.elements[2]?.metadata.assetRef).toEqual({
      contentType: "image/png",
      uri: `file://${allowedDir}`,
    });
    expect(result.artifact.elements[3]?.metadata.assetRef).toEqual({
      uri: `file://${unknownTypePath}`,
    });
    // The extracted local PNG records dimensions parsed from its header.
    expect(result.artifact.elements[4]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        height: 3,
        source: "local-file",
        width: 2,
      },
    });
  });

  it("rejects local assets above the local byte budget", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const allowedDir = await mkdtemp(join(tmpdir(), "knowledge-fs-extractor-oversize-"));
    const oversizedPath = join(allowedDir, "big.png");
    await writeFile(oversizedPath, new Uint8Array([1, 2, 3, 4]));

    await expect(
      extractDocumentMultimodalAssets({
        allowLocalAssetPaths: [allowedDir],
        artifact: buildArtifact([
          imageElement("figure-big", { assetRef: { uri: `file://${oversizedPath}` } }),
        ]),
        knowledgeSpaceId,
        maxLocalAssetBytes: 2,
        objectStorage: adapter.objectStorage,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document multimodal local asset exceeds maxLocalAssetBytes=2");
  });

  it("infers image content types from local file extensions", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const allowedDir = await mkdtemp(join(tmpdir(), "knowledge-fs-extractor-types-"));
    const cases = [
      ["avif", "image/avif"],
      ["bmp", "image/bmp"],
      ["gif", "image/gif"],
      ["jpg", "image/jpeg"],
      ["jpeg", "image/jpeg"],
      ["svg", "image/svg+xml"],
      ["tif", "image/tiff"],
      ["tiff", "image/tiff"],
      ["webp", "image/webp"],
    ] as const;
    for (const [extension] of cases) {
      await writeFile(join(allowedDir, `asset.${extension}`), new Uint8Array([1, 2, 3]));
    }

    const result = await extractDocumentMultimodalAssets({
      allowLocalAssetPaths: [allowedDir],
      artifact: buildArtifact(
        cases.map(([extension]) =>
          imageElement(`figure-${extension}`, {
            assetRef: { uri: `file://${join(allowedDir, `asset.${extension}`)}` },
          }),
        ),
      ),
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result.extractedCount).toBe(cases.length);
    for (const [index, [, contentType]] of cases.entries()) {
      expect(result.artifact.elements[index]?.metadata).toMatchObject({
        assetRef: { contentType, source: "local-file" },
      });
    }
  });
});

function imageElement(id: string, metadata: Record<string, unknown>): ParseElement {
  return {
    id,
    metadata,
    sectionPath: [],
    type: "image",
  };
}

function buildArtifact(elements: readonly ParseElement[]): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId,
    elements: [...elements],
    id: parseArtifactId,
    metadata: {},
    parser: "native-markdown",
    version: 1,
  };
}
