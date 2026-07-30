import { describe, expect, it } from "vitest";

import { createLlmRelationExtractionProvider } from "./llm-relation-extraction-provider";

describe("createLlmRelationExtractionProvider", () => {
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
