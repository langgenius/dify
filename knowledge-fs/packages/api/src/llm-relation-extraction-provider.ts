import { z } from "zod";

import type {
  RelationExtractionProvider,
  RelationExtractionProviderInput,
} from "./relation-extraction-flow";

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
  readonly provider: RelationExtractionTextProvider;
  readonly temperature?: number | undefined;
}

export function createLlmRelationExtractionProvider({
  maxOutputTokens = 1_500,
  provider,
  temperature = 0,
}: LlmRelationExtractionProviderOptions): RelationExtractionProvider {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM relation extraction maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM relation extraction temperature must be non-negative");
  }

  return {
    extract: async (input) => {
      const result = await provider.generate({
        maxOutputTokens,
        messages: relationExtractionMessages(input),
        model: input.model,
        temperature,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      });
      const parsed = parseLlmRelationExtractionJson(result.text);

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

function parseLlmRelationExtractionJson(text: string): LlmRelationExtractionOutput {
  const parsed = tryParseJsonObject(text);

  try {
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
