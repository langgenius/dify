import { createDefaultKnowledgeSpaceManifest } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DocumentAssetKnowledgeSpaceManifestNotFoundError,
  DocumentAssetTenantContextRequiredError,
  createEmbeddingProfileFreezingDocumentAssetRepository,
} from "./document-asset-embedding-profile-guard";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createInMemoryKnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";

const TENANT_ID = "tenant-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const MANIFEST_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const NOW = "2026-07-13T14:00:00.000Z";
const LATER = "2026-07-13T15:00:00.000Z";

function assetInput(tenantId?: string) {
  return {
    filename: "architecture.md",
    id: ASSET_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: { tenantId: TENANT_ID },
    mimeType: "text/markdown",
    objectKey: `${TENANT_ID}/spaces/${SPACE_ID}/documents/${ASSET_ID}/architecture.md`,
    sha256: "a".repeat(64),
    sizeBytes: 42,
    ...(tenantId === undefined ? {} : { tenantId }),
  };
}

async function setup() {
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 4, now: () => NOW });
  const manifests = createInMemoryKnowledgeSpaceManifestRepository({
    maxListLimit: 4,
    maxManifests: 4,
  });
  await manifests.create(
    createDefaultKnowledgeSpaceManifest({
      createdAt: NOW,
      id: MANIFEST_ID,
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      updatedAt: NOW,
    }),
  );

  return { assets, manifests };
}

describe("embedding-profile freezing document asset repository", () => {
  it("freezes the manifest before create and keeps the latch monotonic", async () => {
    const { assets, manifests } = await setup();
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({
      assets,
      manifests,
      now: () => LATER,
    });

    await expect(guarded.create(assetInput(TENANT_ID))).resolves.toMatchObject({
      id: ASSET_ID,
    });
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      embeddingProfileFrozenAt: LATER,
      manifestVersion: 2,
      metadata: {},
    });

    await expect(
      guarded.create({
        ...assetInput(TENANT_ID),
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      }),
    ).resolves.toBeTruthy();
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ embeddingProfileFrozenAt: LATER, manifestVersion: 2 });
  });

  it("requires an explicit authenticated tenant context", async () => {
    const { assets, manifests } = await setup();
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({ assets, manifests });
    for (const tenantId of [undefined, "", "   "]) {
      await expect(guarded.create(assetInput(tenantId))).rejects.toBeInstanceOf(
        DocumentAssetTenantContextRequiredError,
      );
    }

    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ manifestVersion: 1 });
    await expect(assets.getStorageUsage({ knowledgeSpaceId: SPACE_ID })).resolves.toEqual({
      documentCount: 0,
      rawDocumentBytes: 0,
    });
  });

  it("fails closed when the tenant-scoped manifest does not exist", async () => {
    const { assets, manifests } = await setup();
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({ assets, manifests });

    await expect(guarded.create(assetInput("other-tenant"))).rejects.toBeInstanceOf(
      DocumentAssetKnowledgeSpaceManifestNotFoundError,
    );
    await expect(assets.getStorageUsage({ knowledgeSpaceId: SPACE_ID })).resolves.toMatchObject({
      documentCount: 0,
    });
  });

  it("can bootstrap and freeze a legacy space before admitting its first new asset", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 4, now: () => NOW });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 4,
      maxManifests: 4,
    });
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({
      assets,
      ensureManifest: async ({ knowledgeSpaceId, tenantId }) => {
        await manifests.create(
          createDefaultKnowledgeSpaceManifest({
            createdAt: NOW,
            id: MANIFEST_ID,
            knowledgeSpaceId,
            tenantId,
            updatedAt: NOW,
          }),
        );
      },
      manifests,
      now: () => LATER,
    });

    await expect(guarded.create(assetInput(TENANT_ID))).resolves.toMatchObject({ id: ASSET_ID });
    const legacyManifest = await manifests.get({
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    expect(legacyManifest).toMatchObject({
      embeddingProfileFrozenAt: LATER,
      manifestVersion: 2,
    });
    expect(legacyManifest?.embeddingProfile).toBeUndefined();
  });

  it("does not reopen the latch when the downstream asset create fails", async () => {
    const { assets, manifests } = await setup();
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({
      assets: {
        ...assets,
        create: async () => {
          throw new Error("simulated asset write failure");
        },
      },
      manifests,
      now: () => LATER,
    });

    await expect(guarded.create(assetInput(TENANT_ID))).rejects.toThrow(
      "simulated asset write failure",
    );
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ embeddingProfileFrozenAt: LATER, manifestVersion: 2 });
  });

  it("leaves non-create methods untouched", async () => {
    const { assets, manifests } = await setup();
    const guarded = createEmbeddingProfileFreezingDocumentAssetRepository({ assets, manifests });

    expect(guarded.rollbackStaleWrite).toBe(assets.rollbackStaleWrite);
    expect(guarded.get).toBe(assets.get);
    expect(guarded.getStorageUsage).toBe(assets.getStorageUsage);
    expect(guarded.list).toBe(assets.list);
    expect(guarded.listBySource).toBe(assets.listBySource);
    expect(guarded.updateParserStatus).toBe(assets.updateParserStatus);
  });
});
