import { createHash } from "node:crypto";

import { type ParseArtifact, ParseArtifactSchema, stableJson } from "@knowledge/core";

import { cloneJsonObject, isPlainObject } from "./json-utils";

const materializationContractVersion = 1;

/**
 * Makes durable visual bytes part of parse-artifact lineage without hashing attempt-scoped object
 * keys. Re-running the same parser output with the same visual material is therefore idempotent,
 * while a renderer/model/configuration change that changes bytes or relevant crop semantics
 * produces a new publication fingerprint.
 */
export function finalizeDocumentMultimodalArtifact(artifact: ParseArtifact): ParseArtifact {
  const existingMaterialization = isPlainObject(artifact.metadata.multimodalMaterialization)
    ? artifact.metadata.multimodalMaterialization
    : {};
  const sourceArtifactHash =
    typeof existingMaterialization.sourceArtifactHash === "string" &&
    /^[a-f0-9]{64}$/u.test(existingMaterialization.sourceArtifactHash)
      ? existingMaterialization.sourceArtifactHash
      : artifact.artifactHash;
  const visualMaterial = artifact.elements.flatMap((element, ordinal) => {
    const assetRef = isPlainObject(element.metadata.assetRef) ? element.metadata.assetRef : {};
    const sha256 = sha256Value(assetRef.sha256);

    if (!sha256) {
      return [];
    }

    return [
      {
        asset: {
          contentType: stringValue(assetRef.contentType),
          cropKind: stringValue(assetRef.cropKind),
          height: numberValue(assetRef.height),
          sha256,
          source: stringValue(assetRef.source),
          variants: materializedVariants(assetRef.variants),
          width: numberValue(assetRef.width),
        },
        ordinal,
        pdfRaster: materializedPdfRaster(element.metadata.pdfRaster),
        type: element.type,
      },
    ];
  });

  if (visualMaterial.length === 0) {
    return artifact;
  }

  const digest = createHash("sha256")
    .update(
      stableJson({
        contractVersion: materializationContractVersion,
        sourceArtifactHash,
        visualMaterial,
      }),
    )
    .digest("hex");

  return ParseArtifactSchema.parse({
    ...artifact,
    artifactHash: digest,
    metadata: {
      ...cloneJsonObject(artifact.metadata),
      multimodalMaterialization: {
        assetCount: visualMaterial.length,
        contractVersion: materializationContractVersion,
        digest,
        sourceArtifactHash,
      },
    },
  });
}

function materializedVariants(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, candidate]) => {
      if (!isPlainObject(candidate)) {
        return [];
      }
      const sha256 = sha256Value(candidate.sha256);

      return sha256
        ? [
            [
              name,
              {
                contentType: stringValue(candidate.contentType),
                height: numberValue(candidate.height),
                sha256,
                width: numberValue(candidate.width),
              },
            ],
          ]
        : [];
    }),
  );
}

function materializedPdfRaster(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const renderer = isPlainObject(value.renderer) ? value.renderer : {};

  return {
    boundingBox: jsonValue(value.boundingBox),
    cropKind: stringValue(value.cropKind),
    geometry: jsonValue(value.geometry),
    pageNumber: numberValue(value.pageNumber),
    renderer: {
      dimensionCapped: booleanValue(renderer.dimensionCapped),
      dpi: numberValue(renderer.dpi),
      thumbnailDpi: numberValue(renderer.thumbnailDpi),
      variant: stringValue(renderer.variant),
    },
  };
}

function sha256Value(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function jsonValue(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((item) => jsonValue(item))
    : isPlainObject(value)
      ? cloneJsonObject(value)
      : (value ?? null);
}
