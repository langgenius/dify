import type { KnowledgeSpaceModelSelection } from "@knowledge/core";

import {
  type QueryGenerationEvent,
  type QueryGenerator,
  traceStepEvent,
} from "./gateway-sse-responses";
import {
  QUERY_IMAGE_EXPANSION_TIMEOUT,
  QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
  type ResolvedQueryImage,
} from "./query-images";
import {
  ResearchModelCallObserverError,
  estimateResearchModelPromptTokens,
  notifyResearchModelCallAfter,
  notifyResearchModelCallBefore,
} from "./research-model-usage";

export interface QueryImageExpansionInput {
  readonly images: readonly ResolvedQueryImage[];
  readonly model: KnowledgeSpaceModelSelection;
  readonly query: string;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface QueryImageExpansionResult {
  readonly description: string;
  readonly keywords: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly ocrText: string;
}

export interface QueryImageExpansionProvider {
  expand(input: QueryImageExpansionInput): Promise<QueryImageExpansionResult>;
}

export class QueryImageExpansionUnavailableError extends Error {
  readonly code = "QUERY_IMAGE_EXPANSION_UNAVAILABLE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QueryImageExpansionUnavailableError";
  }
}

/** Adds one bounded vision expansion before Deep/Research and for image-only Fast fallback. */
export function createQueryImageAwareQueryGenerator({
  generator,
  provider,
}: {
  readonly generator: QueryGenerator;
  readonly provider?: QueryImageExpansionProvider | undefined;
}): QueryGenerator {
  return {
    stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
      const images = input.resolvedQueryImages ?? [];
      const requestedImageCount = input.queryImages?.length ?? images.length;
      if (requestedImageCount === 0) {
        yield* generator.stream(input);
        return;
      }
      if (images.length === 0) {
        if (
          input.embeddingInputModalities?.includes("image") ||
          input.reasoningInputModalities?.includes("image")
        ) {
          throw new QueryImageExpansionUnavailableError(
            "Query image bytes are unavailable for a vision-capable knowledge space",
          );
        }
        if (!input.query.trim()) {
          throw new QueryImageExpansionUnavailableError(
            "Pure-image retrieval requires a vision-capable embedding or reasoning model",
          );
        }
        const startedAt = Date.now();
        yield traceStepEvent("query.image-expand", startedAt, "skipped", {
          degradationReason: QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
          imageCount: requestedImageCount,
        });
        yield* withQueryImageDegradation(
          generator.stream(input),
          QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
        );
        return;
      }
      const fastCanRetrieveDirectly =
        input.mode === "fast" && input.embeddingInputModalities?.includes("image");
      if (fastCanRetrieveDirectly) {
        yield* generator.stream(input);
        return;
      }
      const canExpand = Boolean(
        input.queryImageExpansion?.trim() ||
          (provider &&
            input.retrievalProfile?.reasoningModel &&
            input.reasoningInputModalities?.includes("image")),
      );
      if (input.embeddingInputModalities?.includes("image") && !canExpand) {
        yield* generator.stream(input);
        return;
      }

      const startedAt = Date.now();
      let expansion = input.queryImageExpansion?.trim();
      let degradationReason: string | undefined;
      if (!expansion && provider && input.retrievalProfile?.reasoningModel && canExpand) {
        const model = input.retrievalProfile.reasoningModel;
        const modelCall = {
          callId: `query-image-expand:${input.traceId}:${input.researchExecutionAttempt ?? 0}`,
          estimatedPromptTokens:
            estimateResearchModelPromptTokens({
              imageCount: images.length,
              query: input.query,
            }) +
            images.length * 1_024,
          maxOutputTokens: 512,
          model: model.model,
          provider: model.provider,
          step: "query.image-expand" as const,
        };
        try {
          await notifyResearchModelCallBefore(input.researchModelCallObserver, modelCall);
          let result: QueryImageExpansionResult;
          try {
            result = await provider.expand({
              images,
              model,
              query: input.query,
              ...(input.signal ? { signal: input.signal } : {}),
              tenantId: input.subject.tenantId,
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
            ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
            status: "succeeded",
          });
          expansion = formatQueryImageExpansionResult(result);
          if (!expansion) {
            throw new QueryImageExpansionUnavailableError(
              "Query image expansion returned no usable text",
            );
          }
          await input.onQueryImageExpansion?.(expansion);
          yield traceStepEvent("query.image-expand", startedAt, "ok", {
            imageCount: images.length,
            ...(result.metadata ? { providerMetadata: result.metadata } : {}),
          });
        } catch (error) {
          if (error instanceof ResearchModelCallObserverError) throw error;
          input.signal?.throwIfAborted();
          if (!input.query.trim() && !input.embeddingInputModalities?.includes("image")) {
            throw new QueryImageExpansionUnavailableError(
              "Pure-image retrieval requires a vision-capable embedding or reasoning model",
              { cause: error },
            );
          }
          degradationReason =
            error instanceof QueryImageExpansionTimeoutError
              ? QUERY_IMAGE_EXPANSION_TIMEOUT
              : QUERY_IMAGE_IGNORED_NO_VISION_MODEL;
          yield traceStepEvent("query.image-expand", startedAt, "error", {
            degradationReason,
            errorClass: error instanceof Error ? error.name : typeof error,
            imageCount: images.length,
          });
        }
      } else if (!expansion) {
        if (!input.query.trim() && !input.embeddingInputModalities?.includes("image")) {
          throw new QueryImageExpansionUnavailableError(
            "Pure-image retrieval requires a vision-capable embedding or reasoning model",
          );
        }
        degradationReason = QUERY_IMAGE_IGNORED_NO_VISION_MODEL;
        yield traceStepEvent("query.image-expand", startedAt, "skipped", {
          degradationReason,
          imageCount: images.length,
        });
      } else {
        yield traceStepEvent("query.image-expand", startedAt, "ok", {
          checkpointed: true,
          imageCount: images.length,
        });
      }

      const retrievalQuery = [input.query.trim(), expansion].filter(Boolean).join("\n\n");
      yield* withQueryImageDegradation(
        generator.stream({
          ...input,
          ...(expansion ? { queryImageExpansion: expansion } : {}),
          ...(retrievalQuery ? { retrievalQuery } : {}),
        }),
        degradationReason,
      );
    },
  };
}

async function* withQueryImageDegradation(
  events: AsyncIterable<QueryGenerationEvent>,
  reason: string | undefined,
): AsyncGenerator<QueryGenerationEvent> {
  for await (const event of events) {
    if (!reason || event.type !== "done") {
      yield event;
      continue;
    }
    const existing = Array.isArray(event.metadata?.queryImageDegradationReasons)
      ? event.metadata.queryImageDegradationReasons.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    yield {
      ...event,
      metadata: {
        ...(event.metadata ?? {}),
        queryImageDegradationReasons: [...new Set([...existing, reason])],
      },
    };
  }
}

export class QueryImageExpansionTimeoutError extends Error {
  constructor(message = "Query image expansion timed out", options?: ErrorOptions) {
    super(message, options);
    this.name = "QueryImageExpansionTimeoutError";
  }
}

/** Canonical bounded text projection shared by query-stream and retrieval-test execution. */
export function formatQueryImageExpansionResult(result: QueryImageExpansionResult): string {
  const description = result.description.trim();
  const ocrText = result.ocrText.trim();
  const keywords = [...new Set(result.keywords.map((keyword) => keyword.trim()).filter(Boolean))]
    .slice(0, 32)
    .join(", ");
  return [
    description ? `Image description: ${description}` : "",
    ocrText ? `Image OCR: ${ocrText}` : "",
    keywords ? `Image keywords: ${keywords}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
