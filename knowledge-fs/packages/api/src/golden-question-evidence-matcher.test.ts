import type { KnowledgeSpaceEmbeddingProfile } from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createGoldenQuestionEvidenceMatcher } from "./golden-question-evidence-matcher";
import type { SearchDenseInput } from "./retrieval-candidates";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const profile: KnowledgeSpaceEmbeddingProfile = {
  dimension: 3,
  model: "embedding-model",
  pluginId: "embedding-plugin",
  provider: "embedding-provider",
  revision: 1,
  vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
};

describe("createGoldenQuestionEvidenceMatcher", () => {
  it("deduplicates evidence, embeds in bounded batches, and limits dense search concurrency", async () => {
    const embedBatchSizes: number[] = [];
    const provider: EmbeddingProvider = {
      embed: async (input) => {
        embedBatchSizes.push(input.texts.length);
        return {
          dense: input.texts.map(() => [0.1, 0.2, 0.3]),
          metadata: { dimension: 3, model: profile.model, provider: "static" },
          model: profile.model,
        };
      },
      kind: "static",
      models: async () => [],
    };
    let activeSearches = 0;
    let maxActiveSearches = 0;
    const searchDense = vi.fn(async (_input: SearchDenseInput) => {
      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
      await Promise.resolve();
      activeSearches -= 1;
      return [
        {
          citation: {
            artifactHash: "b".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            documentVersion: 1,
            sectionPath: ["Refunds"],
          },
          metadata: { text: "Refunds are available for 30 days." },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
          permissionScope: ["tenant:tenant-1"],
          projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
          score: 0.86,
          source: "dense" as const,
        },
      ];
    });
    const matcher = createGoldenQuestionEvidenceMatcher({
      embeddings: {
        resolve: async () => ({ ...profile, providerInstance: provider }),
      },
      repository: { searchDense },
      runtimeSnapshots: {
        assertReady: async () => undefined,
        resolve: async () => ({
          embeddingProfile: profile,
          projectionSnapshot: {
            fingerprint: `sha256:${"c".repeat(64)}`,
            headRevision: 1,
            knowledgeSpaceId,
            projectionVersion: 1,
            publicationId,
            tenantId: "tenant-1",
          },
          retrievalCapabilitySnapshot: {},
          retrievalProfile: {
            defaultMode: "fast",
            reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
            rerank: { enabled: false },
            revision: 1,
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 5,
          },
        }),
      },
    });
    const unique = Array.from({ length: 130 }, (_, index) => `evidence-${index}`);

    const matches = await matcher.match({
      evidenceTexts: [...unique, unique[0] as string],
      knowledgeSpaceId,
      minimumSimilarity: 0.7,
      permissionScope: ["tenant:tenant-1"],
      tenantId: "tenant-1",
      topK: 1,
    });

    expect(embedBatchSizes).toEqual([128, 2]);
    expect(searchDense).toHaveBeenCalledTimes(130);
    expect(maxActiveSearches).toBeLessThanOrEqual(8);
    expect(matches).toHaveLength(131);
    expect(matches[0]).toMatchObject({ matched: true });
    expect(matches.at(-1)).toEqual(matches[0]);
    expect(searchDense.mock.calls[0]?.[0]).toMatchObject({
      denseProjectionModel: profile.vectorSpaceId,
      projectionSetPublicationId: publicationId,
      projectionSetReadMode: "published",
    });
  });
});
