import type {
  DocumentMultimodalEnrichmentProvider,
  DocumentMultimodalEnrichmentProviderInput,
  DocumentMultimodalEnrichmentProviderResult,
} from "./document-multimodal-manifest-enhancer";
import { cloneJsonObject, isPlainObject } from "./json-utils";

export interface CompositeDocumentMultimodalEnrichmentProviderOptions {
  readonly providers: readonly DocumentMultimodalEnrichmentProvider[];
}

export type DocumentMultimodalUnderstandingTask = "chart" | "image" | "table";

export interface DocumentMultimodalUnderstandingProviderInput {
  readonly item: DocumentMultimodalEnrichmentProviderInput["item"];
  readonly model: string;
  readonly promptVersion: string;
  readonly sourceText?: string | undefined;
  readonly task: DocumentMultimodalUnderstandingTask;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface DocumentMultimodalUnderstandingProviderResult {
  readonly caption?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly ocrText?: string | undefined;
  readonly summary?: string | undefined;
  readonly tableStructureStatus?: DocumentMultimodalEnrichmentProviderResult["tableStructureStatus"];
  readonly title?: string | undefined;
}

export interface DocumentMultimodalUnderstandingProvider {
  readonly kind?: string | undefined;
  understand(
    input: DocumentMultimodalUnderstandingProviderInput,
  ): Promise<DocumentMultimodalUnderstandingProviderResult>;
}

export interface UnderstandingDocumentMultimodalEnrichmentProviderOptions {
  readonly maxSummaryChars?: number | undefined;
  readonly provider: DocumentMultimodalUnderstandingProvider;
  readonly recoverProviderErrors?: boolean | undefined;
}

export function createCompositeDocumentMultimodalEnrichmentProvider({
  providers,
}: CompositeDocumentMultimodalEnrichmentProviderOptions): DocumentMultimodalEnrichmentProvider {
  if (providers.length === 0) {
    throw new Error("Composite multimodal enrichment provider requires at least 1 provider");
  }

  return {
    enrich: async (input) => {
      let result: DocumentMultimodalEnrichmentProviderResult = {};

      for (const provider of providers) {
        result = mergeProviderResults(result, await provider.enrich(input));
      }

      return result;
    },
  };
}

export function createUnderstandingDocumentMultimodalEnrichmentProvider({
  maxSummaryChars = 2_000,
  provider,
  recoverProviderErrors = true,
}: UnderstandingDocumentMultimodalEnrichmentProviderOptions): DocumentMultimodalEnrichmentProvider {
  if (!Number.isInteger(maxSummaryChars) || maxSummaryChars < 1) {
    throw new Error("Understanding multimodal enrichment maxSummaryChars must be at least 1");
  }

  return {
    enrich: async (input) => {
      const task = understandingTaskForItem(input.item);

      if (!task) {
        return {};
      }

      try {
        const result = await provider.understand({
          item: input.item,
          model: input.model,
          promptVersion: input.promptVersion,
          ...(input.sourceText ? { sourceText: input.sourceText } : {}),
          task,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          ...(input.traceId ? { traceId: input.traceId } : {}),
        });
        const summary = truncate(result.summary, maxSummaryChars);

        return {
          ...(result.caption ? { caption: result.caption } : {}),
          metadata: {
            ...(provider.kind ? { provider: provider.kind } : {}),
            ...(result.metadata ? cloneJsonObject(result.metadata) : {}),
            model: input.model,
            promptVersion: input.promptVersion,
            status: "provided",
            task,
            ...(summary ? { summary } : {}),
          },
          ...(result.ocrText ? { ocrText: result.ocrText } : {}),
          ...(task === "table"
            ? { tableStructureStatus: result.tableStructureStatus ?? "provided" }
            : {}),
          ...(summary ? { textPreview: summary } : {}),
          ...(result.title ? { title: result.title } : {}),
        };
      } catch (error) {
        if (!recoverProviderErrors) {
          throw error;
        }

        return {
          metadata: {
            ...(provider.kind ? { provider: provider.kind } : {}),
            error: error instanceof Error ? error.message : "Unknown multimodal provider error",
            model: input.model,
            promptVersion: input.promptVersion,
            status: "failed",
            task,
          },
        };
      }
    },
  };
}

export function createMetadataDocumentMultimodalEnrichmentProvider(): DocumentMultimodalEnrichmentProvider {
  return {
    enrich: async ({ item }) => {
      const metadata = item.sourceMetadata;
      const caption =
        item.caption ??
        metadataString(metadata, "caption") ??
        metadataString(metadata, "alt") ??
        metadataString(metadata, "description");
      const title =
        item.title ??
        metadataString(metadata, "title") ??
        metadataString(metadata, "chartTitle") ??
        caption;
      const ocrText =
        item.ocrText ??
        metadataString(metadata, "ocrText") ??
        metadataString(metadata, "ocr") ??
        metadataString(metadata, "extractedText");
      const chartSummary =
        metadataString(metadata, "chartSummary") ??
        metadataString(metadata, "chartDataSummary") ??
        metadataString(metadata, "chartDescription");
      const tableSummary =
        metadataString(metadata, "tableSummary") ?? metadataString(metadata, "tableDescription");
      const textPreview = item.textPreview ?? ocrText ?? tableSummary ?? chartSummary ?? caption;

      return {
        ...(item.assetRef ? { assetRef: item.assetRef } : {}),
        ...(item.boundingBox ? { boundingBox: item.boundingBox } : {}),
        ...(caption ? { caption } : {}),
        metadata: {
          modality: item.modality,
          provider: "metadata",
          ...(chartSummary ? { chartSummary } : {}),
          ...(tableSummary ? { tableSummary } : {}),
        },
        ...(ocrText ? { ocrText } : {}),
        ...(item.modality === "table" ? { tableStructureStatus: tableStatus(metadata) } : {}),
        ...(textPreview ? { textPreview } : {}),
        ...(title ? { title } : {}),
        ...(visualEmbeddingStatus(metadata)
          ? { visualEmbeddingStatus: visualEmbeddingStatus(metadata) }
          : {}),
      };
    },
  };
}

function understandingTaskForItem(
  item: DocumentMultimodalEnrichmentProviderInput["item"],
): DocumentMultimodalUnderstandingTask | null {
  if (item.modality === "table") {
    return "table";
  }

  if (item.modality !== "image") {
    return null;
  }

  return hasChartMetadata(item.sourceMetadata) ? "chart" : "image";
}

function hasChartMetadata(metadata: Readonly<Record<string, unknown>>): boolean {
  return Boolean(
    metadataString(metadata, "chartSummary") ??
      metadataString(metadata, "chartDataSummary") ??
      metadataString(metadata, "chartDescription") ??
      metadataString(metadata, "chartTitle"),
  );
}

function truncate(value: string | undefined, maxChars: number): string | undefined {
  const text = value?.trim();

  if (!text) {
    return undefined;
  }

  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

function mergeProviderResults(
  current: DocumentMultimodalEnrichmentProviderResult,
  next: DocumentMultimodalEnrichmentProviderResult,
): DocumentMultimodalEnrichmentProviderResult {
  return {
    assetRef: next.assetRef ?? current.assetRef,
    boundingBox: next.boundingBox ?? current.boundingBox,
    caption: nonEmptyString(next.caption) ?? current.caption,
    metadata: mergeProviderMetadata(current.metadata, next.metadata),
    ocrText: nonEmptyString(next.ocrText) ?? current.ocrText,
    tableStructureStatus: next.tableStructureStatus ?? current.tableStructureStatus,
    textPreview: nonEmptyString(next.textPreview) ?? current.textPreview,
    title: nonEmptyString(next.title) ?? current.title,
    visualEmbeddingStatus: next.visualEmbeddingStatus ?? current.visualEmbeddingStatus,
  };
}

function mergeProviderMetadata(
  current: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!current && !next) {
    return undefined;
  }

  return {
    ...(current ? cloneJsonObject(current) : {}),
    ...(next ? cloneJsonObject(next) : {}),
  };
}

function tableStatus(
  metadata: Readonly<Record<string, unknown>>,
): DocumentMultimodalEnrichmentProviderResult["tableStructureStatus"] {
  return isPlainObject(metadata.table) || Array.isArray(metadata.rows) ? "provided" : "missing";
}

function visualEmbeddingStatus(
  metadata: Readonly<Record<string, unknown>>,
): DocumentMultimodalEnrichmentProviderResult["visualEmbeddingStatus"] {
  const value = metadataString(metadata, "visualEmbeddingStatus");

  return value === "provided" || value === "missing" || value === "unsupported" ? value : undefined;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}
