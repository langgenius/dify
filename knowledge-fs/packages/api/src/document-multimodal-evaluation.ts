import type { DocumentMultimodalItem, DocumentMultimodalManifest } from "@knowledge/core";

import { isPlainObject } from "./json-utils";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { ResolvedRetrievalMode } from "./retrieval-types";

export interface DocumentMultimodalCitationExpectation {
  readonly expectedBoundingBox?: BoundingBoxExpectation | undefined;
  readonly expectedManifestItemId?: string | undefined;
  readonly expectedPageNumber?: number | undefined;
  readonly expectedVisualEmbeddingHit?: boolean | undefined;
  readonly id: string;
  readonly nodeId: string;
}

export interface BoundingBoxExpectation {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DocumentMultimodalCitationEvaluationItem {
  readonly boundingBoxHit?: boolean | undefined;
  readonly expectedManifestItemHit?: boolean | undefined;
  readonly expectedPageHit?: boolean | undefined;
  readonly expectedVisualEmbeddingHit?: boolean | undefined;
  readonly id: string;
  readonly nodeId: string;
  readonly observedManifestItemId?: string | undefined;
  readonly observedPageNumber?: number | undefined;
  readonly observedVisualEmbeddingHit?: boolean | undefined;
  readonly status: "hit" | "miss" | "missing";
}

export interface DocumentMultimodalCitationEvaluationReport {
  readonly items: readonly DocumentMultimodalCitationEvaluationItem[];
  readonly metrics: {
    readonly boundingBoxHitRate: number | null;
    readonly manifestItemHitRate: number | null;
    readonly missingRate: number;
    readonly pageHitRate: number | null;
    readonly visualEmbeddingHitRate: number | null;
  };
  readonly strategyVersion: "document-multimodal-citation-eval-v1";
}

export interface DocumentMultimodalUnderstandingExpectation {
  readonly expectedModality?: DocumentMultimodalItem["modality"] | undefined;
  readonly expectedSummaryKeywords?: readonly string[] | undefined;
  readonly expectedTitle?: string | undefined;
  readonly expectedUnderstandingStatus?: "failed" | "provided" | undefined;
  readonly id: string;
  readonly manifestItemId: string;
}

export interface DocumentMultimodalUnderstandingEvaluationItem {
  readonly expectedModalityHit?: boolean | undefined;
  readonly expectedTitleHit?: boolean | undefined;
  readonly expectedUnderstandingStatusHit?: boolean | undefined;
  readonly id: string;
  readonly manifestItemId: string;
  readonly observedModality?: DocumentMultimodalItem["modality"] | undefined;
  readonly observedTitle?: string | undefined;
  readonly observedUnderstandingStatus?: string | undefined;
  readonly summaryKeywordHitRate?: number | undefined;
  readonly summaryKeywordHits?: readonly string[] | undefined;
  readonly summaryKeywordMisses?: readonly string[] | undefined;
  readonly status: "hit" | "miss" | "missing";
}

export interface DocumentMultimodalUnderstandingEvaluationReport {
  readonly items: readonly DocumentMultimodalUnderstandingEvaluationItem[];
  readonly metrics: {
    readonly missingRate: number;
    readonly modalityHitRate: number | null;
    readonly summaryKeywordHitRate: number | null;
    readonly titleHitRate: number | null;
    readonly understandingStatusHitRate: number | null;
  };
  readonly strategyVersion: "document-multimodal-understanding-eval-v1";
}

export interface DocumentMultimodalOcrRecallExpectation {
  readonly expectedKeywords: readonly string[];
  readonly id: string;
  readonly manifestItemId: string;
}

export interface DocumentMultimodalOcrRecallEvaluationItem {
  readonly id: string;
  readonly manifestItemId: string;
  readonly observedTextLength?: number | undefined;
  readonly ocrKeywordHitRate?: number | undefined;
  readonly ocrKeywordHits?: readonly string[] | undefined;
  readonly ocrKeywordMisses?: readonly string[] | undefined;
  readonly status: "hit" | "miss" | "missing";
}

export interface DocumentMultimodalOcrRecallEvaluationReport {
  readonly items: readonly DocumentMultimodalOcrRecallEvaluationItem[];
  readonly metrics: {
    readonly missingRate: number;
    readonly ocrKeywordHitRate: number | null;
  };
  readonly strategyVersion: "document-multimodal-ocr-recall-eval-v1";
}

export interface DocumentMultimodalModeEvaluationInput {
  readonly citation?: DocumentMultimodalCitationEvaluationReport | undefined;
  readonly ocr?: DocumentMultimodalOcrRecallEvaluationReport | undefined;
  readonly understanding?: DocumentMultimodalUnderstandingEvaluationReport | undefined;
}

export interface DocumentMultimodalModeEvaluationThresholds {
  readonly maxCitationMissingRate?: number | undefined;
  readonly maxOcrMissingRate?: number | undefined;
  readonly maxUnderstandingMissingRate?: number | undefined;
  readonly minBoundingBoxHitRate?: number | undefined;
  readonly minManifestItemHitRate?: number | undefined;
  readonly minOcrKeywordHitRate?: number | undefined;
  readonly minPageHitRate?: number | undefined;
  readonly minSummaryKeywordHitRate?: number | undefined;
  readonly minUnderstandingStatusHitRate?: number | undefined;
  readonly minVisualEmbeddingHitRate?: number | undefined;
}

export interface DocumentMultimodalModeEvaluationGateResult {
  readonly failures: readonly string[];
  readonly modes: Partial<
    Record<
      ResolvedRetrievalMode,
      { readonly failures: readonly string[]; readonly passed: boolean }
    >
  >;
  readonly passed: boolean;
  readonly strategyVersion: "document-multimodal-mode-gate-v1";
}

const defaultBoundingBoxIouThreshold = 0.5;

export function evaluateDocumentMultimodalCitations({
  boundingBoxIouThreshold = defaultBoundingBoxIouThreshold,
  expectations,
  items,
}: {
  readonly boundingBoxIouThreshold?: number | undefined;
  readonly expectations: readonly DocumentMultimodalCitationExpectation[];
  readonly items: readonly HybridRetrievalItem[];
}): DocumentMultimodalCitationEvaluationReport {
  if (
    !Number.isFinite(boundingBoxIouThreshold) ||
    boundingBoxIouThreshold < 0 ||
    boundingBoxIouThreshold > 1
  ) {
    throw new Error("Document multimodal citation eval boundingBoxIouThreshold must be 0..1");
  }

  const itemsByNodeId = new Map(items.map((item) => [item.nodeId, item]));
  const evaluated = expectations.map((expectation): DocumentMultimodalCitationEvaluationItem => {
    const item = itemsByNodeId.get(expectation.nodeId);

    if (!item) {
      return {
        ...(expectation.expectedBoundingBox === undefined ? {} : { boundingBoxHit: false }),
        ...(expectation.expectedManifestItemId === undefined
          ? {}
          : { expectedManifestItemHit: false }),
        ...(expectation.expectedPageNumber === undefined ? {} : { expectedPageHit: false }),
        ...(expectation.expectedVisualEmbeddingHit === undefined
          ? {}
          : { expectedVisualEmbeddingHit: false }),
        id: expectation.id,
        nodeId: expectation.nodeId,
        status: "missing",
      };
    }

    const observed = observedMultimodalCitation(item);
    const expectedManifestItemHit =
      expectation.expectedManifestItemId === undefined
        ? undefined
        : observed.manifestItemId === expectation.expectedManifestItemId;
    const expectedPageHit =
      expectation.expectedPageNumber === undefined
        ? undefined
        : observed.pageNumber === expectation.expectedPageNumber;
    const boundingBoxHit =
      expectation.expectedBoundingBox === undefined
        ? undefined
        : observed.boundingBox !== undefined &&
          boundingBoxIou(observed.boundingBox, expectation.expectedBoundingBox) >=
            boundingBoxIouThreshold;
    const expectedVisualEmbeddingHit =
      expectation.expectedVisualEmbeddingHit === undefined
        ? undefined
        : observed.visualEmbeddingHit === expectation.expectedVisualEmbeddingHit;
    const hits = [
      expectedManifestItemHit,
      expectedPageHit,
      boundingBoxHit,
      expectedVisualEmbeddingHit,
    ].filter((hit): hit is boolean => hit !== undefined);

    return {
      ...(boundingBoxHit === undefined ? {} : { boundingBoxHit }),
      ...(expectedManifestItemHit === undefined ? {} : { expectedManifestItemHit }),
      ...(expectedPageHit === undefined ? {} : { expectedPageHit }),
      ...(expectedVisualEmbeddingHit === undefined ? {} : { expectedVisualEmbeddingHit }),
      id: expectation.id,
      nodeId: expectation.nodeId,
      ...(observed.manifestItemId ? { observedManifestItemId: observed.manifestItemId } : {}),
      ...(observed.pageNumber === undefined ? {} : { observedPageNumber: observed.pageNumber }),
      ...(observed.visualEmbeddingHit === undefined
        ? {}
        : { observedVisualEmbeddingHit: observed.visualEmbeddingHit }),
      status: hits.length > 0 && hits.every(Boolean) ? "hit" : "miss",
    };
  });

  return {
    items: evaluated,
    metrics: {
      boundingBoxHitRate: hitRate(evaluated, "boundingBoxHit"),
      manifestItemHitRate: hitRate(evaluated, "expectedManifestItemHit"),
      missingRate: ratio(
        evaluated.filter((item) => item.status === "missing").length,
        evaluated.length,
      ),
      pageHitRate: hitRate(evaluated, "expectedPageHit"),
      visualEmbeddingHitRate: hitRate(evaluated, "expectedVisualEmbeddingHit"),
    },
    strategyVersion: "document-multimodal-citation-eval-v1",
  };
}

export function evaluateDocumentMultimodalUnderstanding({
  expectations,
  manifest,
}: {
  readonly expectations: readonly DocumentMultimodalUnderstandingExpectation[];
  readonly manifest: DocumentMultimodalManifest;
}): DocumentMultimodalUnderstandingEvaluationReport {
  const itemsById = new Map(manifest.items.map((item) => [item.id, item]));
  const evaluated = expectations.map(
    (expectation): DocumentMultimodalUnderstandingEvaluationItem => {
      const item = itemsById.get(expectation.manifestItemId);

      if (!item) {
        return {
          ...(expectation.expectedModality === undefined ? {} : { expectedModalityHit: false }),
          ...(expectation.expectedSummaryKeywords === undefined
            ? {}
            : {
                summaryKeywordHitRate: 0,
                summaryKeywordHits: [],
                summaryKeywordMisses: [...expectation.expectedSummaryKeywords],
              }),
          ...(expectation.expectedTitle === undefined ? {} : { expectedTitleHit: false }),
          ...(expectation.expectedUnderstandingStatus === undefined
            ? {}
            : { expectedUnderstandingStatusHit: false }),
          id: expectation.id,
          manifestItemId: expectation.manifestItemId,
          status: "missing",
        };
      }

      const observedText = searchableUnderstandingText(item);
      const summaryKeywordScore =
        expectation.expectedSummaryKeywords === undefined
          ? undefined
          : summaryKeywordHits({
              expectedKeywords: expectation.expectedSummaryKeywords,
              observedText,
            });
      const expectedModalityHit =
        expectation.expectedModality === undefined
          ? undefined
          : item.modality === expectation.expectedModality;
      const expectedTitleHit =
        expectation.expectedTitle === undefined
          ? undefined
          : normalizeForMatch(item.title) === normalizeForMatch(expectation.expectedTitle);
      const observedUnderstandingStatus = understandingStatus(item);
      const expectedUnderstandingStatusHit =
        expectation.expectedUnderstandingStatus === undefined
          ? undefined
          : observedUnderstandingStatus === expectation.expectedUnderstandingStatus;
      const hits = [
        expectedModalityHit,
        expectedTitleHit,
        expectedUnderstandingStatusHit,
        summaryKeywordScore ? summaryKeywordScore.hitRate === 1 : undefined,
      ].filter((hit): hit is boolean => hit !== undefined);

      return {
        ...(expectedModalityHit === undefined ? {} : { expectedModalityHit }),
        ...(expectedTitleHit === undefined ? {} : { expectedTitleHit }),
        ...(expectedUnderstandingStatusHit === undefined ? {} : { expectedUnderstandingStatusHit }),
        id: expectation.id,
        manifestItemId: expectation.manifestItemId,
        observedModality: item.modality,
        ...(item.title ? { observedTitle: item.title } : {}),
        ...(observedUnderstandingStatus
          ? { observedUnderstandingStatus: observedUnderstandingStatus }
          : {}),
        ...(summaryKeywordScore
          ? {
              summaryKeywordHitRate: summaryKeywordScore.hitRate,
              summaryKeywordHits: summaryKeywordScore.hits,
              summaryKeywordMisses: summaryKeywordScore.misses,
            }
          : {}),
        status: hits.length > 0 && hits.every(Boolean) ? "hit" : "miss",
      };
    },
  );

  return {
    items: evaluated,
    metrics: {
      missingRate: ratio(
        evaluated.filter((item) => item.status === "missing").length,
        evaluated.length,
      ),
      modalityHitRate: hitRate(evaluated, "expectedModalityHit"),
      summaryKeywordHitRate: summaryKeywordHitRate(evaluated),
      titleHitRate: hitRate(evaluated, "expectedTitleHit"),
      understandingStatusHitRate: hitRate(evaluated, "expectedUnderstandingStatusHit"),
    },
    strategyVersion: "document-multimodal-understanding-eval-v1",
  };
}

export function evaluateDocumentMultimodalOcrRecall({
  expectations,
  manifest,
}: {
  readonly expectations: readonly DocumentMultimodalOcrRecallExpectation[];
  readonly manifest: DocumentMultimodalManifest;
}): DocumentMultimodalOcrRecallEvaluationReport {
  const itemsById = new Map(manifest.items.map((item) => [item.id, item]));
  const evaluated = expectations.map((expectation): DocumentMultimodalOcrRecallEvaluationItem => {
    const item = itemsById.get(expectation.manifestItemId);

    if (!item) {
      return {
        id: expectation.id,
        manifestItemId: expectation.manifestItemId,
        ocrKeywordHitRate: 0,
        ocrKeywordHits: [],
        ocrKeywordMisses: [...expectation.expectedKeywords],
        status: "missing",
      };
    }

    const observedText = searchableOcrText(item);
    const score = summaryKeywordHits({
      expectedKeywords: expectation.expectedKeywords,
      observedText,
    });

    return {
      id: expectation.id,
      manifestItemId: expectation.manifestItemId,
      observedTextLength: observedText.length,
      ocrKeywordHitRate: score.hitRate,
      ocrKeywordHits: score.hits,
      ocrKeywordMisses: score.misses,
      status: score.hitRate === 1 ? "hit" : "miss",
    };
  });

  return {
    items: evaluated,
    metrics: {
      missingRate: ratio(
        evaluated.filter((item) => item.status === "missing").length,
        evaluated.length,
      ),
      ocrKeywordHitRate: ocrKeywordHitRate(evaluated),
    },
    strategyVersion: "document-multimodal-ocr-recall-eval-v1",
  };
}

export function gateDocumentMultimodalModeEvaluations({
  modes,
  thresholds,
}: {
  readonly modes: Partial<Record<ResolvedRetrievalMode, DocumentMultimodalModeEvaluationInput>>;
  readonly thresholds: DocumentMultimodalModeEvaluationThresholds;
}): DocumentMultimodalModeEvaluationGateResult {
  validateModeGateThresholds(thresholds);

  const evaluatedModes: Partial<
    Record<
      ResolvedRetrievalMode,
      { readonly failures: readonly string[]; readonly passed: boolean }
    >
  > = {};

  for (const [mode, report] of Object.entries(modes) as Array<
    [ResolvedRetrievalMode, DocumentMultimodalModeEvaluationInput]
  >) {
    const failures = modeGateFailures(mode, report, thresholds);
    evaluatedModes[mode] = {
      failures,
      passed: failures.length === 0,
    };
  }

  const failures = Object.values(evaluatedModes).flatMap((mode) => mode?.failures ?? []);

  return {
    failures,
    modes: evaluatedModes,
    passed: failures.length === 0,
    strategyVersion: "document-multimodal-mode-gate-v1",
  };
}

function observedMultimodalCitation(item: HybridRetrievalItem): {
  readonly boundingBox?: BoundingBoxExpectation | undefined;
  readonly manifestItemId?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly visualEmbeddingHit?: boolean | undefined;
} {
  const source = isPlainObject(item.metadata.multimodalCandidate)
    ? item.metadata.multimodalCandidate
    : isPlainObject(item.metadata.multimodal)
      ? item.metadata.multimodal
      : {};

  return {
    ...(boundingBoxFromMetadata(source.boundingBox)
      ? { boundingBox: boundingBoxFromMetadata(source.boundingBox) }
      : {}),
    ...(metadataString(source, "manifestItemId")
      ? { manifestItemId: metadataString(source, "manifestItemId") }
      : {}),
    ...((metadataNumber(source, "pageNumber") ?? item.citation.pageNumber)
      ? { pageNumber: metadataNumber(source, "pageNumber") ?? item.citation.pageNumber }
      : {}),
    ...(metadataString(source, "visualEmbeddingStatus")
      ? { visualEmbeddingHit: metadataString(source, "visualEmbeddingStatus") === "provided" }
      : {}),
  };
}

function modeGateFailures(
  mode: ResolvedRetrievalMode,
  report: DocumentMultimodalModeEvaluationInput,
  thresholds: DocumentMultimodalModeEvaluationThresholds,
): string[] {
  return [
    ...(report.citation
      ? [
          thresholdFailure({
            actual: report.citation.metrics.missingRate,
            label: `${mode}.citation.missingRate`,
            maximum: thresholds.maxCitationMissingRate,
          }),
          thresholdFailure({
            actual: report.citation.metrics.boundingBoxHitRate,
            label: `${mode}.citation.boundingBoxHitRate`,
            minimum: thresholds.minBoundingBoxHitRate,
          }),
          thresholdFailure({
            actual: report.citation.metrics.manifestItemHitRate,
            label: `${mode}.citation.manifestItemHitRate`,
            minimum: thresholds.minManifestItemHitRate,
          }),
          thresholdFailure({
            actual: report.citation.metrics.pageHitRate,
            label: `${mode}.citation.pageHitRate`,
            minimum: thresholds.minPageHitRate,
          }),
          thresholdFailure({
            actual: report.citation.metrics.visualEmbeddingHitRate,
            label: `${mode}.citation.visualEmbeddingHitRate`,
            minimum: thresholds.minVisualEmbeddingHitRate,
          }),
        ]
      : []),
    ...(report.understanding
      ? [
          thresholdFailure({
            actual: report.understanding.metrics.missingRate,
            label: `${mode}.understanding.missingRate`,
            maximum: thresholds.maxUnderstandingMissingRate,
          }),
          thresholdFailure({
            actual: report.understanding.metrics.summaryKeywordHitRate,
            label: `${mode}.understanding.summaryKeywordHitRate`,
            minimum: thresholds.minSummaryKeywordHitRate,
          }),
          thresholdFailure({
            actual: report.understanding.metrics.understandingStatusHitRate,
            label: `${mode}.understanding.understandingStatusHitRate`,
            minimum: thresholds.minUnderstandingStatusHitRate,
          }),
        ]
      : []),
    ...(report.ocr
      ? [
          thresholdFailure({
            actual: report.ocr.metrics.missingRate,
            label: `${mode}.ocr.missingRate`,
            maximum: thresholds.maxOcrMissingRate,
          }),
          thresholdFailure({
            actual: report.ocr.metrics.ocrKeywordHitRate,
            label: `${mode}.ocr.ocrKeywordHitRate`,
            minimum: thresholds.minOcrKeywordHitRate,
          }),
        ]
      : []),
  ].filter((failure): failure is string => failure !== undefined);
}

function thresholdFailure({
  actual,
  label,
  maximum,
  minimum,
}: {
  readonly actual: number | null | undefined;
  readonly label: string;
  readonly maximum?: number | undefined;
  readonly minimum?: number | undefined;
}): string | undefined {
  if (minimum === undefined && maximum === undefined) {
    return undefined;
  }

  if (actual === null || actual === undefined) {
    return `${label} is unavailable`;
  }

  if (minimum !== undefined && actual < minimum) {
    return `${label} ${actual} < ${minimum}`;
  }

  if (maximum !== undefined && actual > maximum) {
    return `${label} ${actual} > ${maximum}`;
  }

  return undefined;
}

function validateModeGateThresholds(thresholds: DocumentMultimodalModeEvaluationThresholds): void {
  for (const [key, value] of Object.entries(thresholds)) {
    if (value === undefined) {
      continue;
    }

    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Document multimodal mode gate ${key} must be 0..1`);
    }
  }
}

function boundingBoxFromMetadata(value: unknown): BoundingBoxExpectation | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const x = metadataNumber(value, "x");
  const y = metadataNumber(value, "y");
  const width = metadataNumber(value, "width");
  const height = metadataNumber(value, "height");

  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { height, width, x, y };
}

function boundingBoxIou(left: BoundingBoxExpectation, right: BoundingBoxExpectation): number {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const unionArea = left.width * left.height + right.width * right.height - intersectionArea;

  return unionArea <= 0 ? 0 : intersectionArea / unionArea;
}

function hitRate<T extends object>(
  items: readonly T[],
  key:
    | "boundingBoxHit"
    | "expectedManifestItemHit"
    | "expectedModalityHit"
    | "expectedPageHit"
    | "expectedTitleHit"
    | "expectedUnderstandingStatusHit"
    | "expectedVisualEmbeddingHit",
): number | null {
  const scoped = items.filter((item) => (item as Record<string, unknown>)[key] !== undefined);

  return scoped.length === 0
    ? null
    : ratio(
        scoped.filter((item) => (item as Record<string, unknown>)[key] === true).length,
        scoped.length,
      );
}

function summaryKeywordHitRate(
  items: readonly DocumentMultimodalUnderstandingEvaluationItem[],
): number | null {
  const scoped = items.filter((item) => item.summaryKeywordHitRate !== undefined);

  if (scoped.length === 0) {
    return null;
  }

  return ratio(
    scoped.reduce((sum, item) => sum + (item.summaryKeywordHitRate ?? 0), 0),
    scoped.length,
  );
}

function ocrKeywordHitRate(
  items: readonly DocumentMultimodalOcrRecallEvaluationItem[],
): number | null {
  const scoped = items.filter((item) => item.ocrKeywordHitRate !== undefined);

  if (scoped.length === 0) {
    return null;
  }

  return ratio(
    scoped.reduce((sum, item) => sum + (item.ocrKeywordHitRate ?? 0), 0),
    scoped.length,
  );
}

function summaryKeywordHits({
  expectedKeywords,
  observedText,
}: {
  readonly expectedKeywords: readonly string[];
  readonly observedText: string;
}): {
  readonly hitRate: number;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
} {
  const hits: string[] = [];
  const misses: string[] = [];
  const normalizedText = normalizeForMatch(observedText);

  for (const keyword of expectedKeywords) {
    if (normalizedText.includes(normalizeForMatch(keyword))) {
      hits.push(keyword);
    } else {
      misses.push(keyword);
    }
  }

  return {
    hitRate: ratio(hits.length, expectedKeywords.length),
    hits,
    misses,
  };
}

function searchableUnderstandingText(item: DocumentMultimodalItem): string {
  return [
    item.title,
    item.caption,
    item.ocrText,
    item.textPreview,
    ...metadataStrings(item.sourceMetadata),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function searchableOcrText(item: DocumentMultimodalItem): string {
  return [
    item.ocrText,
    item.textPreview,
    metadataString(item.sourceMetadata, "ocrText"),
    metadataString(item.sourceMetadata, "ocr"),
    metadataString(item.sourceMetadata, "extractedText"),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function understandingStatus(item: DocumentMultimodalItem): string | undefined {
  return isPlainObject(item.sourceMetadata.enrichment)
    ? metadataString(item.sourceMetadata.enrichment, "status")
    : undefined;
}

function metadataStrings(value: unknown): readonly string[] {
  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => metadataStrings(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).flatMap((item) => metadataStrings(item));
  }

  return [];
}

function normalizeForMatch(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 1000) / 1000;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataNumber(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
