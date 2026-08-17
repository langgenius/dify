import { z } from "zod";

import type { ConcurrencyGate } from "./bounded-concurrency";
import {
  EntityExtractionBatchContractError,
  type EntityExtractionProvider,
  type EntityExtractionProviderInput,
} from "./entity-extraction-flow";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { semanticExtractionModelRequestGate } from "./semantic-extraction-concurrency";

export interface LlmEntityExtractionMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface GenerateEntityExtractionTextInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmEntityExtractionMessage[];
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface GenerateEntityExtractionTextResult {
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly model?: string | undefined;
  readonly text: string;
}

export interface EntityExtractionTextProvider {
  readonly kind?: string | undefined;
  generate(input: GenerateEntityExtractionTextInput): Promise<GenerateEntityExtractionTextResult>;
}

export interface LlmEntityExtractionProviderOptions {
  readonly maxOutputTokens?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly provider: EntityExtractionTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmEntityExtractionProvider({
  maxOutputTokens = 1_500,
  maxRetries = 2,
  modelRequestGate = semanticExtractionModelRequestGate,
  metrics,
  provider,
  temperature = 0,
}: LlmEntityExtractionProviderOptions): EntityExtractionProvider {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("LLM entity extraction maxRetries must be a non-negative integer");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM entity extraction maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM entity extraction temperature must be non-negative");
  }

  return {
    extract: async (input) => {
      let messages = entityExtractionMessages(input);
      let result: GenerateEntityExtractionTextResult | undefined;
      let parsed: LlmEntityExtractionOutput | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const startedAt = Date.now();
        try {
          result = await modelRequestGate.run(() =>
            provider.generate({
              maxOutputTokens,
              messages,
              model: input.model,
              temperature,
              ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            }),
          );
          parsed = parseLlmEntityExtractionJson(result.text);
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: 1,
            outcome: "succeeded",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-entity",
            ...ingestionModelUsageFromMetadata(result.metadata),
          });
          break;
        } catch (error) {
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: 1,
            outcome: "failed",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-entity",
          });
          if (attempt >= maxRetries) {
            throw error;
          }
          if (result) {
            messages = entityExtractionCorrectionMessages(messages, result.text);
            result = undefined;
          } else if (!isRetryableModelError(error)) {
            throw error;
          }
        }
      }
      if (!result || !parsed) {
        throw new Error("LLM entity extraction format retry did not produce a result");
      }

      return {
        entities: parsed.entities.map((entity) => ({
          confidence: entity.confidence,
          metadata: {
            ...(entity.canonicalName ? { canonicalName: entity.canonicalName } : {}),
            ...(entity.aliases && entity.aliases.length > 0 ? { aliases: entity.aliases } : {}),
            source: "llm",
          },
          text: entity.text.trim(),
          type: entity.type,
        })),
        metadata: {
          ...(provider.kind ? { provider: provider.kind } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.model ? { generationModel: result.model } : {}),
          ...(isPlainObject(result.metadata) ? cloneJsonObject(result.metadata) : {}),
        },
      };
    },
    extractBatch: async (inputs) => {
      if (inputs.length === 0) return [];
      let messages = entityExtractionBatchMessages(inputs);
      let result: GenerateEntityExtractionTextResult | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const startedAt = Date.now();
        try {
          result = await modelRequestGate.run(() =>
            provider.generate({
              maxOutputTokens: Math.min(4_096, Math.max(maxOutputTokens, inputs.length * 384)),
              messages,
              model: inputs[0]?.model ?? "",
              temperature,
              ...(inputs[0]?.tenantId ? { tenantId: inputs[0].tenantId } : {}),
            }),
          );
          const parsed = parseLlmEntityExtractionBatchJson(result.text, inputs);
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: inputs.length,
            outcome: "succeeded",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-entity",
            ...ingestionModelUsageFromMetadata(result.metadata),
          });
          return parsed.map((entities) => ({
            entities,
            metadata: {
              batchSize: inputs.length,
              ...(provider.kind ? { provider: provider.kind } : {}),
              ...(result?.finishReason ? { finishReason: result.finishReason } : {}),
              ...(result?.model ? { generationModel: result.model } : {}),
              ...(isPlainObject(result?.metadata) ? cloneJsonObject(result.metadata) : {}),
            },
          }));
        } catch (error) {
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: inputs.length,
            outcome: "failed",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-entity",
          });
          if (attempt >= maxRetries) {
            if (result) {
              throw new EntityExtractionBatchContractError(
                "LLM entity extraction batch returned invalid JSON",
                { cause: error },
              );
            }
            throw error;
          }
          if (result) {
            messages = entityExtractionCorrectionMessages(messages, result.text);
            result = undefined;
          } else if (!isRetryableModelError(error)) {
            throw error;
          }
        }
      }
      throw new EntityExtractionBatchContractError("LLM entity extraction batch exhausted retries");
    },
  };
}

function entityExtractionBatchMessages(
  inputs: readonly EntityExtractionProviderInput[],
): readonly LlmEntityExtractionMessage[] {
  return [
    {
      content: [
        "Extract high-signal knowledge graph entities from document chunks.",
        "Return strict JSON only with this shape:",
        '{"nodes":[{"nodeId":"node-id","entities":[{"text":"Acme Corp","type":"organization","confidence":0.95,"canonicalName":"Acme Corp","aliases":["Acme"]}]}]}',
        "Return exactly one node object for every supplied nodeId and do not invent ids.",
        "Allowed entity types: date, metric, organization, person, policy, product, term.",
      ].join("\n"),
      role: "system",
    },
    {
      content: JSON.stringify({
        nodes: inputs.map((input) => ({
          maxEntities: input.maxEntities,
          nodeId: input.node.id,
          prompt: input.prompt,
        })),
      }),
      role: "user",
    },
  ];
}

function entityExtractionMessages(
  input: EntityExtractionProviderInput,
): readonly LlmEntityExtractionMessage[] {
  return [
    {
      content: [
        "You extract high-signal knowledge graph entities from document chunks.",
        "Return strict JSON only, with this shape:",
        '{"entities":[{"text":"Acme Corp","type":"organization","confidence":0.95,"canonicalName":"Acme Corp","aliases":["Acme"]}]}',
        "Allowed types: date, metric, organization, person, policy, product, term.",
        "Only include meaningful named entities, policies, products, domain terms, dates, or metrics that are explicitly supported by the text.",
        "Do not emit bare counters, list ordinals, UUID fragments, path segments, or generic words.",
        "Use canonicalName only when it improves graph grouping.",
        `Return at most ${input.maxEntities} entities.`,
      ].join("\n"),
      role: "system",
    },
    {
      content: input.prompt,
      role: "user",
    },
  ];
}

function isRetryableModelError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "retryable" in error && error.retryable === true
  );
}

function entityExtractionCorrectionMessages(
  messages: readonly LlmEntityExtractionMessage[],
  invalidText: string,
): readonly LlmEntityExtractionMessage[] {
  return [
    ...messages,
    { content: invalidText.slice(0, 8_000), role: "assistant" },
    {
      content:
        "The previous response is invalid JSON or does not match the required schema. Return a corrected complete JSON object only.",
      role: "user",
    },
  ];
}

function parseLlmEntityExtractionJson(text: string): LlmEntityExtractionOutput {
  try {
    const parsed = tryParseJsonObject(text);
    return LlmEntityExtractionOutputSchema.parse(parsed);
  } catch (error) {
    throw new Error("LLM entity extraction provider returned invalid entity JSON", {
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
      throw new Error("LLM entity extraction provider returned non-JSON output");
    }

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

const EntityTypeSchema = z.enum([
  "date",
  "metric",
  "organization",
  "person",
  "policy",
  "product",
  "term",
]);

const ExtractedEntitySchema = z
  .object({
    aliases: z.array(z.string().min(1)).max(12).optional(),
    canonicalName: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    text: z.string().min(1),
    type: EntityTypeSchema,
  })
  .strict();

const LlmEntityExtractionOutputSchema = z
  .object({
    entities: z.array(ExtractedEntitySchema),
  })
  .strict();

const LlmEntityExtractionBatchOutputSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          entities: z.array(ExtractedEntitySchema),
          nodeId: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

type LlmEntityExtractionOutput = z.infer<typeof LlmEntityExtractionOutputSchema>;

function parseLlmEntityExtractionBatchJson(
  text: string,
  inputs: readonly EntityExtractionProviderInput[],
): Array<LlmEntityExtractionOutput["entities"]> {
  const parsed = LlmEntityExtractionBatchOutputSchema.parse(tryParseJsonObject(text));
  const expected = new Set(inputs.map((input) => input.node.id));
  const byNodeId = new Map<string, LlmEntityExtractionOutput["entities"]>();
  for (const node of parsed.nodes) {
    if (!expected.has(node.nodeId) || byNodeId.has(node.nodeId)) {
      throw new Error("LLM entity extraction batch returned an unexpected or duplicate node id");
    }
    byNodeId.set(node.nodeId, node.entities);
  }
  if (byNodeId.size !== inputs.length) {
    throw new Error("LLM entity extraction batch returned an incomplete node set");
  }
  return inputs.map((input) => byNodeId.get(input.node.id) ?? []);
}
