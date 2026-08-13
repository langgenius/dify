import { createHash } from "node:crypto";

import { type ParseArtifact, ParseArtifactSchema, stableJson } from "@knowledge/core";

const DEFAULT_MAX_ELEMENTS = 20_000;
const LAYOUT_RECOMPOSITION_SCHEMA_VERSION = 1;

export interface DocumentLayoutRecompositionOptions {
  readonly maxElements?: number | undefined;
}

export interface DocumentLayoutRecompositionStats {
  readonly elementsRecomposed: number;
  readonly modelDecidedHeadingBoundaries: number;
  readonly trustedHeadingBoundaries: number;
}

export interface DocumentLayoutRecompositionResult {
  readonly artifact: ParseArtifact;
  readonly fingerprint: string;
  readonly stats: DocumentLayoutRecompositionStats;
}

/**
 * Produces the bounded parser view consumed by semantic segmentation.
 *
 * Native Markdown/HTML headings are authored structure and remain authoritative. Unstructured
 * `Title`/`Heading` labels are only hard boundaries when the provider supplied explicit hierarchy
 * evidence (`category_depth` or `parent_id`). Other labels remain visible to the reasoning model as
 * title/heading units, but cannot fragment its input merely because a layout classifier guessed
 * that a company name, tax id, or form field was a heading.
 *
 * Element order, text, ids, pages, and source metadata are never rewritten. This keeps canonical
 * byte offsets stable while making boundary confidence explicit and replayable.
 */
export function recomposeDocumentLayoutForSemanticSegmentation(
  input: ParseArtifact,
  { maxElements = DEFAULT_MAX_ELEMENTS }: DocumentLayoutRecompositionOptions = {},
): DocumentLayoutRecompositionResult {
  if (!Number.isSafeInteger(maxElements) || maxElements < 1) {
    throw new Error("Document layout recomposition maxElements must be at least 1");
  }

  const artifact = ParseArtifactSchema.parse(input);
  if (artifact.elements.length > maxElements) {
    throw new Error(`Document layout recomposition exceeds maxElements=${maxElements}`);
  }

  if (artifact.parser !== "unstructured") {
    const unchanged = ParseArtifactSchema.parse(artifact);
    return {
      artifact: unchanged,
      fingerprint: layoutRecompositionFingerprint(unchanged),
      stats: {
        elementsRecomposed: 0,
        modelDecidedHeadingBoundaries: 0,
        trustedHeadingBoundaries: 0,
      },
    };
  }

  let currentTrustedPath: string[] = [];
  let modelDecidedHeadingBoundaries = 0;
  let trustedHeadingBoundaries = 0;
  const elements = artifact.elements.map((element) => {
    const heading = element.type === "title" || element.type === "heading";
    if (heading && hasExplicitHierarchyEvidence(element.metadata)) {
      currentTrustedPath = [...element.sectionPath];
      trustedHeadingBoundaries += 1;
      return {
        ...element,
        metadata: { ...element.metadata },
        sectionPath: [...currentTrustedPath],
      };
    }

    if (heading) {
      modelDecidedHeadingBoundaries += 1;
      return {
        ...element,
        metadata: {
          ...element.metadata,
          layoutRecomposition: {
            boundaryPolicy: "reasoning-model",
            originalSectionPath: [...element.sectionPath],
            originalType: element.type,
            reason: "unstructured-heading-without-hierarchy-evidence",
            schemaVersion: LAYOUT_RECOMPOSITION_SCHEMA_VERSION,
          },
        },
        sectionPath: [...currentTrustedPath],
      };
    }

    const sectionPathChanged = !sameStrings(element.sectionPath, currentTrustedPath);
    return {
      ...element,
      metadata: {
        ...element.metadata,
        ...(sectionPathChanged
          ? {
              layoutRecomposition: {
                boundaryPolicy: "reasoning-model",
                originalSectionPath: [...element.sectionPath],
                reason: "inherited-untrusted-heading-boundary",
                schemaVersion: LAYOUT_RECOMPOSITION_SCHEMA_VERSION,
              },
            }
          : {}),
      },
      sectionPath: [...currentTrustedPath],
    };
  });
  const recomposed = ParseArtifactSchema.parse({ ...artifact, elements });

  return {
    artifact: recomposed,
    fingerprint: layoutRecompositionFingerprint(recomposed),
    stats: {
      elementsRecomposed: recomposed.elements.length,
      modelDecidedHeadingBoundaries,
      trustedHeadingBoundaries,
    },
  };
}

function hasExplicitHierarchyEvidence(metadata: Readonly<Record<string, unknown>>): boolean {
  const categoryDepth = metadata.category_depth;
  const parentId = metadata.parent_id;
  return (
    (typeof categoryDepth === "number" && Number.isInteger(categoryDepth) && categoryDepth >= 0) ||
    (typeof parentId === "string" && parentId.trim().length > 0)
  );
}

function layoutRecompositionFingerprint(artifact: ParseArtifact): string {
  return `sha256:${createHash("sha256")
    .update(
      stableJson({
        artifactHash: artifact.artifactHash,
        elements: artifact.elements.map((element) => ({
          id: element.id,
          metadata: element.metadata,
          pageNumber: element.pageNumber,
          sectionPath: element.sectionPath,
          text: element.text,
          type: element.type,
        })),
        schemaVersion: LAYOUT_RECOMPOSITION_SCHEMA_VERSION,
      }),
    )
    .digest("hex")}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
