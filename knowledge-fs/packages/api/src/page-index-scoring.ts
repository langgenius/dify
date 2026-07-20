import type { DocumentOutlineNode } from "@knowledge/core";

export const PageIndexTokenizerVersion = "pageindex-nfkc-exact-v1" as const;
export const PageIndexScoreVersion = "pageindex-lexical-v2" as const;
export const PageIndexMaxQueryTerms = 64;
export const PageIndexMaxTermChars = 128;
/** Independent UTF-8 payload bound for direct repository/plugin callers. */
export const PageIndexMaxTermBytes = 256;

export class PageIndexQueryComplexityExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageIndexQueryComplexityExceededError";
  }
}

export interface PageIndexNodeScore {
  readonly matchedTerms: readonly string[];
  readonly queryTermCount: number;
  readonly score: number;
  readonly sectionCoverage: number;
  readonly summaryCoverage: number;
  readonly titleCoverage: number;
  readonly version: typeof PageIndexScoreVersion;
}

/**
 * Produces stable language-agnostic terms for PageIndex lexical navigation.
 * CJK runs are expanded to code points so queries do not depend on whitespace
 * tokenization; Latin/digit runs remain whole words.
 */
export function pageIndexQueryTerms(query: string): readonly string[] {
  const terms = pageIndexTextTerms(query);
  const unique = new Set<string>();

  for (const term of terms) {
    if (Array.from(term).length > PageIndexMaxTermChars) {
      throw new PageIndexQueryComplexityExceededError(
        `PageIndex query term exceeds max characters=${PageIndexMaxTermChars}`,
      );
    }
    if (new TextEncoder().encode(term).byteLength > PageIndexMaxTermBytes) {
      throw new PageIndexQueryComplexityExceededError(
        `PageIndex query term exceeds max bytes=${PageIndexMaxTermBytes}`,
      );
    }
    unique.add(term);
    if (unique.size > PageIndexMaxQueryTerms) {
      throw new PageIndexQueryComplexityExceededError(
        `PageIndex query exceeds max terms=${PageIndexMaxQueryTerms}`,
      );
    }
  }

  return [...unique];
}

/**
 * Canonical tokenizer shared by offline PageIndex materialization and online queries. NFKC makes
 * compatibility forms (for example full-width Latin characters) address the same exact inverted
 * term without relying on database collation or substring matching.
 */
export function pageIndexTextTerms(text: string): readonly string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("und");
  const runs = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];

  for (const run of runs) {
    let nonCjk = "";
    const flush = () => {
      if (nonCjk) {
        terms.push(nonCjk);
        nonCjk = "";
      }
    };
    for (const character of Array.from(run)) {
      if (
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)
      ) {
        flush();
        terms.push(character);
      } else {
        nonCjk += character;
      }
    }
    flush();
  }

  return terms;
}

/**
 * Scores only Outline/Summary content on a comparable [0, 1] domain. Tree
 * depth and citation locality are deliberately excluded; callers may use them
 * only as deterministic tie-breakers.
 */
export function scorePageIndexOutlineNode(
  node: DocumentOutlineNode,
  terms: readonly string[],
): PageIndexNodeScore {
  if (terms.length === 0) {
    return emptyScore();
  }

  const titleMatches = matchingTerms(terms, node.title);
  const summaryMatches = matchingTerms(terms, node.summary ?? "");
  const sectionMatches = matchingTerms(terms, node.sectionPath.join(" "));
  const titleCoverage = titleMatches.length / terms.length;
  const summaryCoverage = summaryMatches.length / terms.length;
  const sectionCoverage = sectionMatches.length / terms.length;
  const score = Math.max(titleCoverage, 0.9 * summaryCoverage, 0.8 * sectionCoverage);

  return {
    matchedTerms: [...new Set([...titleMatches, ...summaryMatches, ...sectionMatches])],
    queryTermCount: terms.length,
    score: clampScore(score),
    sectionCoverage,
    summaryCoverage,
    titleCoverage,
    version: PageIndexScoreVersion,
  };
}

function emptyScore(): PageIndexNodeScore {
  return {
    matchedTerms: [],
    queryTermCount: 0,
    score: 0,
    sectionCoverage: 0,
    summaryCoverage: 0,
    titleCoverage: 0,
    version: PageIndexScoreVersion,
  };
}

function matchingTerms(terms: readonly string[], text: string): string[] {
  if (!text) {
    return [];
  }

  const textTerms = new Set<string>();
  for (const term of pageIndexTextTerms(text)) {
    textTerms.add(term);
  }
  return terms.filter((term) => textTerms.has(term));
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}
