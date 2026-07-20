import { describe, expect, it } from "vitest";

import { createHybridQueryGenerator } from "./hybrid-query-generator";
import { createLlmAnswerQueryGenerator } from "./llm-answer-query-generator";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

const projectionSnapshot: PublishedProjectionReadSnapshot = {
  fingerprint: "published-fingerprint-v7",
  headRevision: 11,
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  projectionVersion: 7,
  publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  tenantId: "tenant-1",
};

const queryInput = {
  knowledgeSpaceId: projectionSnapshot.knowledgeSpaceId,
  mode: "fast" as const,
  permissionScope: ["knowledge-spaces:read"],
  projectionSnapshot,
  query: "published evidence",
  subject: {
    scopes: ["knowledge-spaces:read"],
    subjectId: "user-1",
    tenantId: "tenant-1",
  },
  traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
};

function capturingRetriever(calls: RetrieveHybridInput[]): BasicHybridRetriever {
  return {
    retrieve: async (input) => {
      calls.push(input);
      return { items: [] };
    },
  };
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {
    // Drain the generator so retrieval executes.
  }
}

describe("query generator projection snapshot propagation", () => {
  it("passes the boundary snapshot through the hybrid generator", async () => {
    const calls: RetrieveHybridInput[] = [];
    const generator = createHybridQueryGenerator({
      limit: 10,
      maxAnswerChars: 1_000,
      retriever: capturingRetriever(calls),
      topK: 5,
    });

    await drain(generator.stream(queryInput));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.projectionSnapshot).toBe(projectionSnapshot);
  });

  it("passes the boundary snapshot through the LLM generator", async () => {
    const calls: RetrieveHybridInput[] = [];
    const generator = createLlmAnswerQueryGenerator({
      limit: 10,
      maxAnswerChars: 1_000,
      model: "reasoning-model",
      provider: {
        stream: async function* () {
          yield { type: "done" as const };
        },
      },
      retriever: capturingRetriever(calls),
      topK: 5,
    });

    await drain(generator.stream(queryInput));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.projectionSnapshot).toBe(projectionSnapshot);
  });
});
