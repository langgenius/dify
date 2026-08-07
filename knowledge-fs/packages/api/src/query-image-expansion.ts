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

/** Adds one bounded vision expansion before Deep/Research; Fast remains model-call free. */
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
      if (images.length === 0 || input.mode === "fast") {
        yield* generator.stream(input);
        return;
      }

      const startedAt = Date.now();
      let expansion = input.queryImageExpansion?.trim();
      let degradationReason: string | undefined;
      if (!expansion && provider && input.retrievalProfile?.reasoningModel) {
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
          expansion = formatQueryImageExpansion(result);
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
          if (input.mode === "research" && !input.query.trim()) {
            throw new QueryImageExpansionUnavailableError(
              "Pure-image Research requires a vision-capable reasoning model",
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
        if (input.mode === "research" && !input.query.trim()) {
          throw new QueryImageExpansionUnavailableError(
            "Pure-image Research requires a configured vision expansion provider",
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

function formatQueryImageExpansion(result: QueryImageExpansionResult): string {
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
