import {
  DocumentAssetSchema,
  type DocumentMultimodalManifest,
  type DocumentOutline,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  buildDocumentKnowledgePath,
  buildDocumentMultimodalAssetDescriptorVirtualPath,
  buildDocumentMultimodalAssetKnowledgePaths,
  buildDocumentMultimodalFigureDescriptorVirtualPath,
  buildDocumentMultimodalManifestKnowledgePath,
  buildDocumentMultimodalPageThumbnailVirtualPath,
  buildDocumentMultimodalResourceKnowledgePaths,
  buildDocumentMultimodalTableDescriptorVirtualPath,
  buildDocumentOutlineKnowledgePath,
  buildDocumentSectionKnowledgePaths,
  documentFilenamePathSegment,
} from "./document-knowledge-paths";

describe("document KnowledgeFS paths", () => {
  it("builds readable filename paths with short ids for duplicate-safe documents", () => {
    expect(
      documentFilenamePathSegment("Dify 插件/说明.md", "6c07b8ca-dd64-4ccd-a6e9-91f816795412"),
    ).toBe("Dify-插件-说明.md--6c07b8ca");

    const asset = DocumentAssetSchema.parse({
      createdAt: "2026-06-03T00:00:00.000Z",
      filename: "Dify 插件/说明.md",
      id: "6c07b8ca-dd64-4ccd-a6e9-91f816795412",
      knowledgeSpaceId: "ab96d0c6-5853-4979-ba1a-98128e54fa7d",
      metadata: {},
      mimeType: "text/markdown",
      objectKey: "tenant-dev/spaces/space/documents/doc/dify.md",
      parserStatus: "parsed",
      sha256: "a".repeat(64),
      sizeBytes: 42,
      version: 1,
    });

    expect(
      buildDocumentKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-dev",
      }),
    ).toMatchObject({
      metadata: { filename: "Dify 插件/说明.md" },
      resourceType: "document",
      targetId: asset.id,
      viewName: "docs",
      viewType: "physical",
      virtualPath: "/knowledge/docs/Dify-插件-说明.md--6c07b8ca",
    });
    expect(
      buildDocumentOutlineKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        tenantId: "tenant-dev",
      }),
    ).toMatchObject({
      metadata: {
        contentKind: "document-outline",
        filename: "outline.json",
        mimeType: "application/json",
      },
      resourceType: "document",
      targetId: asset.id,
      viewName: "docs",
      viewType: "physical",
      virtualPath: "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/outline.json",
    });
    expect(
      buildDocumentMultimodalManifestKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        tenantId: "tenant-dev",
      }),
    ).toMatchObject({
      metadata: {
        contentKind: "document-multimodal-manifest",
        filename: "multimodal.json",
        mimeType: "application/json",
      },
      resourceType: "document",
      targetId: asset.id,
      viewName: "docs",
      viewType: "physical",
      virtualPath: "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/multimodal.json",
    });
    const multimodalManifest = documentMultimodalManifest(asset.id, asset.knowledgeSpaceId);
    const multimodalItem = multimodalManifest.items[0];

    if (!multimodalItem) {
      throw new Error("Expected multimodal manifest fixture item");
    }

    expect(
      buildDocumentMultimodalAssetKnowledgePaths({
        asset,
        generateId: sequenceIds(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c45"]),
        manifest: multimodalManifest,
        tenantId: "tenant-dev",
      }),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          assetContentType: "image/png",
          contentKind: "document-multimodal-asset",
          filename: "image-架构图--018f0d60.json",
          itemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47:0:figure-1",
          mimeType: "application/json",
          modality: "image",
          objectKey:
            "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/figure-1.png",
          parseElementId: "figure-1",
          sectionPath: ["概览", "架构"],
          assetVariants: expect.objectContaining({
            thumbnail: expect.objectContaining({
              objectKey:
                "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/figure-1-thumbnail.png",
            }),
          }),
        }),
        resourceType: "document",
        targetId: asset.id,
        virtualPath:
          "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/assets/image-架构图--018f0d60.json",
      }),
    ]);
    expect(
      buildDocumentMultimodalAssetDescriptorVirtualPath({
        asset,
        item: multimodalItem,
      }),
    ).toBe("/knowledge/docs/Dify-插件-说明.md--6c07b8ca/assets/image-架构图--018f0d60.json");
    const resourceManifest = documentMultimodalResourceManifest(asset.id, asset.knowledgeSpaceId);
    const [figureItem, tableItem, pageItem] = resourceManifest.items;

    if (!figureItem || !tableItem || !pageItem) {
      throw new Error("Expected multimodal resource fixture items");
    }

    expect(
      buildDocumentMultimodalResourceKnowledgePaths({
        asset,
        generateId: sequenceIds([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        ]),
        manifest: resourceManifest,
        tenantId: "tenant-dev",
      }),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-multimodal-figure",
          itemId: figureItem.id,
          modality: "image",
          pageNumber: 2,
        }),
        virtualPath:
          "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/figures/image-架构图--018f0d60.json",
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-multimodal-table",
          itemId: tableItem.id,
          modality: "table",
        }),
        virtualPath:
          "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/tables/table-ARR-table--018f0d60.json",
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          assetVariants: expect.objectContaining({
            thumbnail: expect.objectContaining({
              objectKey:
                "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/page-2-thumbnail.png",
            }),
          }),
          contentKind: "document-multimodal-page-thumbnail",
          itemId: pageItem.id,
          modality: "page",
          pageNumber: 2,
        }),
        virtualPath: "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/pages/2/thumbnail.json",
      }),
    ]);
    expect(buildDocumentMultimodalFigureDescriptorVirtualPath({ asset, item: figureItem })).toBe(
      "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/figures/image-架构图--018f0d60.json",
    );
    expect(buildDocumentMultimodalTableDescriptorVirtualPath({ asset, item: tableItem })).toBe(
      "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/tables/table-ARR-table--018f0d60.json",
    );
    expect(buildDocumentMultimodalPageThumbnailVirtualPath({ asset, item: pageItem })).toBe(
      "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/pages/2/thumbnail.json",
    );
    expect(
      buildDocumentSectionKnowledgePaths({
        asset,
        generateId: sequenceIds(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c48"]),
        outline: documentOutline(asset.id, asset.knowledgeSpaceId),
        tenantId: "tenant-dev",
      }),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-section",
          filename: "概览-架构--outline0.md",
          mimeType: "text/markdown",
          outlineNodeId: "outline-001",
          sectionPath: ["概览", "架构"],
          title: "架构",
        }),
        resourceType: "document",
        targetId: asset.id,
        virtualPath: "/knowledge/docs/Dify-插件-说明.md--6c07b8ca/sections/概览-架构--outline0.md",
      }),
    ]);

    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60";
    const candidatePaths = [
      buildDocumentKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
      buildDocumentOutlineKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
      buildDocumentMultimodalManifestKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
      ...buildDocumentMultimodalAssetKnowledgePaths({
        asset,
        generateId: sequenceIds(["018f0d60-7a49-7cc2-9c1b-5b36f18f2d03"]),
        manifest: multimodalManifest,
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
      ...buildDocumentMultimodalResourceKnowledgePaths({
        asset,
        generateId: sequenceIds([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d06",
        ]),
        manifest: resourceManifest,
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
      ...buildDocumentSectionKnowledgePaths({
        asset,
        generateId: sequenceIds(["018f0d60-7a49-7cc2-9c1b-5b36f18f2d07"]),
        outline: documentOutline(asset.id, asset.knowledgeSpaceId),
        publicationGenerationId,
        tenantId: "tenant-dev",
      }),
    ];
    const retriedOutlinePath = buildDocumentOutlineKnowledgePath({
      asset,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d08",
      publicationGenerationId,
      tenantId: "tenant-dev",
    });
    const nextGenerationOutlinePath = buildDocumentOutlineKnowledgePath({
      asset,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d08",
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      tenantId: "tenant-dev",
    });

    expect(
      candidatePaths.every((path) => path.publicationGenerationId === publicationGenerationId),
    ).toBe(true);
    expect(retriedOutlinePath.id).toBe(candidatePaths[1]?.id);
    expect(nextGenerationOutlinePath.id).not.toBe(candidatePaths[1]?.id);
    expect(() =>
      buildDocumentKnowledgePath({
        asset,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d09",
        publicationGenerationId: "",
        tenantId: "tenant-dev",
      }),
    ).toThrow();
    expect(() =>
      buildDocumentMultimodalAssetKnowledgePaths({
        asset,
        generateId: sequenceIds(["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"]),
        manifest: { ...multimodalManifest, items: [] },
        publicationGenerationId: "",
        tenantId: "tenant-dev",
      }),
    ).toThrow();
  });
});

function documentOutline(documentAssetId: string, knowledgeSpaceId: string): DocumentOutline {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-06-03T00:00:00.000Z",
    documentAssetId,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    knowledgeSpaceId,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        id: "outline-001",
        level: 2,
        metadata: {},
        sectionPath: ["概览", "架构"],
        sourceElementIds: ["element-1"],
        sourceNodeIds: [],
        summary: "架构 summary.",
        title: "架构",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "document-outline-v1",
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
    version: 1,
  };
}

function documentMultimodalManifest(
  documentAssetId: string,
  knowledgeSpaceId: string,
): DocumentMultimodalManifest {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-06-03T00:00:00.000Z",
    documentAssetId,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
    items: [
      {
        assetRef: {
          contentType: "image/png",
          objectKey:
            "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/figure-1.png",
          sha256: "b".repeat(64),
          variants: {
            thumbnail: {
              contentType: "image/png",
              objectKey:
                "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/figure-1-thumbnail.png",
              sha256: "c".repeat(64),
            },
          },
        },
        caption: "架构图",
        enrichment: {
          asset: "provided",
          caption: "provided",
          ocr: "missing",
          tableStructure: "unsupported",
          visualEmbedding: "missing",
        },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47:0:figure-1",
        modality: "image",
        pageNumber: 2,
        parseElementId: "figure-1",
        sectionPath: ["概览", "架构"],
        sourceMetadata: {},
      },
    ],
    knowledgeSpaceId,
    manifestVersion: "document-multimodal-manifest-v1",
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
    version: 1,
  };
}

function documentMultimodalResourceManifest(
  documentAssetId: string,
  knowledgeSpaceId: string,
): DocumentMultimodalManifest {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-06-03T00:00:00.000Z",
    documentAssetId,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    items: [
      {
        assetRef: {
          contentType: "image/png",
          objectKey:
            "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/figure-1.png",
          sha256: "b".repeat(64),
        },
        caption: "架构图",
        enrichment: {
          asset: "provided",
          caption: "provided",
          ocr: "missing",
          tableStructure: "unsupported",
          visualEmbedding: "missing",
        },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47:0:figure-1",
        modality: "image",
        pageNumber: 2,
        parseElementId: "figure-1",
        sectionPath: ["概览", "架构"],
        sourceMetadata: {},
      },
      {
        enrichment: {
          asset: "unsupported",
          caption: "unsupported",
          ocr: "provided",
          tableStructure: "provided",
          visualEmbedding: "unsupported",
        },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47:1:table-1",
        modality: "table",
        parseElementId: "table-1",
        sectionPath: ["Metrics"],
        sourceMetadata: {},
        textPreview: "ARR | $12M",
        title: "ARR table",
      },
      {
        assetRef: {
          contentType: "image/png",
          objectKey:
            "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/page-2.png",
          sha256: "d".repeat(64),
          variants: {
            thumbnail: {
              contentType: "image/png",
              objectKey:
                "tenant-dev/spaces/ab96d0c6-5853-4979-ba1a-98128e54fa7d/documents/6c07b8ca-dd64-4ccd-a6e9-91f816795412/assets/page-2-thumbnail.png",
              sha256: "e".repeat(64),
            },
          },
        },
        enrichment: {
          asset: "provided",
          caption: "unsupported",
          ocr: "unsupported",
          tableStructure: "unsupported",
          visualEmbedding: "missing",
        },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47:2:page-2",
        modality: "page",
        pageNumber: 2,
        parseElementId: "page-2",
        sectionPath: [],
        sourceMetadata: {},
      },
    ],
    knowledgeSpaceId,
    manifestVersion: "document-multimodal-manifest-v1",
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
    version: 1,
  };
}

function sequenceIds(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("No test id left");
    }

    index += 1;
    return id;
  };
}
