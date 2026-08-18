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
import type { ResolvedQueryImage } from "./query-images";
import {
  estimateResearchModelPromptTokens,
  notifyResearchModelCallAfter,
  notifyResearchModelCallBefore,
} from "./research-model-usage";
import {
  ResearchEvidenceRetrievalCheckpointVersion,
  ResearchRetrievalCheckpointVersion,
  retrievalResultFromResearchCheckpoint,
  validateResearchRetrievalCheckpointScope,
  validateResearchRetrievalDurableCheckpoint,
} from "./research-retrieval-checkpoint";
import {
  DurableResearchEvidenceRetrievalPolicy,
  DurableResearchRetrievalPolicy,
  InteractiveResearchEvidenceRetrievalPolicy,
  InteractiveResearchRetrievalPolicy,
} from "./research-retrieval-policy";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type { BasicHybridRetriever, HybridRetrievalResult } from "./retrieval-types";

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
  readonly queryImages?: readonly ResolvedQueryImage[] | undefined;
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
      const retrievalQuery = input.retrievalQuery?.trim() || input.query.trim();
      const retrievalProfileMetadata = queryRetrievalProfileMetadata(input.retrievalProfile);
      const projectionSnapshotMetadata = queryProjectionSnapshotMetadata(input.projectionSnapshot);
      const retrieveStartedAt = Date.now();
      const retrievalTopK = input.topK ?? input.retrievalProfile?.topK ?? topK;
      const restoredCheckpoint = input.researchRetrievalCheckpoint
        ? validateResearchRetrievalCheckpointScope({
            checkpoint: input.researchRetrievalCheckpoint,
            query: input.query,
            traceId: input.traceId,
          })
        : undefined;
      const restoredDurableCheckpoint = input.researchDurableCheckpoint
        ? validateResearchRetrievalDurableCheckpoint(input.researchDurableCheckpoint)
        : undefined;
      if (restoredCheckpoint && restoredDurableCheckpoint) {
        throw new Error("Research query cannot restore legacy and durable checkpoints together");
      }
      let checkpointWritten = false;
      let evidenceBundle = restoredCheckpoint;
      let retrieval: HybridRetrievalResult;
      if (restoredCheckpoint) {
        retrieval = retrievalResultFromResearchCheckpoint(restoredCheckpoint);
      } else {
        const embedStartedAt = Date.now();
        const resolvedEmbedding =
          retrievalQuery && embeddingResolver
            ? await embeddingResolver.resolve({
                ...(input.embeddingProfile ? { profile: input.embeddingProfile } : {}),
                knowledgeSpaceId: input.knowledgeSpaceId,
                tenantId,
              })
            : null;
        const queryEmbedding = retrievalQuery
          ? await embedQueryVector({
              model: resolvedEmbedding?.model ?? effectiveEmbeddingModel,
              profile: resolvedEmbedding,
              provider: resolvedEmbedding?.providerInstance ?? effectiveEmbeddingProvider,
              query: retrievalQuery,
              tenantId,
            })
          : { vector: [] as readonly number[] };
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
        if (resolvedEmbedding || effectiveEmbeddingProvider) {
          yield traceStepEvent("query.embed", embedStartedAt, "ok", {
            ...(queryEmbedding.embeddingModel ? { model: queryEmbedding.embeddingModel } : {}),
            dimension: queryEmbedding.vector.length,
            ...(queryEmbedding.vectorSpaceId
              ? { vectorSpaceId: queryEmbedding.vectorSpaceId }
              : {}),
          });
        }
        retrieval = await retriever.retrieve({
          ...(queryEmbedding.vectorSpaceId
            ? { denseProjectionModel: queryEmbedding.vectorSpaceId }
            : {}),
          ...(input.embeddingProfile ? { embeddingProfile: input.embeddingProfile } : {}),
          knowledgeSpaceId: input.knowledgeSpaceId,
          limit: input.topK !== undefined || input.retrievalProfile ? retrievalTopK : limit,
          mode: input.mode,
          ...(input.onResearchRetrievalCheckpoint
            ? {
                onResearchRound: async (checkpoint) => {
                  const bundle = evidenceBundleAssembler.assemble({
                    query: input.query,
                    ...(input.queryImageMetadata?.length
                      ? { queryImages: input.queryImageMetadata }
                      : {}),
                    ...(retrievalQuery ? { retrievalQuery } : {}),
                    retrieval: checkpoint.result,
                    ...(checkpoint.terminal ? {} : { state: "partial" as const }),
                    traceId: input.traceId,
                  });
                  await input.onResearchRetrievalCheckpoint?.(bundle);
                  checkpointWritten = checkpoint.terminal;
                },
              }
            : {}),
          ...(input.onResearchDurableCheckpoint
            ? {
                onResearchSearchCheckpoint: async (boundary) => {
                  const bundle = evidenceBundleAssembler.assemble({
                    query: input.query,
                    ...(input.queryImageMetadata?.length
                      ? { queryImages: input.queryImageMetadata }
                      : {}),
                    ...(retrievalQuery ? { retrievalQuery } : {}),
                    retrieval: boundary.result,
                    ...(boundary.checkpoint.phase === "complete"
                      ? {}
                      : { state: "partial" as const }),
                    traceId: input.traceId,
                  });
                  await input.onResearchDurableCheckpoint?.({
                    evidenceBundle: bundle,
                    searchState: boundary.checkpoint,
                  });
                },
              }
            : {}),
          permissionScope: input.permissionScope,
          ...(input.projectionSnapshot ? { projectionSnapshot: input.projectionSnapshot } : {}),
          query: retrievalQuery,
          ...(input.resolvedQueryImages?.length ? { queryImages: input.resolvedQueryImages } : {}),
          queryVector: queryEmbedding.vector,
          ...(input.requestedMode ? { requestedMode: input.requestedMode } : {}),
          ...(input.researchModelCallObserver
            ? { researchModelCallObserver: input.researchModelCallObserver }
            : {}),
          ...(input.mode === "research"
            ? {
                researchExecutionPolicy:
                  restoredDurableCheckpoint?.searchState.version ===
                  ResearchRetrievalCheckpointVersion
                    ? input.researchExecutionKind === "durable"
                      ? DurableResearchRetrievalPolicy
                      : InteractiveResearchRetrievalPolicy
                    : input.researchExecutionKind === "durable" ||
                        restoredDurableCheckpoint?.searchState.version ===
                          ResearchEvidenceRetrievalCheckpointVersion
                      ? DurableResearchEvidenceRetrievalPolicy
                      : InteractiveResearchEvidenceRetrievalPolicy,
              }
            : {}),
          ...(restoredDurableCheckpoint
            ? {
                researchSearchCheckpoint: restoredDurableCheckpoint.searchState,
                researchSearchCheckpointResult: retrievalResultFromResearchCheckpoint(
                  restoredDurableCheckpoint.evidenceBundle,
                ),
              }
            : {}),
          ...(input.retrievalProfile ? { retrievalProfile: input.retrievalProfile } : {}),
          tenantId,
          topK: retrievalTopK,
          traceId: input.traceId,
        });
      }
      yield traceStepEvent("query.retrieve", retrieveStartedAt, "ok", {
        ...(restoredCheckpoint || restoredDurableCheckpoint ? { checkpointed: true } : {}),
        itemCount: retrieval.items.length,
        ...(projectionSnapshotMetadata ? { projectionSnapshot: projectionSnapshotMetadata } : {}),
        ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
        ...(retrieval.plan ? { plan: retrieval.plan } : {}),
        ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
      });
      evidenceBundle ??= evidenceBundleAssembler.assemble({
        query: input.query,
        ...(input.queryImageMetadata?.length ? { queryImages: input.queryImageMetadata } : {}),
        ...(retrievalQuery ? { retrievalQuery } : {}),
        retrieval,
        traceId: input.traceId,
      });
      if (!restoredCheckpoint && !checkpointWritten) {
        await input.onResearchRetrievalCheckpoint?.(evidenceBundle);
      }

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
      let generatedAnswer: MultimodalAnswerProviderResult | undefined;
      if (
        multimodalAnswerProvider &&
        (multimodalEvidence.length > 0 || (input.resolvedQueryImages?.length ?? 0) > 0)
      ) {
        const modelCall = {
          callId: `query-answer:${input.traceId}:${input.researchExecutionAttempt ?? 0}:multimodal-extractive`,
          estimatedPromptTokens: estimateResearchModelPromptTokens({
            evidence: retrieval.items.map((item) => evidenceTextFromHybridItem(item)),
            query: input.query || retrievalQuery,
          }),
          maxOutputTokens: 1_024,
          model: "configured-multimodal-provider",
          provider: "configured-multimodal-provider",
          step: "query.answer" as const,
        };
        await notifyResearchModelCallBefore(input.researchModelCallObserver, modelCall);
        try {
          generatedAnswer = await multimodalAnswerProvider.generate({
            evidence: retrieval.items.map((item) => ({
              citation: item.citation,
              nodeId: item.nodeId,
              text: evidenceTextFromHybridItem(item),
            })),
            multimodalEvidence,
            query: input.query || retrievalQuery,
            ...(input.resolvedQueryImages?.length
              ? { queryImages: input.resolvedQueryImages }
              : {}),
            tenantId,
            traceId: input.traceId,
          });
        } catch (error) {
          await notifyResearchModelCallAfter(input.researchModelCallObserver, {
            ...modelCall,
            status: "failed",
          });
          throw error;
        }
        await notifyResearchModelCallAfter(input.researchModelCallObserver, {
          ...modelCall,
          ...(generatedAnswer.metadata === undefined ? {} : { metadata: generatedAnswer.metadata }),
          status: "succeeded",
        });
      }
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
    assertEmbeddingModelMatchesProfile({
      observedModel: resolvedModel,
      profile,
    });
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
