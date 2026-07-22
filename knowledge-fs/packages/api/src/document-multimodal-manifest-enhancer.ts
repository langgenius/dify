import {
  type DocumentMultimodalAssetRef,
  type DocumentMultimodalBoundingBox,
  type DocumentMultimodalEnrichmentStatus,
  type DocumentMultimodalItem,
  type DocumentMultimodalManifest,
  DocumentMultimodalManifestSchema,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";

import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { cloneJsonObject, isPlainObject } from "./json-utils";

export interface DocumentMultimodalEnrichmentProviderInput {
  readonly documentAssetId: string;
  readonly item: DocumentMultimodalItem;
  readonly knowledgeSpaceId: string;
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly model: string;
  readonly parseArtifactId: string;
  readonly promptVersion: string;
  readonly sourceText?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface DocumentMultimodalEnrichmentProviderResult {
  readonly assetRef?: DocumentMultimodalAssetRef | undefined;
  readonly boundingBox?: DocumentMultimodalBoundingBox | undefined;
  readonly caption?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly ocrText?: string | undefined;
  readonly tableStructureStatus?: DocumentMultimodalEnrichmentStatus | undefined;
  readonly textPreview?: string | undefined;
  readonly title?: string | undefined;
  readonly visualEmbeddingStatus?: DocumentMultimodalEnrichmentStatus | undefined;
}

export interface DocumentMultimodalEnrichmentProvider {
  enrich(
    input: DocumentMultimodalEnrichmentProviderInput,
  ): Promise<DocumentMultimodalEnrichmentProviderResult>;
}

export interface DocumentMultimodalManifestEnhancerOptions {
  /** Max concurrent provider.enrich calls per manifest (bounds VLM fan-out). Default 4. */
  readonly maxConcurrency?: number | undefined;
  readonly maxItems: number;
  readonly maxSourceTextChars: number;
  readonly model: string;
  readonly promptVersion: string;
  readonly provider: DocumentMultimodalEnrichmentProvider;
}

const DEFAULT_ENRICHMENT_MAX_CONCURRENCY = 4;

export interface EnhanceDocumentMultimodalManifestInput {
  readonly manifest: DocumentMultimodalManifest;
  readonly parseArtifact: ParseArtifact;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface DocumentMultimodalManifestEnhancer {
  enhance(input: EnhanceDocumentMultimodalManifestInput): Promise<DocumentMultimodalManifest>;
  /** Enrichment model this enhancer applies (used for cache freshness). */
  readonly model: string;
  /** Enrichment promptVersion this enhancer applies (used for cache freshness). */
  readonly promptVersion: string;
}

export interface CachedDocumentMultimodalManifestEnhancerOptions {
  readonly enhancer: DocumentMultimodalManifestEnhancer;
  readonly manifests: DocumentMultimodalManifestRepository;
}

export function createDocumentMultimodalManifestEnhancer({
  maxConcurrency = DEFAULT_ENRICHMENT_MAX_CONCURRENCY,
  maxItems,
  maxSourceTextChars,
  model,
  promptVersion,
  provider,
}: DocumentMultimodalManifestEnhancerOptions): DocumentMultimodalManifestEnhancer {
  validateDocumentMultimodalManifestEnhancerOptions({
    maxConcurrency,
    maxItems,
    maxSourceTextChars,
    model,
    promptVersion,
  });

  return {
    model,
    promptVersion,
    enhance: async ({ manifest, parseArtifact, tenantId, traceId }) => {
      const parsedManifest = DocumentMultimodalManifestSchema.parse(manifest);
      const artifact = ParseArtifactSchema.parse(parseArtifact);
      const attemptedItems = Math.min(parsedManifest.items.length, maxItems);
      const enhanced = await mapWithConcurrency(
        parsedManifest.items,
        maxConcurrency,
        async (item, index) => {
          if (index >= maxItems) {
            return { changed: false, item };
          }

          const result = await provider.enrich({
            documentAssetId: parsedManifest.documentAssetId,
            item,
            knowledgeSpaceId: parsedManifest.knowledgeSpaceId,
            manifestId: parsedManifest.id,
            manifestVersion: parsedManifest.manifestVersion,
            model,
            parseArtifactId: parsedManifest.parseArtifactId,
            promptVersion,
            sourceText: sourceTextForItem({ artifact, item, maxSourceTextChars }),
            ...(tenantId ? { tenantId } : {}),
            traceId,
          });

          const merged = mergeMultimodalItemEnrichment(item, result);

          return { changed: !multimodalItemsEqual(item, merged), item: merged };
        },
      );
      const items = enhanced.map((entry) => entry.item);
      // Honest count: an item is "enhanced" only when the provider actually changed it.
      const enhancedItems = enhanced.filter((entry) => entry.changed).length;
      const failedItems = items.filter(
        (item) => enrichmentProviderStatus(item) === "failed",
      ).length;

      return DocumentMultimodalManifestSchema.parse({
        ...parsedManifest,
        items,
        metadata: {
          ...cloneJsonObject(parsedManifest.metadata),
          enrichment: {
            attemptedItems,
            enhancedItems,
            failedItems,
            model,
            providerBudget: {
              maxItems,
              maxSourceTextChars,
            },
            promptVersion,
            skippedItems: Math.max(0, parsedManifest.items.length - maxItems),
            source: "provider",
          },
          missingAssetCount: items.filter((item) => item.enrichment.asset === "missing").length,
          missingVisualEmbeddingCount: items.filter(
            (item) => item.enrichment.visualEmbedding === "missing",
          ).length,
        },
      });
    },
  };
}

/** Order-preserving bounded-concurrency map (a slot frees as each task settles). */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await fn(items[index] as T, index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function multimodalItemsEqual(
  left: DocumentMultimodalItem,
  right: DocumentMultimodalItem,
): boolean {
  if (left === right) {
    return true;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

export function createCachedDocumentMultimodalManifestEnhancer({
  enhancer,
  manifests,
}: CachedDocumentMultimodalManifestEnhancerOptions): DocumentMultimodalManifestEnhancer {
  const { model, promptVersion } = enhancer;
  // Single-flight: concurrent first-reads of the same (document, version) share one enhancement
  // instead of each firing the full provider fan-out.
  const inFlight = new Map<string, Promise<DocumentMultimodalManifest>>();

  return {
    model,
    promptVersion,
    enhance: async (input) => {
      const manifest = DocumentMultimodalManifestSchema.parse(input.manifest);
      const cached = await manifests.getByDocumentVersion({
        documentAssetId: manifest.documentAssetId,
        ...(manifest.publicationGenerationId
          ? { publicationGenerationId: manifest.publicationGenerationId }
          : {}),
        version: manifest.version,
      });

      if (
        cached &&
        isFreshCachedDocumentMultimodalManifest({ cached, manifest, model, promptVersion })
      ) {
        return cached;
      }

      const key = `${manifest.documentAssetId}:${manifest.version}:${manifest.publicationGenerationId ?? "legacy"}`;
      const pending = inFlight.get(key);

      if (pending) {
        return pending;
      }

      const run = (async () => {
        const enhanced = await enhancer.enhance({ ...input, manifest });

        return manifests.upsert(enhanced);
      })();
      inFlight.set(key, run);

      try {
        return await run;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

function isFreshCachedDocumentMultimodalManifest({
  cached,
  manifest,
  model,
  promptVersion,
}: {
  readonly cached: DocumentMultimodalManifest;
  readonly manifest: DocumentMultimodalManifest;
  readonly model: string;
  readonly promptVersion: string;
}): boolean {
  const enrichment = isPlainObject(cached.metadata.enrichment)
    ? cached.metadata.enrichment
    : undefined;
  // A cached manifest enriched by a different model/prompt is stale even if the artifact is
  // unchanged, so a model/prompt redeploy re-enriches instead of serving old captions/OCR forever.
  const cachedModel = typeof enrichment?.model === "string" ? enrichment.model : undefined;
  const cachedPromptVersion =
    typeof enrichment?.promptVersion === "string" ? enrichment.promptVersion : undefined;

  return (
    cached.id === manifest.id &&
    cached.artifactHash === manifest.artifactHash &&
    cached.manifestVersion === manifest.manifestVersion &&
    cached.parseArtifactId === manifest.parseArtifactId &&
    cachedModel === model &&
    cachedPromptVersion === promptVersion
  );
}

function validateDocumentMultimodalManifestEnhancerOptions({
  maxConcurrency,
  maxItems,
  maxSourceTextChars,
  model,
  promptVersion,
}: {
  readonly maxConcurrency: number;
  readonly maxItems: number;
  readonly maxSourceTextChars: number;
  readonly model: string;
  readonly promptVersion: string;
}): void {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("Document multimodal manifest enhancer maxConcurrency must be at least 1");
  }

  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error("Document multimodal manifest enhancer maxItems must be at least 1");
  }

  if (!Number.isInteger(maxSourceTextChars) || maxSourceTextChars < 1) {
    throw new Error("Document multimodal manifest enhancer maxSourceTextChars must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Document multimodal manifest enhancer model must be non-empty");
  }

  if (!promptVersion.trim()) {
    throw new Error("Document multimodal manifest enhancer promptVersion must be non-empty");
  }
}

function mergeMultimodalItemEnrichment(
  item: DocumentMultimodalItem,
  result: DocumentMultimodalEnrichmentProviderResult,
): DocumentMultimodalItem {
  // Never drop an existing object-backed assetRef for a weaker (e.g. uri-only) provider one.
  const assetRef = pickBetterAssetRef(item.assetRef, result.assetRef);
  const caption = nonEmptyString(result.caption) ?? item.caption;
  const ocrText = nonEmptyString(result.ocrText) ?? item.ocrText;
  const textPreview = nonEmptyString(result.textPreview) ?? item.textPreview;

  return {
    ...item,
    ...(assetRef ? { assetRef } : {}),
    ...((result.boundingBox ?? item.boundingBox)
      ? { boundingBox: result.boundingBox ?? item.boundingBox }
      : {}),
    ...(caption ? { caption } : {}),
    enrichment: {
      ...item.enrichment,
      asset: assetRef ? "provided" : item.enrichment.asset,
      caption: caption ? "provided" : item.enrichment.caption,
      ocr: ocrText ? "provided" : item.enrichment.ocr,
      // Never downgrade a "provided" status to a weaker provider result.
      tableStructure: preferProvidedStatus(
        item.enrichment.tableStructure,
        result.tableStructureStatus,
      ),
      visualEmbedding: preferProvidedStatus(
        item.enrichment.visualEmbedding,
        result.visualEmbeddingStatus,
      ),
    },
    ...(ocrText ? { ocrText } : {}),
    sourceMetadata: {
      ...cloneJsonObject(item.sourceMetadata),
      ...(result.metadata ? { enrichment: cloneJsonObject(result.metadata) } : {}),
    },
    ...(textPreview ? { textPreview } : {}),
    ...((nonEmptyString(result.title) ?? item.title)
      ? { title: nonEmptyString(result.title) ?? item.title }
      : {}),
  };
}

function assetRefHasObjectKey(assetRef: DocumentMultimodalAssetRef | undefined): boolean {
  return typeof assetRef?.objectKey === "string" && assetRef.objectKey.trim().length > 0;
}

function pickBetterAssetRef(
  current: DocumentMultimodalAssetRef | undefined,
  incoming: DocumentMultimodalAssetRef | undefined,
): DocumentMultimodalAssetRef | undefined {
  if (!incoming) {
    return current;
  }

  // A real object-backed asset always wins; otherwise keep an existing object-backed asset rather
  // than replacing it with a weaker (uri-only) provider result.
  if (assetRefHasObjectKey(incoming)) {
    return incoming;
  }

  if (assetRefHasObjectKey(current)) {
    return current;
  }

  return incoming;
}

function preferProvidedStatus(
  current: DocumentMultimodalEnrichmentStatus,
  incoming: DocumentMultimodalEnrichmentStatus | undefined,
): DocumentMultimodalEnrichmentStatus {
  if (incoming === undefined) {
    return current;
  }

  return current === "provided" && incoming !== "provided" ? current : incoming;
}

function sourceTextForItem({
  artifact,
  item,
  maxSourceTextChars,
}: {
  readonly artifact: ParseArtifact;
  readonly item: DocumentMultimodalItem;
  readonly maxSourceTextChars: number;
}): string | undefined {
  const element = artifact.elements.find((candidate) => candidate.id === item.parseElementId);
  const text = element?.text?.trim() || item.ocrText || item.textPreview;

  if (!text) {
    return undefined;
  }

  return text.length > maxSourceTextChars ? text.slice(0, maxSourceTextChars) : text;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function enrichmentProviderStatus(item: DocumentMultimodalItem): string | undefined {
  if (!isPlainObject(item.sourceMetadata.enrichment)) {
    return undefined;
  }

  const status = item.sourceMetadata.enrichment.status;

  return typeof status === "string" && status.trim() ? status : undefined;
}
