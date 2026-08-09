import { describe, expect, it } from "vitest";

import { createLlmRelationExtractionProvider } from "./llm-relation-extraction-provider";

describe("createLlmRelationExtractionProvider", () => {
  it("extracts multiple nodes in one strict batch request", async () => {
    let calls = 0;
    const provider = createLlmRelationExtractionProvider({
      provider: {
        generate: async () => {
          calls += 1;
          return {
            text: JSON.stringify({
              nodes: [
                {
                  nodeId: "node-1",
                  relations: [
                    {
                      confidence: 0.9,
                      object: "Atlas",
                      subject: "Acme",
                      type: "mentions",
                    },
                  ],
                },
                { nodeId: "node-2", relations: [] },
              ],
            }),
          };
        },
      },
    });

    const results = await provider.extractBatch?.([
      {
        entities: [],
        maxRelations: 5,
        model: "relation-llm",
        node: { id: "node-1" } as never,
        prompt: "Acme mentions Atlas",
        promptVersion: "relation-extraction-v1",
      },
      {
        entities: [],
        maxRelations: 5,
        model: "relation-llm",
        node: { id: "node-2" } as never,
        prompt: "Empty",
        promptVersion: "relation-extraction-v1",
      },
    ]);

    expect(calls).toBe(1);
    expect(results?.[0]?.relations[0]).toMatchObject({ object: "Atlas", subject: "Acme" });
    expect(results?.[1]?.relations).toEqual([]);
  });

  it("retries malformed JSON with an explicit correction turn", async () => {
    const calls: unknown[] = [];
    const provider = createLlmRelationExtractionProvider({
      provider: {
        generate: async (input) => {
          calls.push(input);

          return {
            text:
              calls.length === 1
                ? '{"relations":[{"subject":"Acme","type":"mentions","object":"React","confidence":0.9}'
                : '{"relations":[{"subject":"Acme","type":"mentions","object":"React","confidence":0.9}]}',
          };
        },
      },
    });

    await expect(
      provider.extract({
        entities: [],
        maxRelations: 5,
        model: "relation-llm",
        node: {} as never,
        prompt: "Text: Acme mentions React",
        promptVersion: "relation-extraction-v1",
      }),
    ).resolves.toMatchObject({
      relations: [expect.objectContaining({ object: "React", subject: "Acme", type: "mentions" })],
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
});
