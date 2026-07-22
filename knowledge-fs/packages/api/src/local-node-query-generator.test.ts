import { KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createLocalNodeQueryGenerator } from "./local-node-query-generator";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("local node query generator", () => {
  it("paginates local node scans so later uploaded documents are queryable", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 2,
      maxNodes: 4,
    });
    await nodes.createMany([
      node("018f0d60-7a49-7cc2-9c1b-5b36f18f2c01", "Earlier roadmap notes"),
      node("018f0d60-7a49-7cc2-9c1b-5b36f18f2c02", "Parser readiness notes"),
      node(
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c03",
        "苏州语灵人工智能科技有限公司 发票号码 26322000003220128076",
      ),
    ]);
    const generator = createLocalNodeQueryGenerator({
      maxAnswerChars: 1_000,
      maxNodes: 4,
      maxPageSize: 2,
      nodes,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId,
      mode: "fast",
      permissionScope: [],
      query: "苏州语灵人工智能科技有限公司",
      subject: { scopes: [], subjectId: "user-1", tenantId: "tenant-1" },
      traceId: "trace-1",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        delta: expect.stringContaining("苏州语灵人工智能科技有限公司"),
        type: "delta",
      }),
      expect.objectContaining({
        finishReason: "local-evidence",
        metadata: expect.objectContaining({ nodeCount: 1 }),
        type: "done",
      }),
    ]);
  });
});

function node(id: string, text: string) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
    endOffset: text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
    permissionScope: [],
    sourceLocation: { sectionPath: [] },
    startOffset: 0,
    text,
  });
}
