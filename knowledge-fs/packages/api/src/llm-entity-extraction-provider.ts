import { z } from "zod";

import type {
  EntityExtractionProvider,
  EntityExtractionProviderInput,
} from "./entity-extraction-flow";
import { cloneJsonObject, isPlainObject } from "./json-utils";

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
  readonly provider: EntityExtractionTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmEntityExtractionProvider({
  maxOutputTokens = 1_500,
  provider,
  temperature = 0,
}: LlmEntityExtractionProviderOptions): EntityExtractionProvider {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM entity extraction maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM entity extraction temperature must be non-negative");
  }

  return {
    extract: async (input) => {
      const result = await provider.generate({
        maxOutputTokens,
        messages: entityExtractionMessages(input),
        model: input.model,
        temperature,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      });
      const parsed = parseLlmEntityExtractionJson(result.text);

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
  };
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

function parseLlmEntityExtractionJson(text: string): LlmEntityExtractionOutput {
  const parsed = tryParseJsonObject(text);

  try {
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

const LlmEntityExtractionOutputSchema = z
  .object({
    entities: z.array(
      z
        .object({
          aliases: z.array(z.string().min(1)).max(12).optional(),
          canonicalName: z.string().min(1).optional(),
          confidence: z.number().min(0).max(1),
          text: z.string().min(1),
          type: EntityTypeSchema,
        })
        .strict(),
    ),
  })
  .strict();

type LlmEntityExtractionOutput = z.infer<typeof LlmEntityExtractionOutputSchema>;
