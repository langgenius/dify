import type { DocumentMultimodalAssetRef } from "@knowledge/core";

import type { DocumentAssetRepository } from "./document-asset-repository";
import { buildDocumentMultimodalAssetDescriptorVirtualPath } from "./document-knowledge-paths";
import {
  type DocumentMultimodalManifestBuilder,
  createDocumentMultimodalManifestBuilder,
} from "./document-multimodal-manifest-builder";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { cloneJsonObject } from "./json-utils";
import type { ParseArtifactRepository } from "./parse-artifact-repository";

export interface DocumentMultimodalCandidateResolver {
  resolve(input: ResolveDocumentMultimodalCandidateInput): Promise<Record<string, unknown> | null>;
}

export interface ResolveDocumentMultimodalCandidateInput {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly knowledgeSpaceId: string;
}

export interface DocumentMultimodalCandidateResolverOptions {
  readonly assets: DocumentAssetRepository;
  readonly manifestBuilder?: DocumentMultimodalManifestBuilder | undefined;
  readonly manifests?: DocumentMultimodalManifestRepository | undefined;
  readonly parseArtifacts: ParseArtifactRepository;
}

export function createDocumentMultimodalCandidateResolver({
  assets,
  manifestBuilder = createDocumentMultimodalManifestBuilder(),
  manifests,
  parseArtifacts,
}: DocumentMultimodalCandidateResolverOptions): DocumentMultimodalCandidateResolver {
  return {
    resolve: async ({ candidate, knowledgeSpaceId }) => {
      const documentAssetId = metadataString(candidate, "documentAssetId");
      const documentVersion = metadataInteger(candidate, "documentVersion");
      const parseElementId = metadataString(candidate, "parseElementId");

      if (!documentAssetId || documentVersion === undefined || !parseElementId) {
        return null;
      }

      const asset = await assets.get({
        id: documentAssetId,
        knowledgeSpaceId,
      });

      if (!asset) {
        return null;
      }

      const artifact = await parseArtifacts.getByDocumentVersion({
        documentAssetId,
        version: documentVersion,
      });

      if (!artifact) {
        return null;
      }

      const deterministicManifest = manifestBuilder.build({
        artifact,
        knowledgeSpaceId,
      });
      const persisted = manifests
        ? await manifests.getByDocumentVersion({ documentAssetId, version: documentVersion })
        : null;
      const manifest =
        persisted &&
        persisted.artifactHash === artifact.artifactHash &&
        persisted.parseArtifactId === artifact.id &&
        persisted.manifestVersion === deterministicManifest.manifestVersion
          ? persisted
          : deterministicManifest;
      const item = manifest.items.find((entry) => entry.parseElementId === parseElementId);

      if (!item) {
        return null;
      }

      return {
        ...cloneJsonObject(candidate),
        ...(item.assetRef ? { assetRef: cloneAssetRef(item.assetRef) } : {}),
        ...(item.boundingBox ? { boundingBox: { ...item.boundingBox } } : {}),
        // Carry the resolved visual text so text-only answers can ground on OCR/caption content,
        // not just the asset route.
        ...(item.caption ? { caption: item.caption } : {}),
        ...(item.ocrText ? { ocrText: item.ocrText } : {}),
        ...(item.textPreview ? { textPreview: item.textPreview } : {}),
        ...(item.endOffset !== undefined ? { endOffset: item.endOffset } : {}),
        ...(item.pageNumber !== undefined ? { pageNumber: item.pageNumber } : {}),
        ...(item.startOffset !== undefined ? { startOffset: item.startOffset } : {}),
        assetDescriptorPath: buildDocumentMultimodalAssetDescriptorVirtualPath({ asset, item }),
        ...(item.assetRef?.objectKey
          ? {
              assetRoute: `/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/documents/${encodeURIComponent(
                documentAssetId,
              )}/multimodal/${encodeURIComponent(item.id)}/asset`,
            }
          : {}),
        manifestId: manifest.id,
        manifestItemId: item.id,
        modality: item.modality,
        parseArtifactId: artifact.id,
        sectionPath: [...item.sectionPath],
      };
    },
  };
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataInteger(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function cloneAssetRef(assetRef: DocumentMultimodalAssetRef): DocumentMultimodalAssetRef {
  return {
    ...(assetRef.contentType ? { contentType: assetRef.contentType } : {}),
    ...(assetRef.objectKey ? { objectKey: assetRef.objectKey } : {}),
    ...(assetRef.sha256 ? { sha256: assetRef.sha256 } : {}),
    ...(assetRef.uri && !isDataUri(assetRef.uri) ? { uri: assetRef.uri } : {}),
  };
}

function isDataUri(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith("data:");
}
