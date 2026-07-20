import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
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
import { type MultimodalAnswerProvider, hybridItemCitation } from "./hybrid-query-generator";
import { cloneJsonObject } from "./json-utils";
import {
  type KnowledgeSpaceEmbeddingResolver,
  type ResolvedKnowledgeSpaceEmbedding,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import {
  multimodalEvidenceAnswerLines,
  multimodalEvidenceFromCitations,
} from "./multimodal-evidence";
import { ReasoningCapabilityUnavailableError } from "./profile-aware-query-generator";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type { BasicHybridRetriever } from "./retrieval-types";

/**
 * Structural LLM provider contract. Mirrors `@knowledge/generation`'s `LlmProvider`
 * without importing it, so `@knowledge/api` keeps no dependency on the generation
 * package. The concrete provider is injected by `apps/api`.
 */
export interface LlmAnswerMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface GenerateAnswerStreamInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmAnswerMessage[];
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface LlmAnswerStreamEvent {
  readonly delta?: string | undefined;
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly type: "delta" | "done";
}

export interface LlmAnswerProvider {
  readonly kind?: string | undefined;
  stream(input: GenerateAnswerStreamInput): AsyncIterable<LlmAnswerStreamEvent>;
}

export interface LlmAnswerQueryGeneratorOptions {
  readonly embeddingModel?: string | undefined;
  /** Resolves the active tenant + knowledge-space embedding profile at request time. */
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  readonly limit: number;
  readonly maxAnswerChars: number;
  readonly maxEvidenceCharsPerItem?: number | undefined;
  readonly maxMultimodalEvidenceItems?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  /** Deployment-level model for legacy spaces without a retrieval profile. */
  readonly model?: string | undefined;
  /** Optional VLM answer provider; used when the retrieval has multimodal evidence. */
  readonly multimodalAnswerProvider?: MultimodalAnswerProvider | undefined;
  /** Optional resolver that enriches multimodal citations with manifest/asset/page/bbox. */
  readonly multimodalCandidateResolver?: DocumentMultimodalCandidateResolver | undefined;
  /** Deployment-level provider for legacy spaces without a retrieval profile. */
  readonly provider?: LlmAnswerProvider | undefined;
  readonly reasoningProviderFactory?:
    | ((selection: KnowledgeSpaceModelSelection) => LlmAnswerProvider)
    | undefined;
  readonly retriever: BasicHybridRetriever;
  readonly temperature?: number | undefined;
  readonly topK: number;
}

const DEFAULT_MAX_EVIDENCE_CHARS_PER_ITEM = 2_000;

const ANSWER_SYSTEM_PROMPT =
  "You are KnowledgeFS, a retrieval-grounded assistant. Answer the question using ONLY the " +
  "numbered evidence provided. Cite supporting evidence inline as [n], matching the evidence " +
  "numbers. If the evidence is insufficient, say you do not have enough information. Be concise " +
  "and factual.";

export function createLlmAnswerQueryGenerator({
  embeddingModel,
  embeddingResolver,
  embeddings,
  limit,
  maxAnswerChars,
  maxEvidenceCharsPerItem = DEFAULT_MAX_EVIDENCE_CHARS_PER_ITEM,
  maxMultimodalEvidenceItems = 20,
  maxOutputTokens,
  model,
  multimodalAnswerProvider,
  multimodalCandidateResolver,
  provider,
  reasoningProviderFactory,
  retriever,
  temperature,
  topK,
}: LlmAnswerQueryGeneratorOptions): QueryGenerator {
  if (embeddings && !embeddingModel?.trim() && !embeddingResolver) {
    throw new Error(
      "LLM answer query generator embeddingModel is required when embeddings are configured",
    );
  }

  if (model !== undefined && model.trim().length === 0) {
    throw new Error("LLM answer query generator model is required");
  }

  if ((model === undefined) !== (provider === undefined)) {
    throw new Error(
      "LLM answer query generator legacy model and provider must be configured together",
    );
  }

  if (!provider && !reasoningProviderFactory) {
    throw new ReasoningCapabilityUnavailableError(
      "LLM answer query generator requires a legacy provider or dynamic reasoning capability",
    );
  }

  validateLlmAnswerQueryGeneratorBounds({ limit, maxAnswerChars, maxEvidenceCharsPerItem, topK });
  const evidenceBundleAssembler = createEvidenceBundleAssembler();

  return {
    stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
      const tenantId = input.subject.tenantId;
      const retrievalProfileMetadata = queryRetrievalProfileMetadata(input.retrievalProfile);
      const projectionSnapshotMetadata = queryProjectionSnapshotMetadata(input.projectionSnapshot);
      const reasoningSelection = input.retrievalProfile?.reasoningModel;
      const { answerModel, answerProvider } = resolveAnswerCapability({
        model,
        provider,
        reasoningProviderFactory,
        reasoningSelection,
      });
      const embedStartedAt = Date.now();
      // Research opens the published PageIndex directly and must remain
      // independent from dense embedding availability.
      const requiresQueryEmbedding = input.mode !== "research";
      const resolvedEmbedding =
        requiresQueryEmbedding && embeddingResolver
          ? await embeddingResolver.resolve({
              ...(input.embeddingProfile ? { profile: input.embeddingProfile } : {}),
              knowledgeSpaceId: input.knowledgeSpaceId,
              tenantId,
            })
          : null;
      const effectiveProvider = resolvedEmbedding?.providerInstance ?? embeddings;
      const queryEmbedding: {
        readonly embeddingModel?: string | undefined;
        readonly vector: readonly number[];
        readonly vectorSpaceId?: string | undefined;
      } =
        requiresQueryEmbedding && effectiveProvider
          ? await embedLlmAnswerQuery({
              model: resolvedEmbedding?.model ?? embeddingModel ?? "",
              profile: resolvedEmbedding,
              provider: effectiveProvider,
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

      if (requiresQueryEmbedding && effectiveProvider) {
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
            generator: "llm-answer",
            mode: input.mode,
            model: answerModel,
            ...(projectionSnapshotMetadata
              ? { projectionSnapshot: projectionSnapshotMetadata }
              : {}),
            ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
            ...(answerProvider.kind ? { provider: answerProvider.kind } : {}),
            ...(retrieval.plan ? { plan: retrieval.plan } : {}),
            ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
          },
          type: "done",
        };
        return;
      }

      // Top fused/rerank score (items are ordered best-first) — surfaced for failed-query
      // low-confidence triage.
      const topScore = retrieval.items[0]?.score;

      // Resolve citations (enriches multimodal candidates with manifest/asset/page/bbox when a
      // resolver is configured) and derive multimodal evidence attachments from them.
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

      // Prefer the VLM answer provider when there is multimodal evidence; on any failure, fall back
      // to the text LLM below (which still receives the visual OCR/caption evidence in its prompt).
      let multimodalAnswerFailure: string | undefined;
      const answerStartedAt = Date.now();
      if (multimodalAnswerProvider && multimodalEvidence.length > 0) {
        try {
          const generated = await multimodalAnswerProvider.generate({
            evidence: retrieval.items.map((item) => ({
              citation: item.citation,
              nodeId: item.nodeId,
              text: evidenceTextFromHybridItem(item),
            })),
            multimodalEvidence,
            query: input.query,
            ...(tenantId ? { tenantId } : {}),
            ...(input.traceId ? { traceId: input.traceId } : {}),
          });

          if (generated.text.trim()) {
            const answer = truncate(generated.text, maxAnswerChars);
            yield traceStepEvent("query.answer", answerStartedAt, "ok", {
              answerChars: answer.length,
              synthesis: "multimodal-provider",
            });
            yield { delta: answer, type: "delta" };
            yield {
              finishReason: "retrieval-evidence",
              metadata: {
                citations,
                evidenceBundle,
                generator: "llm-answer",
                mode: input.mode,
                model: answerModel,
                ...(projectionSnapshotMetadata
                  ? { projectionSnapshot: projectionSnapshotMetadata }
                  : {}),
                ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
                multimodalAnswer: {
                  metadata: generated.metadata ? cloneJsonObject(generated.metadata) : {},
                  provider: "configured",
                },
                multimodalEvidence,
                ...(answerProvider.kind ? { provider: answerProvider.kind } : {}),
                ...(topScore !== undefined ? { topScore } : {}),
                ...(retrieval.plan ? { plan: retrieval.plan } : {}),
                ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
              },
              type: "done",
            };
            return;
          }

          multimodalAnswerFailure = "empty-multimodal-answer";
        } catch (error) {
          multimodalAnswerFailure =
            error instanceof Error ? error.message : "multimodal-answer-failed";
        }

        if (multimodalAnswerFailure) {
          // The failed VLM attempt is a real stage; the text LLM below is the fallback.
          yield traceStepEvent("query.answer", answerStartedAt, "error", {
            error: multimodalAnswerFailure,
            synthesis: "multimodal-provider",
          });
        }
      }

      const evidenceSection = [
        evidencePrompt(retrieval.items, maxEvidenceCharsPerItem),
        ...multimodalEvidenceAnswerLines(multimodalEvidence),
      ].join("\n");
      const messages: readonly LlmAnswerMessage[] = [
        { content: ANSWER_SYSTEM_PROMPT, role: "system" },
        { content: `Question: ${input.query}\n\nEvidence:\n${evidenceSection}`, role: "user" },
      ];

      let emittedChars = 0;
      let providerFinishReason: string | undefined;
      let providerMetadata: unknown;
      const llmStartedAt = Date.now();

      for await (const event of answerProvider.stream({
        messages,
        model: answerModel,
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(temperature === undefined ? {} : { temperature }),
        ...(tenantId ? { tenantId } : {}),
      })) {
        if (event.type === "delta" && event.delta) {
          const remaining = maxAnswerChars - emittedChars;
          if (remaining <= 0) {
            continue;
          }
          const chars = Array.from(event.delta);
          const slice = chars.length > remaining ? chars.slice(0, remaining).join("") : event.delta;
          if (slice) {
            emittedChars += Array.from(slice).length;
            yield { delta: slice, type: "delta" };
          }
          continue;
        }

        if (event.type === "done") {
          providerFinishReason = event.finishReason;
          providerMetadata = event.metadata;
        }
      }

      yield traceStepEvent("query.answer", llmStartedAt, "ok", {
        answerChars: emittedChars,
        model: answerModel,
        synthesis: "llm",
        ...(answerProvider.kind ? { provider: answerProvider.kind } : {}),
        ...(providerFinishReason ? { providerFinishReason } : {}),
      });

      yield {
        finishReason: "retrieval-evidence",
        metadata: {
          citations,
          evidenceBundle,
          generator: "llm-answer",
          mode: input.mode,
          model: answerModel,
          ...(projectionSnapshotMetadata ? { projectionSnapshot: projectionSnapshotMetadata } : {}),
          ...(retrievalProfileMetadata ? { retrievalProfile: retrievalProfileMetadata } : {}),
          ...(multimodalAnswerFailure ? { multimodalAnswerFailure } : {}),
          ...(multimodalEvidence.length > 0 ? { multimodalEvidence } : {}),
          ...(answerProvider.kind ? { provider: answerProvider.kind } : {}),
          ...(providerFinishReason ? { providerFinishReason } : {}),
          ...(providerMetadata === undefined ? {} : { providerMetadata }),
          ...(topScore !== undefined ? { topScore } : {}),
          ...(retrieval.plan ? { plan: retrieval.plan } : {}),
          ...(retrieval.metrics ? { metrics: retrieval.metrics } : {}),
        },
        type: "done",
      };
    },
  };
}

function resolveAnswerCapability({
  model,
  provider,
  reasoningProviderFactory,
  reasoningSelection,
}: {
  readonly model?: string | undefined;
  readonly provider?: LlmAnswerProvider | undefined;
  readonly reasoningProviderFactory?:
    | ((selection: KnowledgeSpaceModelSelection) => LlmAnswerProvider)
    | undefined;
  readonly reasoningSelection?: KnowledgeSpaceModelSelection | undefined;
}): { readonly answerModel: string; readonly answerProvider: LlmAnswerProvider } {
  if (reasoningSelection) {
    if (!reasoningProviderFactory) {
      throw new ReasoningCapabilityUnavailableError(
        "Knowledge-space reasoning model is configured, but dynamic reasoning is unavailable",
      );
    }

    return {
      answerModel: reasoningSelection.model,
      answerProvider: reasoningProviderFactory(reasoningSelection),
    };
  }

  if (!model || !provider) {
    throw new ReasoningCapabilityUnavailableError(
      "Legacy LLM answer generation is unavailable for a knowledge space without a retrieval profile",
    );
  }

  return { answerModel: model, answerProvider: provider };
}

async function embedLlmAnswerQuery({
  model,
  profile,
  provider,
  query,
  tenantId,
}: {
  readonly model: string;
  readonly profile?: ResolvedKnowledgeSpaceEmbedding | null | undefined;
  readonly provider: EmbeddingProvider;
  readonly query: string;
  readonly tenantId?: string | undefined;
}): Promise<{
  readonly embeddingModel: string;
  readonly vector: readonly number[];
  readonly vectorSpaceId: string;
}> {
  const result = await provider.embed({
    inputType: "search_query",
    model,
    texts: [query],
    ...(tenantId ? { tenantId } : {}),
  });

  if (result.dense.length === 0) {
    throw new Error("LLM answer query embedding provider returned no query vector");
  }

  if (result.dense.length !== 1) {
    throw new Error(
      `LLM answer query embedding provider returned ${result.dense.length} vectors for 1 query`,
    );
  }

  const vector = result.dense[0];

  if (!vector || vector.length === 0) {
    throw new Error("LLM answer query embedding provider returned no query vector");
  }

  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("LLM answer query embedding provider returned a non-finite query vector");
  }

  const resolvedModel = result.model.trim();

  if (!resolvedModel) {
    throw new Error("LLM answer query embedding provider returned an empty model");
  }

  if (result.metadata.dimension !== undefined && result.metadata.dimension !== vector.length) {
    throw new Error(
      `LLM answer query embedding provider reported dimension=${result.metadata.dimension}; query vector has dimension=${vector.length}`,
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

function evidencePrompt(items: readonly HybridRetrievalItem[], maxCharsPerItem: number): string {
  return items
    .map((item, index) => {
      const section = item.citation.sectionPath.join(" / ") || "Document";
      return `${index + 1}. ${section}: ${truncate(evidenceTextFromHybridItem(item), maxCharsPerItem)}`;
    })
    .join("\n");
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);

  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : text;
}

function validateLlmAnswerQueryGeneratorBounds({
  limit,
  maxAnswerChars,
  maxEvidenceCharsPerItem,
  topK,
}: Pick<LlmAnswerQueryGeneratorOptions, "limit" | "maxAnswerChars" | "topK"> & {
  readonly maxEvidenceCharsPerItem: number;
}): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("LLM answer query generator limit must be at least 1");
  }

  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("LLM answer query generator topK must be at least 1");
  }

  if (!Number.isInteger(maxAnswerChars) || maxAnswerChars < 1) {
    throw new Error("LLM answer query generator maxAnswerChars must be at least 1");
  }

  if (!Number.isInteger(maxEvidenceCharsPerItem) || maxEvidenceCharsPerItem < 1) {
    throw new Error("LLM answer query generator maxEvidenceCharsPerItem must be at least 1");
  }
}
