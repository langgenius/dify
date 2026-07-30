import { z } from "zod";

import type {
  RelationExtractionProvider,
  RelationExtractionProviderInput,
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
  readonly provider: RelationExtractionTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmRelationExtractionProvider({
  maxOutputTokens = 1_500,
  maxRetries = 2,
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
        try {
          result = await semanticExtractionModelRequestGate.run(() =>
            provider.generate({
              maxOutputTokens,
              messages,
              model: input.model,
              temperature,
              ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            }),
          );
          parsed = parseLlmRelationExtractionJson(result.text);
          break;
        } catch (error) {
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
  };
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

const LlmRelationExtractionOutputSchema = z
  .object({
    relations: z.array(
      z
        .object({
          confidence: z.number().min(0).max(1),
          object: z.string().min(1),
          subject: z.string().min(1),
          type: RelationTypeSchema,
        })
        .strict(),
    ),
  })
  .strict();

type LlmRelationExtractionOutput = z.infer<typeof LlmRelationExtractionOutputSchema>;
