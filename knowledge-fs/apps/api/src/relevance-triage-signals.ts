import type {
  AnswerabilitySignal,
  DocumentAssetRepository,
  DocumentOutlineRepository,
  GraphIndexRepository,
  RelevanceTriageSignals,
} from "@knowledge/api";
import type { LlmProvider } from "@knowledge/generation";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "can", "did", "do", "does", "for", "from", "how", "into", "is", "it",
  "me", "of", "on", "or", "tell", "that", "the", "this", "to", "was", "what", "when", "where",
  "which", "who", "why", "with", "you", "your",
]);

/** Content tokens (lowercased, punctuation-stripped, stopword- and short-word-filtered, deduped). */
export function contentTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/gu, " ")
        .split(/\s+/u)
        .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
    ),
  );
}

function countOverlap(tokens: readonly string[], vocabulary: ReadonlySet<string>): number {
  let overlap = 0;

  for (const token of tokens) {
    if (vocabulary.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

/** Parses the answerability judge's reply into a verdict; defaults to uncertain (precision-first). */
export function parseAnswerabilityVerdict(text: string): AnswerabilitySignal {
  const normalized = text.toUpperCase();

  if (/RETRIEVAL[_\s]?MISS/u.test(normalized)) {
    return { confidence: 0.7, verdict: "retrieval-miss" };
  }

  if (/COVERAGE[_\s]?GAP/u.test(normalized)) {
    return { confidence: 0.7, verdict: "coverage-gap" };
  }

  return { confidence: 0.4, verdict: "uncertain" };
}

export interface TriageCorpus {
  readonly entityTokens: ReadonlySet<string>;
  readonly summaryTokens: ReadonlySet<string>;
  /** A short sample of corpus topics (entity names / section titles) for the LLM judge. */
  readonly topics: readonly string[];
}

export type LoadTriageCorpus = (knowledgeSpaceId: string) => Promise<TriageCorpus>;

export interface AnswerabilityJudgeInput {
  readonly query: string;
  readonly tenantId: string;
  readonly topics: readonly string[];
}

export type AnswerabilityJudge = (input: AnswerabilityJudgeInput) => Promise<AnswerabilitySignal>;

/**
 * Relevance triage signals built from independent, coarse corpus views (the knowledge graph's
 * entities and, where available, document/section summaries) plus an optional LLM answerability
 * judge. The per-space corpus is cached with a TTL so a triage batch loads it once.
 */
export function createApiRelevanceTriageSignals({
  cacheTtlMs = 60_000,
  judge,
  loadCorpus,
  now = () => Date.now(),
}: {
  readonly cacheTtlMs?: number | undefined;
  readonly judge?: AnswerabilityJudge | undefined;
  readonly loadCorpus: LoadTriageCorpus;
  readonly now?: () => number;
}): RelevanceTriageSignals {
  const cache = new Map<string, { corpus: TriageCorpus; expiresAt: number }>();

  async function corpusFor(knowledgeSpaceId: string): Promise<TriageCorpus> {
    const cached = cache.get(knowledgeSpaceId);

    if (cached && cached.expiresAt > now()) {
      return cached.corpus;
    }

    const corpus = await loadCorpus(knowledgeSpaceId);
    cache.set(knowledgeSpaceId, { corpus, expiresAt: now() + cacheTtlMs });

    return corpus;
  }

  return {
    answerability: async ({ knowledgeSpaceId, query, tenantId }) => {
      if (!judge) {
        return { verdict: "uncertain" };
      }

      const corpus = await corpusFor(knowledgeSpaceId);

      return judge({ query, tenantId, topics: corpus.topics });
    },
    graphRelevance: async ({ knowledgeSpaceId, query }) => {
      const corpus = await corpusFor(knowledgeSpaceId);
      const overlap = countOverlap(contentTokens(query), corpus.entityTokens);

      return { entityOverlap: overlap, matched: overlap > 0 };
    },
    summaryRelevance: async ({ knowledgeSpaceId, query }) => {
      const corpus = await corpusFor(knowledgeSpaceId);
      const tokens = contentTokens(query);
      const overlap = countOverlap(tokens, corpus.summaryTokens);

      return { matched: overlap > 0, score: tokens.length > 0 ? overlap / tokens.length : 0 };
    },
  };
}

interface OutlineNodeLike {
  readonly children?: readonly OutlineNodeLike[] | undefined;
  readonly summary?: string | undefined;
  readonly title?: string | undefined;
}

function* walkOutlineNodes(nodes: readonly OutlineNodeLike[]): Generator<OutlineNodeLike> {
  for (const node of nodes) {
    yield node;

    if (node.children) {
      yield* walkOutlineNodes(node.children);
    }
  }
}

/**
 * Loads a space's corpus vocabulary from the knowledge graph (entity names + aliases) and, where
 * outlines are available, document/section titles + summaries. Bounded by `maxEntities`/`maxAssets`.
 * NOTE: document outlines are not yet DB-persisted, so in database mode `summaryTokens` is empty
 * until outline persistence (or a coarse summary-embedding index) is added — graph relevance carries
 * triage in the meantime.
 */
export function createApiTriageCorpusLoader({
  documentAssets,
  documentOutlines,
  graphIndex,
  maxAssets = 200,
  maxEntities = 1_000,
  maxTopics = 80,
}: {
  readonly documentAssets?: DocumentAssetRepository | undefined;
  readonly documentOutlines?: DocumentOutlineRepository | undefined;
  readonly graphIndex: GraphIndexRepository;
  readonly maxAssets?: number | undefined;
  readonly maxEntities?: number | undefined;
  readonly maxTopics?: number | undefined;
}): LoadTriageCorpus {
  return async (knowledgeSpaceId) => {
    const entityTokens = new Set<string>();
    const summaryTokens = new Set<string>();
    const topics: string[] = [];

    const entities = await graphIndex.listEntities({ knowledgeSpaceId, limit: maxEntities });

    for (const entity of entities.items) {
      for (const token of contentTokens(entity.name)) {
        entityTokens.add(token);
      }

      for (const alias of entity.aliases) {
        for (const token of contentTokens(alias)) {
          entityTokens.add(token);
        }
      }

      if (topics.length < maxTopics) {
        topics.push(entity.name);
      }
    }

    // Summary sources are optional — document outlines are not yet DB-persisted (see note above).
    if (!documentAssets || !documentOutlines) {
      return { entityTokens, summaryTokens, topics };
    }

    const assets = await documentAssets.list({ knowledgeSpaceId, limit: maxAssets });

    for (const asset of assets.items) {
      const outline = await documentOutlines.getByDocumentVersion({
        documentAssetId: asset.id,
        version: asset.version,
      });

      if (!outline) {
        continue;
      }

      for (const node of walkOutlineNodes(outline.nodes)) {
        if (node.title) {
          for (const token of contentTokens(node.title)) {
            summaryTokens.add(token);
          }
        }

        if (node.summary) {
          for (const token of contentTokens(node.summary)) {
            summaryTokens.add(token);
          }
        }
      }
    }

    return { entityTokens, summaryTokens, topics };
  };
}

const JUDGE_SYSTEM_PROMPT =
  "You judge whether a knowledge base can answer a user query. You are given the corpus's topics " +
  "and a query for which retrieval returned nothing. Reply with EXACTLY one token: RETRIEVAL_MISS " +
  "if the corpus clearly covers this topic and likely contains the answer (so retrieval should have " +
  "found it); COVERAGE_GAP if the topic is related but the corpus likely does not contain the answer; " +
  "UNCERTAIN otherwise. Be conservative: prefer UNCERTAIN when unsure.";

/** Answerability judge backed by the answer LLM provider. */
export function createApiAnswerabilityJudge({
  maxOutputTokens = 8,
  maxTopics = 60,
  model,
  provider,
}: {
  readonly maxOutputTokens?: number | undefined;
  readonly maxTopics?: number | undefined;
  readonly model: string;
  readonly provider: LlmProvider;
}): AnswerabilityJudge {
  return async ({ query, tenantId, topics }) => {
    try {
      const result = await provider.generate({
        maxOutputTokens,
        messages: [
          { content: JUDGE_SYSTEM_PROMPT, role: "system" },
          {
            content: `Corpus topics: ${topics.slice(0, maxTopics).join(", ") || "(none)"}\n\nQuery: ${query}`,
            role: "user",
          },
        ],
        model,
        tenantId,
      });

      return parseAnswerabilityVerdict(result.text);
    } catch {
      return { verdict: "uncertain" };
    }
  };
}

/**
 * Builds the relevance triage signals for the gateway from the persistent knowledge graph plus,
 * when available, document summaries and the answer LLM (for the answerability judge). Returns `{}`
 * when there is no graph to judge relevance against.
 */
export function createApiRelevanceTriageOptions({
  answer,
  documentAssets,
  documentOutlines,
  graphIndex,
}: {
  readonly answer?: { readonly model: string; readonly provider: LlmProvider } | undefined;
  readonly documentAssets?: DocumentAssetRepository | undefined;
  readonly documentOutlines?: DocumentOutlineRepository | undefined;
  readonly graphIndex?: GraphIndexRepository | undefined;
}): { readonly relevanceTriageSignals?: RelevanceTriageSignals } {
  if (!graphIndex) {
    return {};
  }

  const loadCorpus = createApiTriageCorpusLoader({
    graphIndex,
    ...(documentAssets ? { documentAssets } : {}),
    ...(documentOutlines ? { documentOutlines } : {}),
  });
  const judge = answer
    ? createApiAnswerabilityJudge({ model: answer.model, provider: answer.provider })
    : undefined;

  return {
    relevanceTriageSignals: createApiRelevanceTriageSignals({
      loadCorpus,
      ...(judge ? { judge } : {}),
    }),
  };
}
