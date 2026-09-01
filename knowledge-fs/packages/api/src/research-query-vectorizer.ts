import { runWithAbortSignal } from "./bounded-concurrency";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import type { ResearchQueryVectorizer } from "./research-evidence-retrieval";

/** Uses the frozen knowledge-space embedding profile for every Research rewrite in one batch. */
export function createResearchQueryVectorizer(
  resolver: KnowledgeSpaceEmbeddingResolver,
): ResearchQueryVectorizer {
  return {
    vectorize: async ({ embeddingProfile, knowledgeSpaceId, queries, signal, tenantId }) => {
      signal?.throwIfAborted();
      if (queries.length === 0) return [];
      const resolved = await runWithAbortSignal(
        () => resolver.resolve({ knowledgeSpaceId, profile: embeddingProfile, tenantId }),
        signal,
      );
      if (!resolved) throw new Error("Research query embedding profile could not be resolved");
      if (resolved.vectorSpaceId !== embeddingProfile.vectorSpaceId) {
        throw new Error("Research query embedding resolver changed the frozen vector space");
      }
      const result = await runWithAbortSignal(
        () =>
          resolved.providerInstance.embed({
            inputType: "search_query",
            model: embeddingProfile.model,
            ...(signal ? { signal } : {}),
            tenantId,
            texts: [...queries],
          }),
        signal,
      );
      signal?.throwIfAborted();
      if (result.dense.length !== queries.length) {
        throw new Error(
          `Research query embedding provider returned ${result.dense.length} vectors for ${queries.length} queries`,
        );
      }
      assertEmbeddingModelMatchesProfile({
        observedModel: result.model,
        profile: embeddingProfile,
      });
      const vectors = result.dense.map((vector, index) => {
        if (vector.length === 0 || !vector.every(Number.isFinite)) {
          throw new Error(`Research query embedding ${index + 1} is not a non-empty finite vector`);
        }
        assertObservedEmbeddingDimension({
          observedDimension: vector.length,
          profile: embeddingProfile,
        });
        return [...vector];
      });
      return vectors;
    },
  };
}
