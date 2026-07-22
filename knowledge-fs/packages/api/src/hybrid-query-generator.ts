import type { EmbeddingProvider } from "@knowledge/embeddings";

import type { DocumentMultimodalCandidateResolver } from "./document-multimodal-candidate-resolver";
import { createEvidenceBundleAssembler } from "./evidence-bundle-assembler";
import {
  type QueryGenerationEvent,
  type QueryGenerator,
  queryProjectionSnapshotMetadata,
  queryRetrievalProfileMetadata,
  traceStepEvent,
} from "./gateway-sse-responses";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  type KnowledgeSpaceEmbeddingResolver,
  type ResolvedKnowledgeSpaceEmbedding,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import {
  type MultimodalEvidenceAttachment,
  multimodalEvidenceAnswerLines,
  multimodalEvidenceFromCitations,
} from "./multimodal-evidence";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type { BasicHybridRetriever } from "./retrieval-types";

export interface HybridQueryGeneratorOptions {
  readonly embeddingModel?: string | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  /** Resolves the active tenant + knowledge-space embedding profile at request time. */
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly limit: number;
  readonly maxAnswerChars: number;
  readonly multimodalAnswerProvider?: MultimodalAnswerProvider | undefined;
  readonly maxMultimodalEvidenceItems?: number | undefined;
  readonly multimodalCandidateResolver?: DocumentMultimodalCandidateResolver | undefined;
  readonly queryEmbeddingModel?: string | undefined;
  readonly queryEmbeddingProvider?: EmbeddingProvider | undefined;
  readonly retriever: BasicHybridRetriever;
  readonly topK: number;
}

export interface MultimodalAnswerProviderInput {
  readonly evidence: readonly MultimodalAnswerEvidenceItem[];
  readonly multimodalEvidence: readonly MultimodalEvidenceAttachment[];
  readonly query: string;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface MultimodalAnswerEvidenceItem {
  readonly citation: HybridRetrievalItem["citation"];
  readonly nodeId: string;
  readonly text: string;
}

export interface MultimodalAnswerProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly text: string;
}

export interface MultimodalAnswerProvider {
  generate(input: MultimodalAnswerProviderInput): Promise<MultimodalAnswerProviderResult>;
}

export function createHybridQueryGenerator({
  embeddingModel,
  embeddingResolver,
  embeddings,
  limit,
  maxAnswerChars,
  multimodalAnswerProvider,
  maxMultimodalEvidenceItems = 20,
  multimodalCandidateResolver,
  queryEmbeddingModel,
  queryEmbeddingProvider,
  retriever,
  topK,
}: HybridQueryGeneratorOptions): QueryGenerator {
  const effectiveEmbeddingModel = queryEmbeddingModel ?? embeddingModel;
  const effectiveEmbeddingProvider = queryEmbeddingProvider ?? embeddings;

  validateHybridQueryGeneratorBounds({
    embeddingModel: effectiveEmbeddingModel,
    embeddingResolver,
    embeddings: effectiveEmbeddingProvider,
    limit,
    maxAnswerChars,
    maxMultimodalEvidenceItems,
    topK,
  });
  const evidenceBundleAssembler = createEvidenceBundleAssembler();

  return {
    stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
      const tenantId = input.subject.tenantId;
      const retrievalProfileMetadata = queryRetrievalProfileMetadata(input.retrievalProfile);
      const projectionSnapshotMetadata = queryProjectionSnapshotMetadata(input.projectionSnapshot);
      const embedStartedAt = Date.now();
      // Research is an independent published PageIndex path. It must not
      // depend on, call, or observe the dense embedding capability.
      const requiresQueryEmbedding = input.mode !== "research";
      const resolvedEmbedding =
        requiresQueryEmbedding && embeddingResolver
          ? await embeddingResolver.resolve({
              ...(input.embeddingProfile ? { profile: input.embeddingProfile } : {}),
              knowledgeSpaceId: input.knowledgeSpaceId,
              tenantId,
            })
          : null;
      const queryEmbedding = requiresQueryEmbedding
        ? await embedQueryVector({
            model: resolvedEmbedding?.model ?? effectiveEmbeddingModel,
            profile: resolvedEmbedding,
            provider: resolvedEmbedding?.providerInstance ?? effectiveEmbeddingProvider,
            query: input.query,
            tenantId,
          })
        : { vector: [0] as readonly number[] };
      if (resolvedEmbedding) {
        if (input.embeddingProfile) {
          assertObservedEmbeddingDimension({
            observedDimension: queryEmbedding.vector.length,
            profile: input.embeddingProfile,
          });
        } else {
          await embeddingResolver?.observeDimension?.({
            dimension: queryEmbedding.vector.length,
            knowledgeSpaceId: input.knowledgeSpaceId,
            revision: resolvedEmbedding.revision,
            tenantId,
            vectorSpaceId: resolvedEmbedding.vectorSpaceId,
          });
        }
      }

      if (requiresQueryEmbedding && (resolvedEmbedding || effectiveEmbeddingProvider)) {
        yield traceStepEvent("query.embed", embedStartedAt, "ok", {
          ...(queryEmbedding.embeddingModel ? { model: queryEmbedding.embeddingModel } : {}),
          dimension: queryEmbedding.vector.length,
          ...(queryEmbedding.vectorSpaceId ? { vectorSpaceId: queryEmbedding.vectorSpaceId } : {}),
        });
      }

      const retrieveStartedAt = Date.now();
      const retrievalTopK = input.topK ?? input.retrievalProfile?.topK ?? topK;
      const retrieval = await retriever.retrieve({
        ...(queryEmbedding.vectorSpaceId
          ? { denseProjectionModel: queryEmbedding.vectorSpaceId }
          : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit: input.topK !== undefined || input.retrievalProfile ? retrievalTopK : limit,
        mode: input.mode,
        permissionScope: input.permissionScope,
        ...(input.projectionSnapshot ? { projectionSnapshot: input.projectionSnapshot } : {}),
        query: input.query,
        queryVector: queryEmbedding.vector,
        ...(input.requestedMode ? { requestedMode: input.requestedMode } : {}),
        ...(input.retrievalProfile ? { retrievalProfile: input.retrievalProfile } : {}),
        tenantId,
        topK: retrievalTopK,
        traceId: input.traceId,
      });
      yield traceStepEvent("query.retrieve", retrieveStartedAt, "ok", {
        itemCount: retrieval.items.length,
        ...(projectionSnapshotMetadata ? { projectionSnapshot: projectionSnapshotMetadata } : {}),
        ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
        ...(retrieval.plan ? { plan: retrieval.plan } : {}),
        ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
      });
      const evidenceBundle = evidenceBundleAssembler.assemble({
        query: input.query,
        retrieval,
        traceId: input.traceId,
      });

      if (retrieval.items.length === 0) {
        yield {
          delta: "I could not find evidence for that query in the indexed retrieval projections.",
          type: "delta",
        };
        yield {
          finishReason: "no-retrieval-evidence",
          metadata: {
            evidenceBundle,
            generator: "hybrid-query",
            mode: input.mode,
            ...(projectionSnapshotMetadata
              ? { projectionSnapshot: projectionSnapshotMetadata }
              : {}),
            ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
            ...(retrieval.plan ? { plan: retrieval.plan } : {}),
            ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
          },
          type: "done",
        };
        return;
      }

      // Top fused/rerank score (best-first) — surfaced for failed-query low-confidence triage.
      const topScore = retrieval.items[0]?.score;
      const answerStartedAt = Date.now();
      const citations = await Promise.all(
        retrieval.items.map((item) =>
          hybridItemCitation({
            item,
            knowledgeSpaceId: input.knowledgeSpaceId,
            multimodalCandidateResolver,
          }),
        ),
      );
      const multimodalEvidence = multimodalEvidenceFromCitations({
        citations,
        maxItems: maxMultimodalEvidenceItems,
      });
      const generatedAnswer =
        multimodalAnswerProvider && multimodalEvidence.length > 0
          ? await multimodalAnswerProvider.generate({
              evidence: retrieval.items.map((item) => ({
                citation: item.citation,
                nodeId: item.nodeId,
                text: evidenceTextFromHybridItem(item),
              })),
              multimodalEvidence,
              query: input.query,
              tenantId,
              traceId: input.traceId,
            })
          : undefined;
      const answer = truncateAnswer(
        generatedAnswer?.text.trim()
          ? generatedAnswer.text
          : hybridEvidenceAnswer({
              items: retrieval.items,
              multimodalEvidence,
            }),
        maxAnswerChars,
      );
      yield traceStepEvent("query.answer", answerStartedAt, "ok", {
        answerChars: answer.length,
        multimodal: Boolean(generatedAnswer),
        synthesis: generatedAnswer ? "multimodal-provider" : "extractive",
      });

      yield { delta: answer, type: "delta" };

      yield {
        finishReason: "retrieval-evidence",
        metadata: {
          citations,
          evidenceBundle,
          generator: "hybrid-query",
          mode: input.mode,
          ...(projectionSnapshotMetadata ? { projectionSnapshot: projectionSnapshotMetadata } : {}),
          ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
          ...(generatedAnswer
            ? {
                multimodalAnswer: {
                  metadata: generatedAnswer.metadata
                    ? cloneJsonObject(generatedAnswer.metadata)
                    : {},
                  provider: "configured",
                },
              }
            : {}),
          ...(multimodalEvidence.length > 0 ? { multimodalEvidence } : {}),
          ...(topScore !== undefined ? { topScore } : {}),
          ...(retrieval.plan ? { plan: retrieval.plan } : {}),
          ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
        },
        type: "done",
      };
    },
  };
}

async function embedQueryVector({
  model,
  provider,
  profile,
  query,
  tenantId,
}: {
  readonly model?: string | undefined;
  readonly provider?: EmbeddingProvider | undefined;
  readonly profile?: ResolvedKnowledgeSpaceEmbedding | null | undefined;
  readonly query: string;
  readonly tenantId?: string | undefined;
}): Promise<{
  readonly embeddingModel?: string | undefined;
  readonly vector: readonly number[];
  readonly vectorSpaceId?: string | undefined;
}> {
  if (!provider) {
    return { vector: [0] };
  }

  const result = await provider.embed({
    inputType: "search_query",
    model: model ?? "",
    texts: [query],
    ...(tenantId ? { tenantId } : {}),
  });
  if (result.dense.length === 0) {
    throw new Error("Hybrid query embedding provider returned no query vector");
  }
  if (result.dense.length !== 1) {
    throw new Error(
      `Hybrid query embedding provider returned ${result.dense.length} vectors for 1 query`,
    );
  }
  const vector = result.dense[0];

  if (!vector || vector.length === 0) {
    throw new Error("Hybrid query embedding provider returned no query vector");
  }

  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("Hybrid query embedding provider returned a non-finite query vector");
  }

  const resolvedModel = result.model.trim();

  if (!resolvedModel) {
    throw new Error("Hybrid query embedding provider returned an empty model");
  }

  if (result.metadata.dimension !== undefined && result.metadata.dimension !== vector.length) {
    throw new Error(
      `Hybrid query embedding provider reported dimension=${result.metadata.dimension}; query vector has dimension=${vector.length}`,
    );
  }

  if (profile) {
    assertEmbeddingModelMatchesProfile({ observedModel: resolvedModel, profile });
    assertObservedEmbeddingDimension({
      observedDimension: vector.length,
      profile,
    });
  }

  return {
    embeddingModel: resolvedModel,
    vector: [...vector],
    vectorSpaceId: profile?.vectorSpaceId ?? resolvedModel,
  };
}

function hybridEvidenceAnswer({
  items,
  multimodalEvidence,
}: {
  readonly items: readonly HybridRetrievalItem[];
  readonly multimodalEvidence: readonly ReturnType<
    typeof multimodalEvidenceFromCitations
  >[number][];
}): string {
  const lines = items.map((item, index) => {
    const section = item.citation.sectionPath.join(" / ") || "Document";
    return `${index + 1}. ${section}: ${evidenceTextFromHybridItem(item)}`;
  });
  const multimodalLines = multimodalEvidenceAnswerLines(multimodalEvidence);

  return `Retrieval evidence answer:\n${[...lines, ...multimodalLines].join("\n")}`;
}

export async function hybridItemCitation({
  item,
  knowledgeSpaceId,
  multimodalCandidateResolver,
}: {
  readonly item: HybridRetrievalItem;
  readonly knowledgeSpaceId: string;
  readonly multimodalCandidateResolver: DocumentMultimodalCandidateResolver | undefined;
}): Promise<Record<string, unknown>> {
  const multimodalCandidate = isPlainObject(item.metadata.multimodalCandidate)
    ? await resolveMultimodalCandidate({
        candidate: item.metadata.multimodalCandidate,
        knowledgeSpaceId,
        multimodalCandidateResolver,
      })
    : undefined;

  return {
    documentAssetId: item.citation.documentAssetId,
    label: `node:${item.nodeId}`,
    ...(multimodalCandidate ? { multimodalCandidate } : {}),
    nodeId: item.nodeId,
    pageNumber: item.citation.pageNumber,
    projectionIds: [...item.projectionIds],
    sectionPath: [...item.citation.sectionPath],
    sources: [...item.sources],
  };
}

async function resolveMultimodalCandidate({
  candidate,
  knowledgeSpaceId,
  multimodalCandidateResolver,
}: {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly knowledgeSpaceId: string;
  readonly multimodalCandidateResolver: DocumentMultimodalCandidateResolver | undefined;
}): Promise<Record<string, unknown>> {
  if (!multimodalCandidateResolver) {
    return cloneJsonObject(candidate);
  }

  return (
    (await multimodalCandidateResolver.resolve({
      candidate,
      knowledgeSpaceId,
    })) ?? cloneJsonObject(candidate)
  );
}

function truncateAnswer(answer: string, maxAnswerChars: number): string {
  const chars = Array.from(answer);

  return chars.length > maxAnswerChars ? chars.slice(0, maxAnswerChars).join("") : answer;
}

function validateHybridQueryGeneratorBounds({
  embeddingModel,
  embeddingResolver,
  embeddings,
  limit,
  maxAnswerChars,
  maxMultimodalEvidenceItems,
  topK,
}: {
  readonly embeddingModel?: string | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  readonly limit: number;
  readonly maxAnswerChars: number;
  readonly maxMultimodalEvidenceItems: number;
  readonly topK: number;
}): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Hybrid query generator limit must be at least 1");
  }

  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("Hybrid query generator topK must be at least 1");
  }

  if (!Number.isInteger(maxAnswerChars) || maxAnswerChars < 1) {
    throw new Error("Hybrid query generator maxAnswerChars must be at least 1");
  }

  if (!Number.isInteger(maxMultimodalEvidenceItems) || maxMultimodalEvidenceItems < 0) {
    throw new Error("Hybrid query generator maxMultimodalEvidenceItems must be non-negative");
  }

  if (embeddings && !embeddingModel?.trim() && !embeddingResolver) {
    throw new Error(
      "Hybrid query generator embeddingModel is required when embeddings are configured",
    );
  }
}
