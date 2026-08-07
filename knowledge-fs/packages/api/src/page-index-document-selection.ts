import type { RetrievalCandidate } from "./retrieval-candidates";
import { normalizeRetrievalScoreSeries } from "./retrieval-fusion";

export interface PageIndexDocumentValueHit {
  readonly candidate: RetrievalCandidate;
  readonly normalizedScore: number;
}

export interface PageIndexDocumentSelection {
  readonly documentAssetId: string;
  /** Unique dense-hit nodes observed before the per-document cap is applied. */
  readonly hitCount: number;
  readonly hits: readonly PageIndexDocumentValueHit[];
  /** Pre-normalization DocScore used for deterministic ranking diagnostics. */
  readonly rawScore: number;
  /** Query-relative DocScore normalized to [0, 1]. */
  readonly score: number;
}

export interface SelectPageIndexDocumentsInput {
  readonly candidates: readonly RetrievalCandidate[];
  readonly maxDocuments: number;
  readonly maxHitsPerDocument: number;
}

/**
 * Builds a bounded document shortlist from dense Value Search hits.
 *
 * One strongest hit per document/node participates so duplicate projections cannot inflate a
 * document. Each document then uses the PageIndex diminishing-return aggregation rule and the
 * final series is normalized only for query-local scheduling.
 */
export function selectPageIndexDocuments({
  candidates,
  maxDocuments,
  maxHitsPerDocument,
}: SelectPageIndexDocumentsInput): readonly PageIndexDocumentSelection[] {
  validatePositiveInteger(maxDocuments, "maxDocuments");
  validatePositiveInteger(maxHitsPerDocument, "maxHitsPerDocument");

  const normalizedScores = normalizeRetrievalScoreSeries(
    candidates.map((candidate) => candidate.score),
  );
  const byDocumentAndNode = new Map<string, PageIndexDocumentValueHit>();

  candidates.forEach((candidate, index) => {
    const normalizedScore = normalizedScores[index] ?? 0;
    const key = `${candidate.citation.documentAssetId}\u001f${candidate.nodeId}`;
    const existing = byDocumentAndNode.get(key);

    if (
      !existing ||
      normalizedScore > existing.normalizedScore ||
      (normalizedScore === existing.normalizedScore &&
        candidate.projectionId.localeCompare(existing.candidate.projectionId) < 0)
    ) {
      byDocumentAndNode.set(key, { candidate, normalizedScore });
    }
  });

  const hitsByDocument = new Map<string, PageIndexDocumentValueHit[]>();
  for (const hit of byDocumentAndNode.values()) {
    const documentAssetId = hit.candidate.citation.documentAssetId;
    const hits = hitsByDocument.get(documentAssetId) ?? [];
    hits.push(hit);
    hitsByDocument.set(documentAssetId, hits);
  }

  const documents = [...hitsByDocument.entries()].map(([documentAssetId, allHits]) => {
    const orderedHits = allHits.sort(compareHits);
    const hits = orderedHits.slice(0, maxHitsPerDocument);
    const rawScore =
      hits.reduce((total, hit) => total + hit.normalizedScore, 0) / Math.sqrt(hits.length + 1);

    return {
      documentAssetId,
      hitCount: orderedHits.length,
      hits,
      rawScore,
    };
  });
  const normalizedDocumentScores = normalizeRetrievalScoreSeries(
    documents.map((document) => document.rawScore),
  );

  return documents
    .map(
      (document, index): PageIndexDocumentSelection => ({
        ...document,
        score: normalizedDocumentScores[index] ?? 0,
      }),
    )
    .sort(
      (left, right) =>
        right.rawScore - left.rawScore || left.documentAssetId.localeCompare(right.documentAssetId),
    )
    .slice(0, maxDocuments);
}

function compareHits(left: PageIndexDocumentValueHit, right: PageIndexDocumentValueHit): number {
  return (
    right.normalizedScore - left.normalizedScore ||
    left.candidate.nodeId.localeCompare(right.candidate.nodeId) ||
    left.candidate.projectionId.localeCompare(right.candidate.projectionId)
  );
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex document selection ${label} must be at least 1`);
  }
}
