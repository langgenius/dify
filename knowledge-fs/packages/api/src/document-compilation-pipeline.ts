import {
  type ArtifactSegment,
  type DocumentAsset,
  type ObjectStorageAdapter,
  type ParseArtifact,
  ParseArtifactSchema,
  PublicationGenerationIdSchema,
} from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import type { DocumentImageVariantGenerator } from "./document-image-variant-generator";
import {
  buildDocumentKnowledgePath,
  buildDocumentMultimodalAssetKnowledgePaths,
  buildDocumentMultimodalManifestKnowledgePath,
  buildDocumentMultimodalResourceKnowledgePaths,
  buildDocumentOutlineKnowledgePath,
  buildDocumentSectionKnowledgePaths,
} from "./document-knowledge-paths";
import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import {
  DOCUMENT_ELEMENT_SEPARATOR,
  DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
  DOCUMENT_OFFSET_ENCODING,
  materializeDocumentElementByteSpan,
} from "./document-offsets";
import type { DocumentOutlineBuilder } from "./document-outline-builder";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import {
  type DocumentPdfRasterizer,
  rasterizeDocumentPdfMultimodalAssets,
} from "./document-pdf-rasterizer";
import { sha256Hex } from "./document-upload-utils";
import type { IncrementalReindexer } from "./index-reindexer";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { KnowledgeSpaceEmbeddingResolver } from "./knowledge-space-embedding-resolver";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import type { SemanticIngestionPostProcessor } from "./semantic-ingestion-postprocessor";
import { traceAsync } from "./trace-async";
import type { TraceRecorder } from "./tracing";

/**
 * The synchronous document ingestion tail shared by the upload handler and non-upload data sources
 * (e.g. website crawl). It parses a stored document's bytes, rasterizes/extracts multimodal assets,
 * builds the outline + knowledge paths, rebuilds projections (or persists the artifact when no
 * synchronous reindexer is configured), and writes artifact segments. It intentionally does NOT own
 * the staged-commit lifecycle or parser-status transitions — those stay with each caller.
 */
export interface CompileDocumentArtifactInput {
  readonly asset: DocumentAsset;
  readonly body: Uint8Array;
  readonly knowledgeSpaceId: string;
  readonly permissionScope: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface CompileDocumentArtifactDeps {
  readonly artifacts: ParseArtifactRepository;
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly denseEmbeddingModel?: string | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly documentMultimodalImageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly documentMultimodalLocalAssetAllowlist?: readonly string[] | undefined;
  readonly documentMultimodalMaxExtractedAssets?: number | undefined;
  readonly documentMultimodalMaxLocalAssetBytes?: number | undefined;
  readonly documentMultimodalMaxPdfRasterizedAssets?: number | undefined;
  readonly documentMultimodalManifests: DocumentMultimodalManifestRepository;
  readonly documentParser: ParserAdapter;
  readonly documentPdfRasterizer?: DocumentPdfRasterizer | undefined;
  readonly generateArtifactSegmentId: () => string;
  readonly generateKnowledgePathId: () => string;
  readonly knowledgePaths: KnowledgePathRepository;
  readonly now: () => string;
  readonly objectStorage: ObjectStorageAdapter;
  readonly outlineBuilder: DocumentOutlineBuilder;
  readonly outlineSummaryEnhancer?: DocumentOutlineSummaryEnhancer | undefined;
  readonly outlines: DocumentOutlineRepository;
  readonly semanticPostProcessor?: SemanticIngestionPostProcessor | undefined;
  readonly synchronousUploadDenseModel?: string | undefined;
  readonly synchronousUploadReindexer: IncrementalReindexer | null;
  readonly traces: TraceRecorder;
  readonly visualEmbeddingModel?: string | undefined;
}

export async function compileDocumentArtifact(
  input: CompileDocumentArtifactInput,
  deps: CompileDocumentArtifactDeps,
): Promise<ParseArtifact> {
  const {
    asset,
    body,
    knowledgeSpaceId,
    permissionScope,
    publicationGenerationId: requestedPublicationGenerationId,
    tenantId,
    traceId,
  } = input;
  const {
    artifacts,
    artifactSegments,
    denseEmbeddingModel,
    embeddingResolver,
    documentMultimodalImageVariantGenerator,
    documentMultimodalLocalAssetAllowlist,
    documentMultimodalMaxExtractedAssets,
    documentMultimodalMaxLocalAssetBytes,
    documentMultimodalMaxPdfRasterizedAssets,
    documentMultimodalManifests,
    documentParser,
    documentPdfRasterizer,
    generateArtifactSegmentId,
    generateKnowledgePathId,
    knowledgePaths,
    now,
    objectStorage,
    outlineBuilder,
    outlineSummaryEnhancer,
    outlines,
    semanticPostProcessor,
    synchronousUploadDenseModel,
    synchronousUploadReindexer,
    traces,
    visualEmbeddingModel,
  } = deps;
  const publicationGenerationId =
    requestedPublicationGenerationId === undefined
      ? undefined
      : PublicationGenerationIdSchema.parse(requestedPublicationGenerationId);
  if (publicationGenerationId !== undefined) {
    throw new Error("Generation-scoped document compilation requires a publication coordinator");
  }
  const stagedProjectionPublication =
    publicationGenerationId === undefined &&
    synchronousUploadReindexer?.publishProjections &&
    synchronousUploadReindexer.failProjections
      ? {
          fail: synchronousUploadReindexer.failProjections,
          publish: synchronousUploadReindexer.publishProjections,
        }
      : null;
  let stagedProjectionIds: readonly string[] = [];

  const artifact = await traceAsync(traces, traceId, "ingestion.parser_parse", () =>
    documentParser.parse({
      body,
      documentAssetId: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      version: asset.version,
    }),
  );
  const rasterizedArtifact = await traceAsync(traces, traceId, "ingestion.pdf_rasterize", () =>
    rasterizeDocumentPdfMultimodalAssets({
      artifact,
      documentBody: body,
      documentMimeType: asset.mimeType,
      knowledgeSpaceId,
      ...(documentMultimodalMaxPdfRasterizedAssets
        ? { maxRasterizedAssets: documentMultimodalMaxPdfRasterizedAssets }
        : {}),
      objectStorage,
      ...(documentPdfRasterizer ? { rasterizer: documentPdfRasterizer } : {}),
      tenantId,
    }),
  );
  const assetExtractionResult = await traceAsync(
    traces,
    traceId,
    "ingestion.multimodal_assets_extract",
    () =>
      extractDocumentMultimodalAssets({
        ...(documentMultimodalLocalAssetAllowlist
          ? { allowLocalAssetPaths: documentMultimodalLocalAssetAllowlist }
          : {}),
        artifact: rasterizedArtifact.artifact,
        knowledgeSpaceId,
        ...(documentMultimodalMaxExtractedAssets
          ? { maxExtractedAssets: documentMultimodalMaxExtractedAssets }
          : {}),
        ...(documentMultimodalMaxLocalAssetBytes
          ? { maxLocalAssetBytes: documentMultimodalMaxLocalAssetBytes }
          : {}),
        ...(documentMultimodalImageVariantGenerator
          ? { imageVariantGenerator: documentMultimodalImageVariantGenerator }
          : {}),
        objectStorage,
        tenantId,
      }),
  );
  const artifactToPersist = ParseArtifactSchema.parse({
    ...assetExtractionResult.artifact,
    metadata: {
      ...assetExtractionResult.artifact.metadata,
      ...(assetExtractionResult.extractedCount > 0
        ? { multimodalAssetExtractionCount: assetExtractionResult.extractedCount }
        : {}),
      traceId,
    },
  });
  const canonicalArtifact = await traceAsync(traces, traceId, "ingestion.artifact_create", () =>
    artifacts.create(artifactToPersist),
  );
  const multimodalManifest = createDocumentMultimodalManifestBuilder().build({
    artifact: canonicalArtifact,
    knowledgeSpaceId,
    ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
  });
  await traceAsync(traces, traceId, "ingestion.outline_build", async () => {
    const deterministicOutline = outlineBuilder.build({
      knowledgeSpaceId,
      parseArtifact: canonicalArtifact,
      ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
    });
    const outline = outlineSummaryEnhancer
      ? await outlineSummaryEnhancer.enhance({
          outline: deterministicOutline,
          parseArtifact: canonicalArtifact,
          tenantId,
          traceId,
        })
      : deterministicOutline;
    await outlines.upsert(outline);
    await knowledgePaths.upsertMany([
      ...(publicationGenerationId !== undefined
        ? [
            buildDocumentKnowledgePath({
              asset,
              id: generateKnowledgePathId(),
              publicationGenerationId,
              tenantId,
            }),
          ]
        : []),
      buildDocumentMultimodalManifestKnowledgePath({
        asset,
        id: generateKnowledgePathId(),
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
        tenantId,
      }),
      ...buildDocumentMultimodalAssetKnowledgePaths({
        asset,
        generateId: generateKnowledgePathId,
        manifest: multimodalManifest,
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
        tenantId,
      }),
      ...buildDocumentMultimodalResourceKnowledgePaths({
        asset,
        generateId: generateKnowledgePathId,
        manifest: multimodalManifest,
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
        tenantId,
      }),
      buildDocumentOutlineKnowledgePath({
        asset,
        id: generateKnowledgePathId(),
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
        tenantId,
      }),
      ...buildDocumentSectionKnowledgePaths({
        asset,
        generateId: generateKnowledgePathId,
        outline,
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
        tenantId,
      }),
    ]);
  });
  try {
    if (synchronousUploadReindexer) {
      const resolvedEmbedding = embeddingResolver
        ? await embeddingResolver.resolve({ knowledgeSpaceId, tenantId })
        : null;
      const denseModel =
        resolvedEmbedding?.vectorSpaceId ?? synchronousUploadDenseModel ?? denseEmbeddingModel;
      const reindexResult = await traceAsync(traces, traceId, "ingestion.nodes_reindex", () =>
        synchronousUploadReindexer.reindex({
          ...(denseModel ? { denseModel } : {}),
          knowledgeSpaceId,
          parseArtifact: canonicalArtifact,
          permissionScope,
          projectionStatus:
            publicationGenerationId !== undefined || stagedProjectionPublication
              ? "building"
              : "ready",
          projectionVersion: asset.version,
          ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
          tenantId,
          ...(visualEmbeddingModel ? { visualModel: visualEmbeddingModel } : {}),
        }),
      );
      if (stagedProjectionPublication && reindexResult.status === "rebuilt") {
        stagedProjectionIds = [...(reindexResult.projectionIds ?? [])];

        if (stagedProjectionIds.length !== reindexResult.projectionsCreated) {
          throw new Error(
            "Document compilation staged projection ids do not match projectionsCreated",
          );
        }
      }
      if (semanticPostProcessor && reindexResult.status === "rebuilt") {
        const postprocess = traceAsync(traces, traceId, "ingestion.semantic_postprocess", () =>
          semanticPostProcessor.process({
            knowledgeSpaceId,
            parseArtifact: canonicalArtifact,
            ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
            tenantId,
            traceId,
          }),
        );

        if (publicationGenerationId !== undefined) {
          await postprocess;
        } else {
          await postprocess.catch(() => undefined);
        }
      }
    }
    await traceAsync(traces, traceId, "ingestion.multimodal_manifest_upsert", () =>
      documentMultimodalManifests.upsert(multimodalManifest),
    );
    await traceAsync(traces, traceId, "ingestion.artifact_segments_create", async () =>
      artifactSegments.createMany({
        segments: await createArtifactSegments({
          artifact: canonicalArtifact,
          generateId: generateArtifactSegmentId,
          knowledgeSpaceId,
          now,
        }),
      }),
    );

    if (stagedProjectionPublication && stagedProjectionIds.length > 0) {
      const published = await traceAsync(traces, traceId, "ingestion.projections_publish", () =>
        stagedProjectionPublication.publish({
          knowledgeSpaceId,
          projectionIds: stagedProjectionIds,
        }),
      );

      if (published !== stagedProjectionIds.length) {
        throw new Error(
          `Document compilation published ${published} of ${stagedProjectionIds.length} staged projections`,
        );
      }
    }
  } catch (error) {
    if (stagedProjectionPublication && stagedProjectionIds.length > 0) {
      await traceAsync(traces, traceId, "ingestion.projections_fail", () =>
        stagedProjectionPublication.fail({
          knowledgeSpaceId,
          projectionIds: stagedProjectionIds,
        }),
      ).catch(() => undefined);
    }
    throw error;
  }

  return canonicalArtifact;
}

export async function createArtifactSegments({
  artifact,
  generateId,
  knowledgeSpaceId,
  now,
}: {
  readonly artifact: ParseArtifact;
  readonly generateId: () => string;
  readonly knowledgeSpaceId: string;
  readonly now: () => string;
}): Promise<ArtifactSegment[]> {
  const encoder = new TextEncoder();
  const segments: ArtifactSegment[] = [];
  let offset = 0;

  for (const element of artifact.elements) {
    const span = materializeDocumentElementByteSpan(element.text, offset);

    if (!span) {
      continue;
    }

    offset = span.nextOffset;
    const checksum = await sha256Hex(encoder.encode(span.text));

    segments.push({
      artifactHash: artifact.artifactHash,
      checksum,
      contentEncoding: "utf-8",
      createdAt: now(),
      documentAssetId: artifact.documentAssetId,
      endOffset: span.endOffset,
      id: generateId(),
      inlineText: span.text,
      knowledgeSpaceId,
      metadata: {
        elementSeparator: DOCUMENT_ELEMENT_SEPARATOR,
        offsetEncoding: DOCUMENT_OFFSET_ENCODING,
        parseElementId: element.id,
        parseElementType: element.type,
        textNormalization: DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
      },
      parseArtifactId: artifact.id,
      segmentIndex: segments.length,
      segmentType: artifactSegmentTypeForElement(element.type),
      sizeBytes: span.endOffset - span.startOffset,
      sourceLocation: {
        ...(element.pageNumber ? { pageNumber: element.pageNumber } : {}),
        sectionPath: [...element.sectionPath],
        startOffset: span.startOffset,
        endOffset: span.endOffset,
      },
      startOffset: span.startOffset,
    });
  }

  return segments;
}

function artifactSegmentTypeForElement(
  elementType: ParseArtifact["elements"][number]["type"],
): ArtifactSegment["segmentType"] {
  switch (elementType) {
    case "table":
      return "table";
    case "image":
      return "image";
    case "code":
      return "code";
    case "page-break":
      return "page";
    default:
      return "text";
  }
}
