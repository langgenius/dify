import { createHash } from "node:crypto";

import {
  type DocumentAsset,
  type DocumentMultimodalItem,
  type DocumentMultimodalManifest,
  type DocumentOutline,
  type DocumentOutlineNode,
  KNOWLEDGE_FS_VIRTUAL_PATH_MAX_LENGTH,
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
      const virtualPath = buildDocumentMultimodalAssetDescriptorVirtualPath({
        asset,
        item,
        siblingItems: manifest.items,
      });
      const filename = virtualPath.split("/").at(-1);
      if (!filename) throw new Error("Document multimodal asset path has no filename");

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
          filename,
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
          filename: documentMultimodalDescriptorFilename({
            asset,
            directory: "figures",
            item,
            siblingItems: manifest.items,
          }),
          generateId,
          item,
          publicationGenerationId: generationId,
          tenantId,
          virtualPath: buildDocumentMultimodalFigureDescriptorVirtualPath({
            asset,
            item,
            siblingItems: manifest.items,
          }),
        }),
      ),
    ...manifest.items
      .filter((item) => item.modality === "table")
      .map((item) =>
        buildDocumentMultimodalItemResourceKnowledgePath({
          asset,
          contentKind: "document-multimodal-table",
          filename: documentMultimodalDescriptorFilename({
            asset,
            directory: "tables",
            item,
            siblingItems: manifest.items,
          }),
          generateId,
          item,
          publicationGenerationId: generationId,
          tenantId,
          virtualPath: buildDocumentMultimodalTableDescriptorVirtualPath({
            asset,
            item,
            siblingItems: manifest.items,
          }),
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
  siblingItems,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
  readonly siblingItems?: readonly DocumentMultimodalItem[] | undefined;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/assets/${documentMultimodalDescriptorFilename({ asset, directory: "assets", item, siblingItems })}`;
}

export function buildDocumentMultimodalFigureDescriptorVirtualPath({
  asset,
  item,
  siblingItems,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
  readonly siblingItems?: readonly DocumentMultimodalItem[] | undefined;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/figures/${documentMultimodalDescriptorFilename({ asset, directory: "figures", item, siblingItems })}`;
}

export function buildDocumentMultimodalTableDescriptorVirtualPath({
  asset,
  item,
  siblingItems,
}: {
  readonly asset: DocumentAsset;
  readonly item: DocumentMultimodalItem;
  readonly siblingItems?: readonly DocumentMultimodalItem[] | undefined;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;

  return `${documentPath}/tables/${documentMultimodalDescriptorFilename({ asset, directory: "tables", item, siblingItems })}`;
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
    const sectionPrefix = `${documentPath}/sections/`;
    const extension = ".md";
    const sectionFilename = documentSectionFilename(
      node,
      KNOWLEDGE_FS_VIRTUAL_PATH_MAX_LENGTH - sectionPrefix.length - extension.length,
    );
    const virtualPath = `${sectionPrefix}${sectionFilename}${extension}`;

    return KnowledgePathSchema.parse({
      id: generationScopedKnowledgePathId({
        id: generateId(),
        publicationGenerationId: generationId,
        virtualPath,
      }),
      knowledgeSpaceId: asset.knowledgeSpaceId,
      metadata: {
        contentKind: "document-section",
        filename: `${sectionFilename}${extension}`,
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

function documentSectionFilename(node: DocumentOutlineNode, maxLength: number): string {
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
  const suffix = `--${shortId}`;
  const titleBudget = Math.max(1, maxLength - suffix.length);
  let boundedTitle = titleSlug.slice(0, titleBudget);
  if (/[\uD800-\uDBFF]$/u.test(boundedTitle)) boundedTitle = boundedTitle.slice(0, -1);
  boundedTitle = boundedTitle.replaceAll(/-+$/gu, "") || "section".slice(0, titleBudget);

  return `${boundedTitle}${suffix}`;
}

function documentMultimodalDescriptorFilename({
  asset,
  directory,
  item,
  siblingItems,
}: {
  readonly asset: DocumentAsset;
  readonly directory: "assets" | "figures" | "tables";
  readonly item: DocumentMultimodalItem;
  readonly siblingItems?: readonly DocumentMultimodalItem[] | undefined;
}): string {
  const documentPath = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(asset.filename, asset.id)}`;
  const filenameBudget =
    KNOWLEDGE_FS_VIRTUAL_PATH_MAX_LENGTH - `${documentPath}/${directory}/`.length;
  const prefix = `${item.modality}-`;
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
  const legacyShortId = item.id.replaceAll(/[^a-zA-Z0-9]/gu, "").slice(0, 8) || "asset";
  const legacyFilename = `${prefix}${slug}--${legacyShortId}.json`;
  const hasLegacyCollision =
    siblingItems?.some(
      (sibling) =>
        sibling.id !== item.id &&
        documentMultimodalItemBelongsToDirectory(sibling, directory) &&
        documentMultimodalLegacyFilename(sibling) === legacyFilename,
    ) ?? false;
  if (!hasLegacyCollision && legacyFilename.length <= filenameBudget) return legacyFilename;

  const digest = createHash("sha256").update(item.id, "utf8").digest("hex").slice(0, 16);
  const suffix = `--${digest}.json`;
  const titleBudget = filenameBudget - prefix.length - suffix.length;
  if (titleBudget < 1) {
    throw new Error("Document multimodal descriptor path has no filename title budget");
  }
  let boundedSlug = slug.slice(0, titleBudget);
  if (/[\uD800-\uDBFF]$/u.test(boundedSlug)) boundedSlug = boundedSlug.slice(0, -1);
  boundedSlug = boundedSlug.replaceAll(/-+$/gu, "") || item.modality.slice(0, titleBudget);

  return `${prefix}${boundedSlug}${suffix}`;
}

function documentMultimodalItemBelongsToDirectory(
  item: DocumentMultimodalItem,
  directory: "assets" | "figures" | "tables",
): boolean {
  if (directory === "assets") return item.assetRef !== undefined;
  if (directory === "figures") return item.modality === "image";
  return item.modality === "table";
}

function documentMultimodalLegacyFilename(item: DocumentMultimodalItem): string {
  const label =
    item.title ??
    item.caption ??
    item.textPreview ??
    item.sectionPath.filter(Boolean).at(-1) ??
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
