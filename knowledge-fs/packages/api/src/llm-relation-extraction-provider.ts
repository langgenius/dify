import { z } from "zod";

import type { ConcurrencyGate } from "./bounded-concurrency";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import {
  RelationExtractionBatchContractError,
  type RelationExtractionProvider,
  type RelationExtractionProviderInput,
} from "./relation-extraction-flow";
import { semanticExtractionModelRequestGate } from "./semantic-extraction-concurrency";

export interface LlmRelationExtractionMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface GenerateRelationExtractionTextInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmRelationExtractionMessage[];
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface GenerateRelationExtractionTextResult {
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly model?: string | undefined;
  readonly text: string;
}

export interface RelationExtractionTextProvider {
  readonly kind?: string | undefined;
  generate(
    input: GenerateRelationExtractionTextInput,
  ): Promise<GenerateRelationExtractionTextResult>;
}

export interface LlmRelationExtractionProviderOptions {
  readonly maxOutputTokens?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly provider: RelationExtractionTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmRelationExtractionProvider({
  maxOutputTokens = 1_500,
  maxRetries = 2,
  modelRequestGate = semanticExtractionModelRequestGate,
  metrics,
  provider,
  temperature = 0,
}: LlmRelationExtractionProviderOptions): RelationExtractionProvider {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("LLM relation extraction maxRetries must be a non-negative integer");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM relation extraction maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM relation extraction temperature must be non-negative");
  }

  return {
    extract: async (input) => {
      let messages = relationExtractionMessages(input);
      let result: GenerateRelationExtractionTextResult | undefined;
      let parsed: LlmRelationExtractionOutput | undefined;
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
          parsed = parseLlmRelationExtractionJson(result.text);
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: 1,
            outcome: "succeeded",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-relation",
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
            stage: "graph-relation",
          });
          if (attempt >= maxRetries) {
            throw error;
          }
          if (result) {
            messages = relationExtractionCorrectionMessages(messages, result.text);
            result = undefined;
          } else if (!isRetryableModelError(error)) {
            throw error;
          }
        }
      }
      if (!result || !parsed) {
        throw new Error("LLM relation extraction format retry did not produce a result");
      }

      return {
        metadata: {
          ...(provider.kind ? { provider: provider.kind } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.model ? { generationModel: result.model } : {}),
        },
        relations: parsed.relations.map((relation) => ({
          confidence: relation.confidence,
          metadata: { source: "llm" },
          object: relation.object.trim(),
          subject: relation.subject.trim(),
          type: relation.type,
        })),
      };
    },
    extractBatch: async (inputs) => {
      if (inputs.length === 0) return [];
      let messages = relationExtractionBatchMessages(inputs);
      let result: GenerateRelationExtractionTextResult | undefined;
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
          const parsed = parseLlmRelationExtractionBatchJson(result.text, inputs);
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: inputs.length,
            outcome: "succeeded",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-relation",
            ...ingestionModelUsageFromMetadata(result.metadata),
          });
          return parsed.map((relations) => ({
            metadata: {
              batchSize: inputs.length,
              ...(provider.kind ? { provider: provider.kind } : {}),
              ...(result?.finishReason ? { finishReason: result.finishReason } : {}),
              ...(result?.model ? { generationModel: result.model } : {}),
            },
            relations,
          }));
        } catch (error) {
          recordIngestionModelCallMetric(metrics, {
            cacheHits: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            itemCount: inputs.length,
            outcome: "failed",
            providerCalls: 1,
            retries: attempt > 0 ? 1 : 0,
            stage: "graph-relation",
          });
          if (attempt >= maxRetries) {
            if (result) {
              throw new RelationExtractionBatchContractError(
                "LLM relation extraction batch returned invalid JSON",
                { cause: error },
              );
            }
            throw error;
          }
          if (result) {
            messages = relationExtractionCorrectionMessages(messages, result.text);
            result = undefined;
          } else if (!isRetryableModelError(error)) {
            throw error;
          }
        }
      }
      throw new RelationExtractionBatchContractError(
        "LLM relation extraction batch exhausted retries",
      );
    },
  };
}

function relationExtractionBatchMessages(
  inputs: readonly RelationExtractionProviderInput[],
): readonly LlmRelationExtractionMessage[] {
  return [
    {
      content: [
        "Extract high-signal knowledge graph relations from document chunks.",
        "Return strict JSON only with this shape:",
        '{"nodes":[{"nodeId":"node-id","relations":[{"subject":"Acme Corp","type":"references","object":"Renewal Policy","confidence":0.91}]}]}',
        "Return exactly one node object for every supplied nodeId and do not invent ids.",
        "Allowed relation types: mentions, defines, references, depends_on, supersedes, contradicts.",
      ].join("\n"),
      role: "system",
    },
    {
      content: JSON.stringify({
        nodes: inputs.map((input) => ({
          entities: input.entities,
          maxRelations: input.maxRelations,
          nodeId: input.node.id,
          prompt: input.prompt,
        })),
      }),
      role: "user",
    },
  ];
}

function relationExtractionMessages(
  input: RelationExtractionProviderInput,
): readonly LlmRelationExtractionMessage[] {
  return [
    {
      content: [
        "You extract high-signal knowledge graph relations from document chunks.",
        "Return strict JSON only, with this shape:",
        '{"relations":[{"subject":"Acme Corp","type":"references","object":"Renewal Policy","confidence":0.91}]}',
        "Allowed relation types: mentions, defines, references, depends_on, supersedes, contradicts.",
        "Only relate entities that are explicitly supported by the text.",
        "Do not create relations for bare numbers, dates, list ordinals, code identifiers, environment variables, or generic words.",
        "Use the exact entity names from the provided entity list whenever possible.",
        `Return at most ${input.maxRelations} relations.`,
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

function relationExtractionCorrectionMessages(
  messages: readonly LlmRelationExtractionMessage[],
  invalidText: string,
): readonly LlmRelationExtractionMessage[] {
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

function parseLlmRelationExtractionJson(text: string): LlmRelationExtractionOutput {
  try {
    const parsed = tryParseJsonObject(text);
    return LlmRelationExtractionOutputSchema.parse(parsed);
  } catch (error) {
    throw new Error("LLM relation extraction provider returned invalid relation JSON", {
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
      throw new Error("LLM relation extraction provider returned non-JSON output");
    }

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

const RelationTypeSchema = z.enum([
  "contradicts",
  "defines",
  "depends_on",
  "mentions",
  "references",
  "supersedes",
]);

const ExtractedRelationSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    object: z.string().min(1),
    subject: z.string().min(1),
    type: RelationTypeSchema,
  })
  .strict();

const LlmRelationExtractionOutputSchema = z
  .object({
    relations: z.array(ExtractedRelationSchema),
  })
  .strict();

const LlmRelationExtractionBatchOutputSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          nodeId: z.string().min(1),
          relations: z.array(ExtractedRelationSchema),
        })
        .strict(),
    ),
  })
  .strict();

type LlmRelationExtractionOutput = z.infer<typeof LlmRelationExtractionOutputSchema>;

function parseLlmRelationExtractionBatchJson(
  text: string,
  inputs: readonly RelationExtractionProviderInput[],
): Array<LlmRelationExtractionOutput["relations"]> {
  const parsed = LlmRelationExtractionBatchOutputSchema.parse(tryParseJsonObject(text));
  const expected = new Set(inputs.map((input) => input.node.id));
  const byNodeId = new Map<string, LlmRelationExtractionOutput["relations"]>();
  for (const node of parsed.nodes) {
    if (!expected.has(node.nodeId) || byNodeId.has(node.nodeId)) {
      throw new Error("LLM relation extraction batch returned an unexpected or duplicate node id");
    }
    byNodeId.set(node.nodeId, node.relations);
  }
  if (byNodeId.size !== inputs.length) {
    throw new Error("LLM relation extraction batch returned an incomplete node set");
  }
  return inputs.map((input) => byNodeId.get(input.node.id) ?? []);
}
