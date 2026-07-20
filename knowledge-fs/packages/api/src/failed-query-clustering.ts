import type { FailedQuery } from "@knowledge/core";

// Small English stopword set — enough to keep clustering on content words for short queries.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

/**
 * A canonical key that collapses paraphrases (case, punctuation, word order, stopwords) of the same
 * gap onto one cluster. Deterministic and independent of any embedding index — a lexical first cut;
 * a semantic (embedding) clustering can replace this later without changing the read API.
 */
export function clusterKeyForQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  const content = Array.from(new Set(tokens)).sort();

  if (content.length > 0) {
    return content.join(" ");
  }

  // All-stopword / very short queries fall back to a normalized form so they still group.
  return query.trim().toLowerCase().replace(/\s+/gu, " ");
}

export interface FailedQueryCluster {
  readonly clusterKey: string;
  readonly count: number;
  readonly failedQueryIds: readonly string[];
  readonly representative: FailedQuery;
}

/**
 * Groups failed queries by cluster key, most-frequent first (frequent gaps are higher priority for
 * annotation). The representative is the first query in the group.
 */
export function clusterFailedQueries(items: readonly FailedQuery[]): FailedQueryCluster[] {
  const groups = new Map<string, FailedQuery[]>();

  for (const item of items) {
    const key = clusterKeyForQuery(item.query);
    const group = groups.get(key);

    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const clusters: FailedQueryCluster[] = [];

  for (const [clusterKey, group] of groups) {
    const representative = group[0];

    if (!representative) {
      continue;
    }

    clusters.push({
      clusterKey,
      count: group.length,
      failedQueryIds: group.map((item) => item.id),
      representative,
    });
  }

  return clusters.sort(
    (left, right) => right.count - left.count || left.clusterKey.localeCompare(right.clusterKey),
  );
}
