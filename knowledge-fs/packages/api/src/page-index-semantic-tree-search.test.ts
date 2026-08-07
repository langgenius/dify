import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  type GeneratePageIndexSemanticScoreInput,
  type PageIndexSemanticCandidate,
  PageIndexSemanticScoreContractError,
  createPageIndexSemanticTreeSearch,
} from "./page-index-semantic-tree-search";

const REASONING_MODEL: KnowledgeSpaceModelSelection = {
  model: "reasoning-model",
  pluginId: "vendor/reasoning",
  provider: "vendor",
};

describe("PageIndex semantic tree search", () => {
  it("scores every semantic candidate with the frozen reasoning model in bounded batches", async () => {
    const generate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      const body = JSON.parse(input.messages[1]?.content ?? "{}") as {
        candidateTree: PromptTreeNode;
      };
      return {
        metadata: { model: "reasoning-model" },
        model: "reasoning-model",
        text: JSON.stringify({
          scores: treeCandidateIds(body.candidateTree).map((candidateId) => ({
            candidateId,
            reason: `semantic evidence from ${candidateId}`,
            score: candidateId === "c2" ? 0.9 : 0.6,
          })),
        }),
      };
    });
    const search = createPageIndexSemanticTreeSearch({
      batchSize: 2,
      maxConcurrentBatches: 2,
      maxOutputTokens: 1_000,
      maxTextCharsPerCandidate: 200,
      providerFactory: (selection) => {
        expect(selection).toEqual(REASONING_MODEL);
        return { generate };
      },
      timeoutMs: 5_000,
    });

    const result = await search.score({
      candidates: [
        candidate("c1", ["Finance", "Invoices"]),
        candidate("c2", ["Finance", "Invoices"]),
        candidate("c3", ["Operations"]),
      ],
      query: "How long must invoices be retained?",
      reasoningModel: REASONING_MODEL,
      tenantId: "tenant-1",
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 1_000,
        model: "reasoning-model",
        temperature: 0,
        tenantId: "tenant-1",
      }),
    );
    const firstPrompt = generate.mock.calls[0]?.[0].messages;
    expect(generate.mock.calls[0]?.[0].structuredOutputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        scores: {
          items: {
            additionalProperties: false,
            properties: {
              candidateId: { enum: ["c1", "c2"], type: "string" },
              score: { maximum: 1, minimum: 0, type: "number" },
            },
            required: ["candidateId", "score", "reason"],
            type: "object",
          },
          maxItems: 2,
          minItems: 2,
          type: "array",
        },
      },
      required: ["scores"],
      type: "object",
    });
    expect(firstPrompt?.[0]?.content).toContain("do not score by keyword overlap alone");
    expect(firstPrompt?.[1]?.content).toContain("How long must invoices be retained?");
    expect(firstPrompt?.[1]?.content).toContain("Finance");
    expect(JSON.parse(firstPrompt?.[1]?.content ?? "{}")).toMatchObject({
      candidateTree: {
        children: expect.arrayContaining([
          expect.objectContaining({
            documentAssetId: "document-c1",
            children: [
              expect.objectContaining({
                sectionPath: ["Finance"],
                children: [
                  expect.objectContaining({
                    candidates: [
                      expect.objectContaining({
                        candidateId: "c1",
                        documentAssetId: "document-c1",
                        nodeId: "node-c1",
                      }),
                    ],
                    sectionPath: ["Finance", "Invoices"],
                  }),
                ],
              }),
            ],
          }),
          expect.objectContaining({
            documentAssetId: "document-c2",
            children: [
              expect.objectContaining({
                sectionPath: ["Finance"],
              }),
            ],
          }),
        ]),
        sectionPath: [],
      },
    });
    expect(result).toEqual([
      { candidateId: "c1", reason: "semantic evidence from c1", score: 0.6 },
      { candidateId: "c2", reason: "semantic evidence from c2", score: 0.9 },
      { candidateId: "c3", reason: "semantic evidence from c3", score: 0.6 },
    ]);
  });

  it("accepts a single fenced JSON object but rejects partial or invented candidate sets", async () => {
    const providerFactory = (text: string) => () => ({
      generate: async () => ({ model: "reasoning-model", text }),
    });
    const fenced = createPageIndexSemanticTreeSearch({
      batchSize: 10,
      maxConcurrentBatches: 1,
      maxOutputTokens: 500,
      maxTextCharsPerCandidate: 100,
      providerFactory: providerFactory(
        '```json\n{"scores":[{"candidateId":"c1","reason":"direct","score":1}]}\n```',
      ),
      timeoutMs: 5_000,
    });

    await expect(
      fenced.score({
        candidates: [candidate("c1")],
        query: "invoice",
        reasoningModel: REASONING_MODEL,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([{ candidateId: "c1", reason: "direct", score: 1 }]);

    for (const invalid of [
      '{"scores":[]}',
      '{"scores":[{"candidateId":"invented","reason":"wrong","score":0.5}]}',
      '{"scores":[{"candidateId":"c1","reason":"out of range","score":1.1}]}',
      '{"scores":[{"candidateId":"c1","reason":"   ","score":1}]}',
    ]) {
      const search = createPageIndexSemanticTreeSearch({
        batchSize: 10,
        maxConcurrentBatches: 1,
        maxOutputTokens: 500,
        maxTextCharsPerCandidate: 100,
        providerFactory: providerFactory(invalid),
        timeoutMs: 5_000,
      });

      await expect(
        search.score({
          candidates: [candidate("c1")],
          query: "invoice",
          reasoningModel: REASONING_MODEL,
          tenantId: "tenant-1",
        }),
      ).rejects.toBeInstanceOf(PageIndexSemanticScoreContractError);
    }
  });

  it("fails closed when the provider reports a different model", async () => {
    const search = createPageIndexSemanticTreeSearch({
      batchSize: 10,
      maxConcurrentBatches: 1,
      maxOutputTokens: 500,
      maxTextCharsPerCandidate: 100,
      providerFactory: () => ({
        generate: async () => ({
          model: "different-model",
          text: '{"scores":[{"candidateId":"c1","reason":"direct","score":1}]}',
        }),
      }),
      timeoutMs: 5_000,
    });

    const result = search.score({
      candidates: [candidate("c1")],
      query: "invoice",
      reasoningModel: REASONING_MODEL,
      tenantId: "tenant-1",
    });
    await expect(result).rejects.toMatchObject({ failureKind: "integrity" });
    await expect(result).rejects.toThrow("did not match the selected reasoning model");
  });
});

function candidate(
  candidateId: string,
  sectionPath: readonly string[] = ["Invoices"],
): PageIndexSemanticCandidate {
  return {
    candidateId,
    documentAssetId: `document-${candidateId}`,
    nodeId: `node-${candidateId}`,
    sectionPath,
    sectionValueScore: 0.9,
    text: `Evidence text for ${candidateId}`,
    valueScore: 0.8,
  };
}

interface PromptTreeNode {
  readonly candidates: readonly {
    readonly candidateId: string;
    readonly documentAssetId: string;
    readonly nodeId: string;
  }[];
  readonly children: readonly PromptTreeNode[];
  readonly documentAssetId?: string;
}

function treeCandidateIds(node: PromptTreeNode): string[] {
  return [
    ...node.candidates.map((candidate) => candidate.candidateId),
    ...node.children.flatMap(treeCandidateIds),
  ];
}
