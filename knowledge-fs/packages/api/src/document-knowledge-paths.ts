import {
  type DocumentAsset,
  type DocumentMultimodalItem,
  type DocumentMultimodalManifest,
  type DocumentOutline,
  type DocumentOutlineNode,
  type KnowledgePath,
  KnowledgePathSchema,
  PublicationGenerationIdSchema,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";

export const KNOWLEDGE_FS_DOCS_ROOT = "/knowledge/docs";
export const KNOWLEDGE_FS_DOCS_VIEW_NAME = "docs";

export interface BuildDocumentKnowledgePathInput {
  readonly asset: DocumentAsset;
  readonly id: string;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
}

export function buildDocumentKnowledgePath({
  asset,
  id,
  publicationGenerationId,
  tenantId,
}: BuildDocumentKnowledgePathInput): KnowledgePath {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);
  const virtualPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return KnowledgePathSchema.parse({
    id: generationScopedKnowledgePathId({ id, publicationGenerationId: generationId, virtualPath }),
    knowledgeSpaceId: asset.knowledgeSpaceId,
    metadata: {
      filename: asset.filename,
      mimeType: asset.mimeType,
      objectKey: asset.objectKey,
      tenantId,
    },
    ...(generationId ? { publicationGenerationId: generationId } : {}),
    resourceType: "document",
    targetId: asset.id,
    version: asset.version,
    viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
    viewType: "physical",
    virtualPath,
  });
}

export function buildDocumentOutlineKnowledgePath({
  asset,
  id,
  publicationGenerationId,
  tenantId,
}: BuildDocumentKnowledgePathInput): KnowledgePath {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;
  const virtualPath = `${documentPath}/outline.json`;

  return KnowledgePathSchema.parse({
    id: generationScopedKnowledgePathId({ id, publicationGenerationId: generationId, virtualPath }),
    knowledgeSpaceId: asset.knowledgeSpaceId,
    metadata: {
      contentKind: "document-outline",
      filename: "outline.json",
      mimeType: "application/json",
      tenantId,
    },
    ...(generationId ? { publicationGenerationId: generationId } : {}),
    resourceType: "document",
    targetId: asset.id,
    version: asset.version,
    viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
    viewType: "physical",
    virtualPath,
  });
}

export function buildDocumentMultimodalManifestKnowledgePath({
  asset,
  id,
  publicationGenerationId,
  tenantId,
}: BuildDocumentKnowledgePathInput): KnowledgePath {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;
  const virtualPath = `${documentPath}/multimodal.json`;

  return KnowledgePathSchema.parse({
    id: generationScopedKnowledgePathId({ id, publicationGenerationId: generationId, virtualPath }),
    knowledgeSpaceId: asset.knowledgeSpaceId,
    metadata: {
      contentKind: "document-multimodal-manifest",
      filename: "multimodal.json",
      mimeType: "application/json",
      tenantId,
    },
    ...(generationId ? { publicationGenerationId: generationId } : {}),
    resourceType: "document",
    targetId: asset.id,
    version: asset.version,
    viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
    viewType: "physical",
    virtualPath,
  });
}

export function buildDocumentMultimodalAssetKnowledgePaths({
  asset,
  generateId,
  manifest,
  publicationGenerationId,
  tenantId,
}: {
  readonly asset: DocumentAsset;
  readonly generateId: () => string;
  readonly manifest: DocumentMultimodalManifest;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
}): KnowledgePath[] {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);

  return manifest.items
    .filter((item) => item.assetRef !== undefined)
    .map((item) => {
      const virtualPath = buildDocumentMultimodalAssetDescriptorVirtualPath({ asset, item });

      return KnowledgePathSchema.parse({
        id: generationScopedKnowledgePathId({
          id: generateId(),
          publicationGenerationId: generationId,
          virtualPath,
        }),
        knowledgeSpaceId: asset.knowledgeSpaceId,
        metadata: {
          ...(item.assetRef?.contentType ? { assetContentType: item.assetRef.contentType } : {}),
          ...(item.assetRef?.objectKey ? { objectKey: item.assetRef.objectKey } : {}),
          ...(item.assetRef?.sha256 ? { sha256: item.assetRef.sha256 } : {}),
          ...(item.assetRef?.uri ? { uri: item.assetRef.uri } : {}),
          ...(item.assetRef?.variants ? { assetVariants: item.assetRef.variants } : {}),
          contentKind: "document-multimodal-asset",
          filename: documentMultimodalAssetFilename(item),
          itemId: item.id,
          mimeType: "application/json",
          modality: item.modality,
          parseElementId: item.parseElementId,
          sectionPath: [...item.sectionPath],
          tenantId,
        },
        ...(generationId ? { publicationGenerationId: generationId } : {}),
        resourceType: "document",
        targetId: asset.id,
        version: asset.version,
        viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
        viewType: "physical",
        virtualPath,
      });
    });
}

export function buildDocumentMultimodalResourceKnowledgePaths({
  asset,
  generateId,
  manifest,
  publicationGenerationId,
  tenantId,
}: {
  readonly asset: DocumentAsset;
  readonly generateId: () => string;
  readonly manifest: DocumentMultimodalManifest;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
}): KnowledgePath[] {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);

  return [
    ...manifest.items
      .filter((item) => item.modality === "image")
      .map((item) =>
        buildDocumentMultimodalItemResourceKnowledgePath({
          asset,
          contentKind: "document-multimodal-figure",
          filename: documentMultimodalAssetFilename(item),
          generateId,
          item,
          publicationGenerationId: generationId,
          tenantId,
          virtualPath: buildDocumentMultimodalFigureDescriptorVirtualPath({ asset, item }),
        }),
      ),
    ...manifest.items
      .filter((item) => item.modality === "table")
      .map((item) =>
        buildDocumentMultimodalItemResourceKnowledgePath({
          asset,
          contentKind: "document-multimodal-table",
          filename: documentMultimodalAssetFilename(item),
          generateId,
          item,
          publicationGenerationId: generationId,
          tenantId,
          virtualPath: buildDocumentMultimodalTableDescriptorVirtualPath({ asset, item }),
        }),
      ),
    ...manifest.items
      .filter((item) => item.modality === "page" && item.pageNumber !== undefined)
      .map((item) =>
        buildDocumentMultimodalItemResourceKnowledgePath({
          asset,
          contentKind: "document-multimodal-page-thumbnail",
          filename: "thumbnail.json",
          generateId,
          item,
          publicationGenerationId: generationId,
          tenantId,
          virtualPath: buildDocumentMultimodalPageThumbnailVirtualPath({ asset, item }),
        }),
      ),
  ];
}

export function buildDocumentMultimodalAssetDescriptorVirtualPath({
  asset,
  item,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/assets/${documentMultimodalAssetFilename(item)}`;
}

export function buildDocumentMultimodalFigureDescriptorVirtualPath({
  asset,
  item,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/figures/${documentMultimodalAssetFilename(item)}`;
}

export function buildDocumentMultimodalTableDescriptorVirtualPath({
  asset,
  item,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/tables/${documentMultimodalAssetFilename(item)}`;
}

export function buildDocumentMultimodalPageThumbnailVirtualPath({
  asset,
  item,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/pages/${item.pageNumber ?? "unknown"}/thumbnail.json`;
}

export function buildDocumentSectionKnowledgePaths({
  asset,
  generateId,
  outline,
  publicationGenerationId,
  tenantId,
}: {
  readonly asset: DocumentAsset;
  readonly generateId: () => string;
  readonly outline: DocumentOutline;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
}): KnowledgePath[] {
  const generationId = normalizePublicationGenerationId(publicationGenerationId);
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return flattenOutlineNodes(outline.nodes).map((node) => {
    const virtualPath = `${documentPath}/sections/${documentSectionFilename(node)}.md`;

    return KnowledgePathSchema.parse({
      id: generationScopedKnowledgePathId({
        id: generateId(),
        publicationGenerationId: generationId,
        virtualPath,
      }),
      knowledgeSpaceId: asset.knowledgeSpaceId,
      metadata: {
        contentKind: "document-section",
        filename: `${documentSectionFilename(node)}.md`,
        mimeType: "text/markdown",
        outlineId: outline.id,
        outlineNodeId: node.id,
        sectionPath: [...node.sectionPath],
        tenantId,
        title: node.title,
      },
      ...(generationId ? { publicationGenerationId: generationId } : {}),
      resourceType: "document",
      targetId: asset.id,
      version: asset.version,
      viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
      viewType: "physical",
      virtualPath,
    });
  });
}

export function documentFilenamePathSegment(filename: string, documentAssetId: string): string {
  const normalized = filename
    .trim()
    .replaceAll(/[/\\]+/gu, "-")
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  const basename = normalized || "document";
  const shortId = documentAssetId.replaceAll("-", "").slice(0, 8);

  return `${basename}--${shortId}`;
}

function buildDocumentMultimodalItemResourceKnowledgePath({
  asset,
  contentKind,
  filename,
  generateId,
  item,
  publicationGenerationId,
  tenantId,
  virtualPath,
}: {
  readonly asset: DocumentAsset;
  readonly contentKind:
    | "document-multimodal-figure"
    | "document-multimodal-page-thumbnail"
    | "document-multimodal-table";
  readonly filename: string;
  readonly generateId: () => string;
  readonly item: DocumentMultimodalItem;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
  readonly virtualPath: string;
}): KnowledgePath {
  return KnowledgePathSchema.parse({
    id: generationScopedKnowledgePathId({
      id: generateId(),
      publicationGenerationId,
      virtualPath,
    }),
    knowledgeSpaceId: asset.knowledgeSpaceId,
    metadata: {
      ...(item.assetRef?.contentType ? { assetContentType: item.assetRef.contentType } : {}),
      ...(item.assetRef?.objectKey ? { objectKey: item.assetRef.objectKey } : {}),
      ...(item.assetRef?.sha256 ? { sha256: item.assetRef.sha256 } : {}),
      ...(item.assetRef?.uri ? { uri: item.assetRef.uri } : {}),
      ...(item.assetRef?.variants ? { assetVariants: item.assetRef.variants } : {}),
      ...(item.pageNumber !== undefined ? { pageNumber: item.pageNumber } : {}),
      contentKind,
      filename,
      itemId: item.id,
      mimeType: "application/json",
      modality: item.modality,
      parseElementId: item.parseElementId,
      sectionPath: [...item.sectionPath],
      tenantId,
    },
    ...(publicationGenerationId ? { publicationGenerationId } : {}),
    resourceType: "document",
    targetId: asset.id,
    version: asset.version,
    viewName: KNOWLEDGE_FS_DOCS_VIEW_NAME,
    viewType: "physical",
    virtualPath,
  });
}

function generationScopedKnowledgePathId({
  id,
  publicationGenerationId,
  virtualPath,
}: {
  readonly id: string;
  readonly publicationGenerationId?: string | undefined;
  readonly virtualPath: string;
}): string {
  return publicationGenerationId === undefined
    ? id
    : deterministicChildId(publicationGenerationId, `knowledge-path:${virtualPath}`);
}

function normalizePublicationGenerationId(
  publicationGenerationId: string | undefined,
): string | undefined {
  return publicationGenerationId === undefined
    ? undefined
    : PublicationGenerationIdSchema.parse(publicationGenerationId);
}

function flattenOutlineNodes(nodes: readonly DocumentOutlineNode[]): DocumentOutlineNode[] {
  return nodes.flatMap((node) => [node, ...flattenOutlineNodes(node.children)]);
}

function documentSectionFilename(node: DocumentOutlineNode): string {
  const titleSlug =
    node.sectionPath
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join("--")
      .replaceAll(/[/\\]+/gu, "-")
      .replaceAll(/\s+/gu, "-")
      .replaceAll(/-+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "section";
  const shortId = node.id.replaceAll("-", "").slice(0, 8);

  return `${titleSlug}--${shortId}`;
}

function documentMultimodalAssetFilename(item: DocumentMultimodalItem): string {
  const label =
    item.title ??
    item.caption ??
    item.parseElementId
      .split(/[:/\\]/u)
      .filter(Boolean)
      .at(-1) ??
    item.modality;
  const slug =
    label
      .trim()
      .replaceAll(/[/\\]+/gu, "-")
      .replaceAll(/\s+/gu, "-")
      .replaceAll(/-+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || item.modality;
  const shortId = item.id.replaceAll(/[^a-zA-Z0-9]/gu, "").slice(0, 8) || "asset";

  return `${item.modality}-${slug}--${shortId}.json`;
}
