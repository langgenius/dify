import { describe, expect, it } from "vitest";

import { createLlmEntityExtractionProvider } from "./llm-entity-extraction-provider";
import { createLlmRelationExtractionProvider } from "./llm-relation-extraction-provider";

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

  it("retries malformed JSON with an explicit correction turn", async () => {
    const calls: unknown[] = [];
    const provider = createLlmEntityExtractionProvider({
      provider: {
        generate: async (input) => {
          calls.push(input);

          return {
            text:
              calls.length === 1
                ? '{"entities":[{"text":"Acme","type":"organization","confidence":0.9}'
                : '{"entities":[{"text":"Acme","type":"organization","confidence":0.9}]}',
          };
        },
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
    ).resolves.toMatchObject({
      entities: [expect.objectContaining({ text: "Acme", type: "organization" })],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("invalid"),
          role: "user",
        }),
      ]),
    });
  });

  it("retries a retryable model runtime failure", async () => {
    let calls = 0;
    const provider = createLlmEntityExtractionProvider({
      provider: {
        generate: async () => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("model request timed out"), { retryable: true });
          }

          return { text: '{"entities":[]}' };
        },
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
    ).resolves.toMatchObject({ entities: [] });
    expect(calls).toBe(2);
  });

  it("shares one model request limit across entity and relation providers", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let startedFour: (() => void) | undefined;
    const fourStarted = new Promise<void>((resolve) => {
      startedFour = resolve;
    });
    const generate = async (input: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 4) {
        startedFour?.();
      }
      await blocked;
      active -= 1;

      return {
        text: input.messages[0]?.content.includes("relations")
          ? '{"relations":[]}'
          : '{"entities":[]}',
      };
    };
    const entityProvider = createLlmEntityExtractionProvider({ provider: { generate } });
    const relationProvider = createLlmRelationExtractionProvider({ provider: { generate } });

    const entityCalls = Array.from({ length: 4 }, () =>
      entityProvider.extract({
        maxEntities: 5,
        model: "shared-llm",
        node: {} as never,
        prompt: "Text: Acme",
        promptVersion: "entity-extraction-v1",
      }),
    );
    const relationCalls = Array.from({ length: 4 }, () =>
      relationProvider.extract({
        entities: [],
        maxRelations: 5,
        model: "shared-llm",
        node: {} as never,
        prompt: "Text: Acme",
        promptVersion: "relation-extraction-v1",
      }),
    );

    await fourStarted;
    release?.();
    await Promise.all([...entityCalls, ...relationCalls]);

    expect(maxActive).toBe(4);
  });
});
