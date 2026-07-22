import { describe, expect, it } from "vitest";

import { createLlmEntityExtractionProvider } from "./llm-entity-extraction-provider";

describe("createLlmEntityExtractionProvider", () => {
  it("adapts strict LLM JSON into entity extraction provider results", async () => {
    const calls: unknown[] = [];
    const provider = createLlmEntityExtractionProvider({
      provider: {
        kind: "static",
        generate: async (input) => {
          calls.push(input);

          return {
            finishReason: "stop",
            metadata: { requestId: "llm-request-1" },
            model: input.model,
            text: JSON.stringify({
              entities: [
                {
                  aliases: ["Acme"],
                  canonicalName: "Acme Corp",
                  confidence: 0.96,
                  text: "Acme",
                  type: "organization",
                },
              ],
            }),
          };
        },
      },
    });

    const result = await provider.extract({
      maxEntities: 5,
      model: "entity-llm",
      node: {} as never,
      prompt: "Text: Acme ships Atlas.",
      promptVersion: "entity-extraction-v1",
    });

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      entities: [
        {
          confidence: 0.96,
          metadata: {
            aliases: ["Acme"],
            canonicalName: "Acme Corp",
            source: "llm",
          },
          text: "Acme",
          type: "organization",
        },
      ],
      metadata: {
        finishReason: "stop",
        generationModel: "entity-llm",
        provider: "static",
        requestId: "llm-request-1",
      },
    });
  });

  it("rejects malformed or unsupported LLM entity output", async () => {
    const provider = createLlmEntityExtractionProvider({
      provider: {
        generate: async () => ({
          text: '{"entities":[{"text":"Acme","type":"unsupported","confidence":0.9}]}',
        }),
      },
    });

    await expect(
      provider.extract({
        maxEntities: 5,
        model: "entity-llm",
        node: {} as never,
        prompt: "Text: Acme",
        promptVersion: "entity-extraction-v1",
      }),
    ).rejects.toThrow("LLM entity extraction provider returned invalid entity JSON");
  });
});
