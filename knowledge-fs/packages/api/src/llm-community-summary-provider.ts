import { z } from "zod";
import type { ConcurrencyGate } from "./bounded-concurrency";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";

import type {
  SemanticCommunitySummaryInput,
  SemanticCommunitySummaryProvider,
} from "./semantic-community-materializer";

export interface LlmCommunitySummaryMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface GenerateCommunitySummaryTextInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmCommunitySummaryMessage[];
  readonly model: string;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface GenerateCommunitySummaryTextResult {
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly model?: string | undefined;
  readonly text: string;
}

export interface CommunitySummaryTextProvider {
  readonly kind?: string | undefined;
  generate(input: GenerateCommunitySummaryTextInput): Promise<GenerateCommunitySummaryTextResult>;
}

export interface LlmCommunitySummaryProviderOptions {
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly provider: CommunitySummaryTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmCommunitySummaryProvider({
  maxOutputTokens = 800,
  model,
  metrics,
  modelRequestGate,
  provider,
  temperature = 0,
}: LlmCommunitySummaryProviderOptions): SemanticCommunitySummaryProvider {
  if (!model.trim()) {
    throw new Error("LLM community summary model is required");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM community summary maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM community summary temperature must be non-negative");
  }

  return {
    summarize: async (input) => {
      const startedAt = Date.now();
      let result: GenerateCommunitySummaryTextResult;
      try {
        const generate = () =>
          provider.generate({
            maxOutputTokens,
            messages: communitySummaryMessages(input),
            model,
            temperature,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          });
        result = modelRequestGate ? await modelRequestGate.run(generate) : await generate();
        recordIngestionModelCallMetric(metrics, {
          cacheHits: 0,
          durationMs: Math.max(0, Date.now() - startedAt),
          itemCount: input.nodeTexts.length,
          outcome: "succeeded",
          providerCalls: 1,
          retries: 0,
          stage: "graph-community-summary",
          ...ingestionModelUsageFromMetadata(result.metadata),
        });
      } catch (error) {
        recordIngestionModelCallMetric(metrics, {
          cacheHits: 0,
          durationMs: Math.max(0, Date.now() - startedAt),
          itemCount: input.nodeTexts.length,
          outcome: "failed",
          providerCalls: 1,
          retries: 0,
          stage: "graph-community-summary",
        });
        throw error;
      }
      const parsed = parseLlmCommunitySummaryJson(result.text);

      return {
        metadata: {
          ...(provider.kind ? { provider: provider.kind } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.model ? { generationModel: result.model } : {}),
        },
        model: result.model ?? model,
        summary: parsed.summary.trim(),
        title: parsed.title.trim(),
      };
    },
  };
}

function communitySummaryMessages(
  input: SemanticCommunitySummaryInput,
): readonly LlmCommunitySummaryMessage[] {
  const entityList = input.entities.map((entity) => `${entity.type}:${entity.name}`).join(", ");
  const text = input.nodeTexts.join("\n\n").slice(0, 8_000);

  return [
    {
      content: [
        "You summarize a knowledge graph community for an admin knowledge browser.",
        "Return strict JSON only, with this shape:",
        '{"title":"Renewal Risk Controls","summary":"Documents in this community discuss renewal-risk controls, the owning teams, and the policies they reference."}',
        "The title must be human-readable, specific, and not a raw id or metric.",
        "The summary must be one concise sentence grounded only in the provided entities and source text.",
      ].join("\n"),
      role: "system",
    },
    {
      content: [
        `Knowledge space: ${input.knowledgeSpaceId}`,
        `Documents: ${input.documentAssetIds.join(", ")}`,
        `Entities: ${entityList || "none"}`,
        "Source text:",
        text || "No source text available.",
      ].join("\n"),
      role: "user",
    },
  ];
}

function parseLlmCommunitySummaryJson(text: string): LlmCommunitySummaryOutput {
  const parsed = tryParseJsonObject(text);

  try {
    return LlmCommunitySummaryOutputSchema.parse(parsed);
  } catch (error) {
    throw new Error("LLM community summary provider returned invalid summary JSON", {
      cause: error,
    });
  }
}

function tryParseJsonObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start < 0 || end <= start) {
      throw new Error("LLM community summary provider returned non-JSON output");
    }

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

const LlmCommunitySummaryOutputSchema = z
  .object({
    summary: z.string().min(1).max(1_000),
    title: z.string().min(1).max(120),
  })
  .strict();

type LlmCommunitySummaryOutput = z.infer<typeof LlmCommunitySummaryOutputSchema>;
