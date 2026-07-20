import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { ParseArtifactSchema } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const artifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const bareDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";
const unknownSpaceId = "00000000-0000-4000-8000-00000000dead";
const unknownDocumentId = "00000000-0000-4000-8000-00000000beef";
const maxAssetReadBytes = 25 * 1024 * 1024;

const assetPrefix = `tenant-1/spaces/${spaceId}/documents/${documentId}/assets`;
const goodKey = `${assetPrefix}/fig-good.png`;
const thumbKey = `${assetPrefix}/fig-good-thumb.png`;
const noContentTypeKey = `${assetPrefix}/fig-noct.png`;
const missingKey = `${assetPrefix}/fig-missing.png`;
const hugeHeadKey = `${assetPrefix}/fig-huge-head.png`;
const nullBodyKey = `${assetPrefix}/fig-null-body.png`;
const hugeBodyKey = `${assetPrefix}/fig-huge-body.png`;
const foreignKey = `tenant-2/spaces/${spaceId}/fig-foreign.png`;

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createAuth() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [readToken]: { scopes: ["knowledge-spaces:read"], subjectId: "u1", tenantId: "tenant-1" },
      [writeToken]: { scopes: ["knowledge-spaces:*"], subjectId: "u1", tenantId: "tenant-1" },
    },
  });
}

function imageElement(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    metadata,
    sectionPath: ["Figures"],
    text: `Figure ${id}`,
    type: "image",
  };
}

function multimodalElements() {
  return [
    imageElement("fig-good", {
      assetRef: {
        contentType: "image/png",
        objectKey: goodKey,
        variants: { thumbnail: { contentType: "image/png", objectKey: thumbKey } },
      },
    }),
    imageElement("fig-plain", {}),
    imageElement("fig-external", { assetRef: { uri: "https://example.com/fig.png" } }),
    imageElement("fig-foreign", { assetRef: { contentType: "image/png", objectKey: foreignKey } }),
    imageElement("fig-noct", { assetRef: { objectKey: noContentTypeKey } }),
    imageElement("fig-missing", { assetRef: { contentType: "image/png", objectKey: missingKey } }),
    imageElement("fig-huge-head", {
      assetRef: { contentType: "image/png", objectKey: hugeHeadKey },
    }),
    imageElement("fig-null-body", {
      assetRef: { contentType: "image/png", objectKey: nullBodyKey },
    }),
    imageElement("fig-huge-body", {
      assetRef: { contentType: "image/png", objectKey: hugeBodyKey },
    }),
  ];
}

function createFixtureParser(): ParserAdapter {
  return {
    kind: "native-markdown",
    parse: async (input) =>
      ParseArtifactSchema.parse({
        artifactHash: "c".repeat(64),
        contentType: "mixed",
        createdAt: "2026-05-09T11:00:01.000Z",
        documentAssetId: input.documentAssetId,
        elements: multimodalElements(),
        id: artifactId,
        metadata: { filename: input.filename, mimeType: input.mimeType },
        parser: "native-markdown",
        version: input.version,
      }),
  };
}

function createAdapterWithStorageOverrides() {
  const baseAdapter = createNodePlatformAdapter({ env: {} });
  const fakeMetadata = (key: string, sizeBytes: number) => ({
    contentType: "image/png",
    key,
    metadata: {},
    sizeBytes,
  });

  return {
    adapter: {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        getObject: async (key: string) => {
          if (key === nullBodyKey) {
            return null;
          }
          if (key === hugeBodyKey) {
            return new Uint8Array(maxAssetReadBytes + 1);
          }
          return baseAdapter.objectStorage.getObject(key);
        },
        headObject: async (key: string) => {
          if (key === hugeHeadKey) {
            return fakeMetadata(key, maxAssetReadBytes + 1);
          }
          if (key === hugeBodyKey || key === nullBodyKey) {
            return fakeMetadata(key, 8);
          }
          return baseAdapter.objectStorage.headObject(key);
        },
      },
    },
    baseAdapter,
  };
}

interface TestHarness {
  app: ReturnType<typeof createKnowledgeGateway>;
  itemIdByElement: Map<string, string>;
}

async function createHarness(options: { enhance?: boolean } = {}): Promise<TestHarness> {
  const { adapter, baseAdapter } = createAdapterWithStorageOverrides();
  const documentAssets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
  const enhancerCalls: string[] = [];
  const app = createKnowledgeGateway({
    adapter,
    auth: createAuth(),
    documentAssets,
    ...(options.enhance
      ? {
          documentMultimodalManifestEnhancer: {
            enhance: async ({ manifest }) => {
              enhancerCalls.push(manifest.documentAssetId);
              return manifest;
            },
            model: "noop-enrichment",
            promptVersion: "noop-v1",
          },
        }
      : {}),
    generateDocumentAssetId: () => documentId,
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => spaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    parser: createFixtureParser(),
  });

  const createSpace = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Docs", slug: "docs" }),
    headers: { ...bearer(writeToken), "content-type": "application/json" },
    method: "POST",
  });
  expect(createSpace.status).toBe(201);

  for (const [key, bytes] of [
    [goodKey, pngBytes],
    [thumbKey, pngBytes],
    [noContentTypeKey, pngBytes],
  ] as const) {
    await baseAdapter.objectStorage.putObject({
      body: bytes,
      contentType: "image/png",
      key,
      metadata: {},
    });
  }

  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "Figures.md", { type: "text/markdown" }));
  const uploaded = await app.request(`/knowledge-spaces/${spaceId}/documents`, {
    body: form,
    headers: bearer(writeToken),
    method: "POST",
  });
  expect(uploaded.status).toBe(201);

  await documentAssets.create({
    filename: "bare.md",
    id: bareDocumentId,
    knowledgeSpaceId: spaceId,
    mimeType: "text/markdown",
    objectKey: `tenant-1/spaces/${spaceId}/documents/bare.md`,
    sha256: "a".repeat(64),
    sizeBytes: 3,
  });

  const manifestResponse = await app.request(
    `/knowledge-spaces/${spaceId}/documents/${documentId}/multimodal`,
    { headers: bearer(readToken) },
  );
  expect(manifestResponse.status).toBe(200);
  const manifest = await manifestResponse.json();
  const itemIdByElement = new Map<string, string>(
    manifest.items.map((item: { id: string; parseElementId: string }) => [
      item.parseElementId,
      item.id,
    ]),
  );
  if (options.enhance) {
    expect(enhancerCalls).toContain(documentId);
  }

  return { app, itemIdByElement };
}

function assetUrl(itemId: string, variant?: string) {
  const suffix = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return `/knowledge-spaces/${spaceId}/documents/${documentId}/multimodal/${encodeURIComponent(itemId)}/asset${suffix}`;
}

describe("document read handlers coverage", () => {
  it("returns 404 for reads on unknown spaces and documents", async () => {
    const { app } = await createHarness();

    const unknownSpacePaths = [
      `/knowledge-spaces/${unknownSpaceId}/documents`,
      `/knowledge-spaces/${unknownSpaceId}/documents/${documentId}/outline`,
      `/knowledge-spaces/${unknownSpaceId}/documents/${documentId}/multimodal`,
      `/knowledge-spaces/${unknownSpaceId}/documents/${documentId}/multimodal/item-1/asset`,
    ];
    for (const path of unknownSpacePaths) {
      const response = await app.request(path, { headers: bearer(readToken) });
      expect(response.status, path).toBe(404);
    }

    const unknownDocumentPaths = [
      `/knowledge-spaces/${spaceId}/documents/${unknownDocumentId}/outline`,
      `/knowledge-spaces/${spaceId}/documents/${unknownDocumentId}/multimodal`,
      `/knowledge-spaces/${spaceId}/documents/${unknownDocumentId}/multimodal/item-1/asset`,
    ];
    for (const path of unknownDocumentPaths) {
      const response = await app.request(path, { headers: bearer(readToken) });
      expect(response.status, path).toBe(404);
    }
  });

  it("returns 404 when outlines or parse artifacts are missing for a bare asset", async () => {
    const { app } = await createHarness();

    const outline = await app.request(
      `/knowledge-spaces/${spaceId}/documents/${bareDocumentId}/outline`,
      { headers: bearer(readToken) },
    );
    expect(outline.status).toBe(404);
    await expect(outline.json()).resolves.toEqual({ error: "Document outline not found" });

    const manifest = await app.request(
      `/knowledge-spaces/${spaceId}/documents/${bareDocumentId}/multimodal`,
      { headers: bearer(readToken) },
    );
    expect(manifest.status).toBe(404);
    await expect(manifest.json()).resolves.toEqual({
      error: "Document multimodal manifest not found",
    });

    const asset = await app.request(
      `/knowledge-spaces/${spaceId}/documents/${bareDocumentId}/multimodal/item-1/asset`,
      { headers: bearer(readToken) },
    );
    expect(asset.status).toBe(404);
    await expect(asset.json()).resolves.toEqual({
      error: "Document multimodal item asset not found",
    });
  });

  it("guards multimodal asset reads with item, variant, tenant, and size checks", async () => {
    const { app, itemIdByElement } = await createHarness();
    const itemId = (element: string) => {
      const id = itemIdByElement.get(element);
      if (!id) {
        throw new Error(`missing manifest item for ${element}`);
      }
      return id;
    };

    const unknownItem = await app.request(assetUrl("item-unknown"), {
      headers: bearer(readToken),
    });
    expect(unknownItem.status).toBe(404);

    const goodVariant = await app.request(assetUrl(itemId("fig-good"), "thumbnail"), {
      headers: bearer(readToken),
    });
    expect(goodVariant.status).toBe(200);
    expect(goodVariant.headers.get("x-document-multimodal-asset-variant")).toBe("thumbnail");

    const missingVariant = await app.request(assetUrl(itemId("fig-good"), "webp"), {
      headers: bearer(readToken),
    });
    expect(missingVariant.status).toBe(404);

    const plain = await app.request(assetUrl(itemId("fig-plain")), { headers: bearer(readToken) });
    expect(plain.status).toBe(404);

    const plainVariant = await app.request(assetUrl(itemId("fig-plain"), "thumbnail"), {
      headers: bearer(readToken),
    });
    expect(plainVariant.status).toBe(404);

    const external = await app.request(assetUrl(itemId("fig-external")), {
      headers: bearer(readToken),
    });
    expect(external.status).toBe(409);
    await expect(external.json()).resolves.toEqual({
      error: "Document multimodal item asset is external-only",
    });

    const foreign = await app.request(assetUrl(itemId("fig-foreign")), {
      headers: bearer(readToken),
    });
    expect(foreign.status).toBe(404);

    const noContentType = await app.request(assetUrl(itemId("fig-noct")), {
      headers: bearer(readToken),
    });
    expect(noContentType.status).toBe(200);
    expect(noContentType.headers.get("content-type")).toBe("image/png");
    expect(noContentType.headers.get("content-disposition")).toBe("inline");

    const missingObject = await app.request(assetUrl(itemId("fig-missing")), {
      headers: bearer(readToken),
    });
    expect(missingObject.status).toBe(404);

    const hugeHead = await app.request(assetUrl(itemId("fig-huge-head")), {
      headers: bearer(readToken),
    });
    expect(hugeHead.status).toBe(413);
    await expect(hugeHead.json()).resolves.toEqual({
      error: "Document multimodal item asset is too large",
    });

    const nullBody = await app.request(assetUrl(itemId("fig-null-body")), {
      headers: bearer(readToken),
    });
    expect(nullBody.status).toBe(404);

    const hugeBody = await app.request(assetUrl(itemId("fig-huge-body")), {
      headers: bearer(readToken),
    });
    expect(hugeBody.status).toBe(413);
  });

  it("routes multimodal manifests through a configured enhancer", async () => {
    const { itemIdByElement } = await createHarness({ enhance: true });

    expect(itemIdByElement.size).toBe(9);
  });
});
