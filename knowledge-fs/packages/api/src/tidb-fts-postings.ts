import { createHash } from "node:crypto";

import type { IndexProjection } from "@knowledge/core";

import { normalizeMixedLanguageFtsText } from "./retrieval-text-utils";

export const TIDB_FTS_TOKENIZER_VERSION = "mixed-nfkc-v1";
export const MAX_TIDB_FTS_DOCUMENT_CODE_UNITS = 1_000_000;
export const MAX_TIDB_FTS_DOCUMENT_BYTES = 65_535;
export const MAX_TIDB_FTS_DOCUMENT_TOKENS = 100_000;
export const MAX_TIDB_FTS_TERMS_PER_PROJECTION = 2_048;
export const MAX_TIDB_FTS_POSTINGS_PER_BATCH = 4_096;
export const MAX_TIDB_FTS_QUERY_TERMS = 32;
export const MAX_TIDB_FTS_TERM_CODE_POINTS = 128;
export const MAX_TIDB_FTS_TERM_UTF8_BYTES = 256;

export interface TidbFtsPosting {
  readonly documentTokenCount: number;
  readonly term: string;
  readonly termFrequency: number;
  readonly termHash: string;
  readonly tokenizerVersion: typeof TIDB_FTS_TOKENIZER_VERSION;
}

export interface TidbFtsProjectionPostingPlan {
  readonly postings: readonly TidbFtsPosting[];
  readonly projection: IndexProjection;
}

export interface TidbFtsQueryTerms {
  readonly hashes: readonly string[];
  readonly terms: readonly string[];
}

export class TidbFtsTokenizationLimitError extends Error {
  readonly code = "TIDB_FTS_TOKENIZATION_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "TidbFtsTokenizationLimitError";
  }
}

export function createTidbFtsProjectionPostingPlans(
  projections: readonly IndexProjection[],
): TidbFtsProjectionPostingPlan[] {
  const plans = new Map<string, TidbFtsProjectionPostingPlan>();

  for (const projection of projections) {
    if (projection.type !== "fts") {
      continue;
    }
    const ftsText = projection.metadata.ftsText;
    if (typeof ftsText !== "string" || ftsText.length === 0) {
      throw new Error("FTS projection metadata must include ftsText");
    }
    const postings = createDocumentPostings(ftsText);
    // Mutable multi-row upserts apply the last value for a repeated logical projection. Mirror
    // that deterministic database behavior while immutable duplicates are checked elsewhere.
    plans.set(indexProjectionPostingLogicalKey(projection), { postings, projection });
  }

  const output = [...plans.values()];
  const postingCount = output.reduce((total, plan) => total + plan.postings.length, 0);
  if (postingCount > MAX_TIDB_FTS_POSTINGS_PER_BATCH) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS batch postings exceed maxPostings=${MAX_TIDB_FTS_POSTINGS_PER_BATCH}`,
    );
  }

  return output;
}

export function createTidbFtsQueryTerms(query: string): TidbFtsQueryTerms {
  const terms = tokenize(query, "query");
  const uniqueTerms = [...new Set(terms)];
  if (uniqueTerms.length > MAX_TIDB_FTS_QUERY_TERMS) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS query terms exceed maxTerms=${MAX_TIDB_FTS_QUERY_TERMS}`,
    );
  }

  return {
    hashes: uniqueTerms.map(hashTidbFtsTerm),
    terms: uniqueTerms,
  };
}

/**
 * Rebuilds the exact posting set from the normalized source persisted on an FTS projection. The
 * normalizer is intentionally applied again: it is idempotent and keeps historical repair on the
 * same bounded tokenizer implementation as the transactional dual writer.
 */
export function createTidbFtsDocumentPostings(input: string): readonly TidbFtsPosting[] {
  return createDocumentPostings(input);
}

export function hashTidbFtsTerm(term: string): string {
  return createHash("sha256").update(`${TIDB_FTS_TOKENIZER_VERSION}\u0000${term}`).digest("hex");
}

function createDocumentPostings(input: string): TidbFtsPosting[] {
  if (input.length > MAX_TIDB_FTS_DOCUMENT_CODE_UNITS) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS document exceeds maxCodeUnits=${MAX_TIDB_FTS_DOCUMENT_CODE_UNITS}`,
    );
  }
  const normalized = normalizeMixedLanguageFtsText(input);
  if (Buffer.byteLength(normalized, "utf8") > MAX_TIDB_FTS_DOCUMENT_BYTES) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS document exceeds maxUtf8Bytes=${MAX_TIDB_FTS_DOCUMENT_BYTES}`,
    );
  }
  const tokens = tokenizeNormalized(normalized, "document");
  if (tokens.length > MAX_TIDB_FTS_DOCUMENT_TOKENS) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS document tokens exceed maxTokens=${MAX_TIDB_FTS_DOCUMENT_TOKENS}`,
    );
  }
  const frequencies = new Map<string, number>();
  for (const term of tokens) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  if (frequencies.size > MAX_TIDB_FTS_TERMS_PER_PROJECTION) {
    throw new TidbFtsTokenizationLimitError(
      `TiDB FTS projection terms exceed maxTerms=${MAX_TIDB_FTS_TERMS_PER_PROJECTION}`,
    );
  }

  return [...frequencies]
    .map(
      ([term, termFrequency]): TidbFtsPosting => ({
        documentTokenCount: tokens.length,
        term,
        termFrequency,
        termHash: hashTidbFtsTerm(term),
        tokenizerVersion: TIDB_FTS_TOKENIZER_VERSION,
      }),
    )
    .sort(
      (left, right) =>
        left.termHash.localeCompare(right.termHash) || left.term.localeCompare(right.term),
    );
}

function tokenize(input: string, kind: "document" | "query"): string[] {
  const normalized = normalizeMixedLanguageFtsText(input);
  return tokenizeNormalized(normalized, kind);
}

function tokenizeNormalized(normalized: string, kind: "document" | "query"): string[] {
  if (!normalized) {
    throw new Error(
      kind === "query"
        ? "Hybrid retrieval query must not be empty"
        : "FTS projection metadata must include searchable ftsText",
    );
  }
  const tokens = normalized
    .split(" ")
    .filter(
      (term) =>
        [...term].length <= MAX_TIDB_FTS_TERM_CODE_POINTS &&
        Buffer.byteLength(term, "utf8") <= MAX_TIDB_FTS_TERM_UTF8_BYTES,
    );
  if (tokens.length === 0) {
    throw new Error(
      kind === "query"
        ? "Hybrid retrieval query must include a searchable bounded term"
        : "FTS projection metadata must include a searchable bounded ftsText term",
    );
  }
  return tokens;
}

function indexProjectionPostingLogicalKey(projection: IndexProjection): string {
  return JSON.stringify([
    projection.knowledgeSpaceId,
    projection.nodeId,
    projection.type,
    projection.projectionVersion,
    projection.model ?? null,
    projection.publicationGenerationId ?? null,
  ]);
}
