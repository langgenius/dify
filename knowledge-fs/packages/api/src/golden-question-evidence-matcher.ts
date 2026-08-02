import type { KnowledgeSpaceEmbeddingProfile } from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import type { HybridRetrievalRepository, RetrievalCandidate } from "./retrieval-candidates";

const EMBEDDING_BATCH_SIZE = 128;
const RETRIEVAL_CONCURRENCY = 8;

export interface GoldenQuestionEvidenceCandidate {
  readonly documentAssetId: string;
  readonly nodeId: string;
  readonly pageNumber?: number | undefined;
  readonly permissionScope: readonly string[];
  readonly projectionId: string;
  readonly score: number;
  readonly sectionPath: readonly string[];
  readonly text: string;
}

export interface GoldenQuestionEvidenceMatch {
  readonly candidates: readonly GoldenQuestionEvidenceCandidate[];
  readonly evidenceText: string;
  readonly matched: boolean;
}

export interface MatchGoldenQuestionEvidenceInput {
  readonly evidenceTexts: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly minimumSimilarity: number;
  readonly permissionScope: readonly string[];
  readonly tenantId: string;
  readonly topK: number;
}

export interface GoldenQuestionEvidenceMatcher {
  match(input: MatchGoldenQuestionEvidenceInput): Promise<readonly GoldenQuestionEvidenceMatch[]>;
}

export interface CreateGoldenQuestionEvidenceMatcherOptions {
  readonly embeddings: KnowledgeSpaceEmbeddingResolver;
  readonly repository: Pick<HybridRetrievalRepository, "searchDense">;
  readonly runtimeSnapshots: PublishedKnowledgeSpaceRuntimeSnapshotResolver;
}

export class GoldenQuestionEvidenceMatchingUnavailableError extends Error {
  constructor(
    message = "Golden question evidence matching is unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GoldenQuestionEvidenceMatchingUnavailableError";
  }
}

/**
 * Matches evidence descriptions against one immutable published snapshot. Evidence text is
 * deduplicated before embedding, provider calls are chunked, and dense reads use bounded
 * concurrency so a CSV import never turns into one model call or an unbounded query burst per row.
 */
export function createGoldenQuestionEvidenceMatcher({
  embeddings,
  repository,
  runtimeSnapshots,
}: CreateGoldenQuestionEvidenceMatcherOptions): GoldenQuestionEvidenceMatcher {
  return {
    match: async (input) => {
      const evidenceTexts = input.evidenceTexts.map((value) => value.trim());
      const uniqueEvidenceTexts = [...new Set(evidenceTexts)];

      try {
        const runtimeSnapshot = await runtimeSnapshots.resolve({
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        });
        const profile = runtimeSnapshot.embeddingProfile;
        if (!profile) {
          throw new GoldenQuestionEvidenceMatchingUnavailableError(
            "Golden question evidence matching requires an active embedding profile",
          );
        }
        const resolved = await embeddings.resolve({
          knowledgeSpaceId: input.knowledgeSpaceId,
          profile,
          tenantId: input.tenantId,
        });
        if (!resolved) {
          throw new GoldenQuestionEvidenceMatchingUnavailableError(
            "Golden question evidence matching requires an embedding provider",
          );
        }

        const vectors = await embedEvidenceTexts({
          evidenceTexts: uniqueEvidenceTexts,
          profile,
          provider: resolved.providerInstance,
          tenantId: input.tenantId,
        });
        const candidatesByText = await mapWithConcurrency(
          uniqueEvidenceTexts,
          RETRIEVAL_CONCURRENCY,
          async (evidenceText) => {
            const vector = vectors.get(evidenceText);
            if (!vector) {
              throw new GoldenQuestionEvidenceMatchingUnavailableError(
                "Embedding provider omitted an evidence vector",
              );
            }
            const candidates = await repository.searchDense({
              denseProjectionModel: profile.vectorSpaceId,
              knowledgeSpaceId: input.knowledgeSpaceId,
              permissionScope: input.permissionScope,
              projectionSetPublicationId: runtimeSnapshot.projectionSnapshot.publicationId,
              projectionSetReadMode: "published",
              queryVector: vector,
              tenantId: input.tenantId,
              topK: input.topK,
            });
            return [evidenceText, candidates.map(toEvidenceCandidate)] as const;
          },
        );
        const lookup = new Map(candidatesByText);

        return evidenceTexts.map((evidenceText) => {
          const candidates = lookup.get(evidenceText) ?? [];
          return {
            candidates,
            evidenceText,
            matched: (candidates[0]?.score ?? Number.NEGATIVE_INFINITY) >= input.minimumSimilarity,
          };
        });
      } catch (error) {
        if (error instanceof GoldenQuestionEvidenceMatchingUnavailableError) throw error;
        throw new GoldenQuestionEvidenceMatchingUnavailableError(undefined, { cause: error });
      }
    },
  };
}

async function embedEvidenceTexts(input: {
  readonly evidenceTexts: readonly string[];
  readonly profile: KnowledgeSpaceEmbeddingProfile;
  readonly provider: EmbeddingProvider;
  readonly tenantId: string;
}): Promise<Map<string, readonly number[]>> {
  const vectors = new Map<string, readonly number[]>();
  for (let offset = 0; offset < input.evidenceTexts.length; offset += EMBEDDING_BATCH_SIZE) {
    const texts = input.evidenceTexts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const response = await input.provider.embed({
      inputType: "search_query",
      model: input.profile.model,
      tenantId: input.tenantId,
      texts: [...texts],
    });
    if (response.dense.length !== texts.length) {
      throw new GoldenQuestionEvidenceMatchingUnavailableError(
        `Embedding provider returned ${response.dense.length} vectors for ${texts.length} evidence texts`,
      );
    }
    assertEmbeddingModelMatchesProfile({ observedModel: response.model, profile: input.profile });
    for (const [index, text] of texts.entries()) {
      const vector = response.dense[index];
      if (!vector || vector.length === 0 || !vector.every(Number.isFinite)) {
        throw new GoldenQuestionEvidenceMatchingUnavailableError(
          `Embedding provider returned an invalid vector at batch index ${index}`,
        );
      }
      assertObservedEmbeddingDimension({
        observedDimension: vector.length,
        profile: input.profile,
      });
      vectors.set(text, [...vector]);
    }
  }
  return vectors;
}

function toEvidenceCandidate(candidate: RetrievalCandidate): GoldenQuestionEvidenceCandidate {
  const text = candidate.metadata.text;
  return {
    documentAssetId: candidate.citation.documentAssetId,
    nodeId: candidate.nodeId,
    ...(candidate.citation.pageNumber === undefined
      ? {}
      : { pageNumber: candidate.citation.pageNumber }),
    permissionScope: [...candidate.permissionScope],
    projectionId: candidate.projectionId,
    score: Math.max(0, Math.min(1, candidate.score)),
    sectionPath: [...candidate.citation.sectionPath],
    text: typeof text === "string" ? text : "",
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
