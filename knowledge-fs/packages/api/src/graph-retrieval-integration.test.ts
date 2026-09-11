import { describe, expect, it, vi } from "vitest";
import { graphPathEvidenceText } from "./graph-path-evidence";
import { GRAPH_QUERY_VERSION } from "./graph-query-contracts";
import { graphId, graphPlan, graphRelation, graphRetrievalInput } from "./graph-query.fixtures";
import type { GraphSemanticQueryResult } from "./graph-semantic-query";
import { createLlmAnswerQueryGenerator } from "./llm-answer-query-generator";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { createGraphExpandedRetrievalPath } from "./retrieval-paths";
import type { RetrieveHybridInput } from "./retrieval-types";

const item = (n: number): HybridRetrievalItem => ({
  nodeId: graphId(n),
  metadata: { text: `evidence ${n}` },
  citation: {
    artifactHash: "a".repeat(64),
    documentAssetId: graphId(1000),
    documentVersion: 1,
    sectionPath: [],
  },
  score: 1,
  projectionIds: [graphId(n + 1000)],
  sources: ["dense"],
});
function setup() {
  const relation = graphRelation(20, 10, 11, { sourceNodeIds: [graphId(110)] });
  const second = graphRelation(21, 11, 12, { sourceNodeIds: [graphId(111)] });
  const query = vi.fn(
    async (): Promise<GraphSemanticQueryResult> => ({
      version: GRAPH_QUERY_VERSION,
      status: "ready",
      paths: [
        {
          entityIds: [graphId(10), graphId(11), graphId(12)],
          entityNames: ["API", "Cache", "Database"],
          sourceNodeIds: [graphId(110), graphId(111)],
          edges: [
            { relation, fromEntityId: graphId(10), toEntityId: graphId(11) },
            { relation: second, fromEntityId: graphId(11), toEntityId: graphId(12) },
          ],
        },
      ],
      plan: graphPlan,
      flags: ["graph-semantic-index-partial"],
      elapsedMs: 1,
      entityCandidates: 3,
      relationCandidates: 1,
      examinedEdges: 2,
    }),
  );
  const retrieve = vi.fn(async (input: RetrieveHybridInput) => ({
    items: input.filters?.nodeIds
      ? input.filters.nodeIds.map((id) => item(Number(id.slice(-12))))
      : [],
    metrics: {
      denseCandidates: 0,
      denseMs: 0,
      ftsCandidates: 0,
      ftsMs: 0,
      fusedCandidates: 0,
      fusionMs: 0,
      totalMs: 0,
    },
  }));
  const graph = { listEntities: vi.fn(), traverse: vi.fn() };
  const publishedGraph = { findSeedEntityIds: vi.fn(), traverse: vi.fn() };
  const retriever = createGraphExpandedRetrievalPath({
    graph: graph as never,
    publishedGraph,
    semanticQuery: { query },
    retriever: { retrieve },
    fanout: 10,
    graphBoost: 0.2,
    graphTopK: 10,
    maxDepth: 2,
    maxSeedEntities: 3,
    maxTraversalNodes: 30,
    timeoutMs: 1000,
    strictPublishedReads: true,
  });
  return { query, retrieve, graph, publishedGraph, retriever };
}
describe("semantic graph integration with document retrieval", () => {
  it("includes the sequential semantic planning/path work in total retrieval latency", async () => {
    const { retriever } = setup();
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(1025);
    try {
      const result = await retriever.retrieve(graphRetrievalInput);
      expect(result.metrics?.graphExpansionMs).toBe(25);
      expect(result.metrics?.totalMs).toBe(25);
    } finally {
      clock.mockRestore();
    }
  });
  it("recalls graph evidence independently when document recall has no seeds", async () => {
    const { retriever, query, publishedGraph } = setup();
    const result = await retriever.retrieve(graphRetrievalInput);
    expect(result.items).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(publishedGraph.findSeedEntityIds).not.toHaveBeenCalled();
    expect(result.metrics?.degradationFlags).toContain("graph-semantic-index-partial");
    expect(result.items[0]?.metadata.graphPaths).toHaveLength(1);
    const context = graphPathEvidenceText(result.items);
    expect(context).toContain('"subject":"API","relation":"depends_on","object":"Cache"');
    expect(context).toContain('"subject":"Cache","relation":"depends_on","object":"Database"');
    expect(graphPathEvidenceText(result.items.slice(0, 1))).toBe("");
    expect(graphPathEvidenceText(result.items, "E")).toContain('"evidence":["E1"]');
  });
  it.each([false, true])(
    "carries complete graph paths through final synthesis (multimodal=%s)",
    async (multimodal) => {
      const { retriever } = setup();
      const retrieval = await retriever.retrieve(graphRetrievalInput);
      const textPrompts: string[] = [];
      const visualPrompts: string[] = [];
      const generator = createLlmAnswerQueryGenerator({
        limit: 3,
        topK: 10,
        maxAnswerChars: 1000,
        model: "reason",
        retriever: { retrieve: async () => retrieval },
        provider: {
          stream: async function* (input) {
            textPrompts.push(input.messages.map((message) => message.content).join("\n"));
            yield { type: "delta", delta: "Graph answer [1][2]" };
            yield { type: "done", finishReason: "stop" };
          },
        },
        ...(multimodal
          ? {
              multimodalAnswerProvider: {
                generate: async (input) => {
                  visualPrompts.push(input.graphPathEvidence ?? "");
                  return { text: "Graph and image answer [E1][E2]" };
                },
              },
            }
          : {}),
      });
      const events = [];
      for await (const event of generator.stream({
        knowledgeSpaceId: graphId(1),
        mode: "research",
        query: "What does API indirectly depend on?",
        permissionScope: [],
        traceId: graphId(900),
        subject: {
          subjectId: "user-graph",
          tenantId: "tenant-graph",
          scopes: ["knowledge-spaces:read"],
        },
        ...(multimodal
          ? {
              resolvedQueryImages: [
                {
                  body: new Uint8Array([1]),
                  byteSize: 1,
                  mimeType: "image/png" as const,
                  sha256: "a".repeat(64),
                  uploadFileId: graphId(901),
                },
              ],
            }
          : {}),
      }))
        events.push(event);
      expect(events.at(-1)?.type).toBe("done");
      expect(multimodal ? visualPrompts : textPrompts).toHaveLength(1);
      expect(multimodal ? textPrompts : visualPrompts).toHaveLength(0);
      const prompt = (multimodal ? visualPrompts : textPrompts)[0];
      expect(prompt).toContain('"subject":"API","relation":"depends_on","object":"Cache"');
      expect(prompt).toContain('"subject":"Cache","relation":"depends_on","object":"Database"');
      expect(prompt).toContain(multimodal ? '"evidence":["E1"]' : '"evidence":[1]');
    },
  );
  it("preserves path annotations for nodes already returned by base recall", async () => {
    const { retriever, retrieve } = setup();
    retrieve.mockResolvedValueOnce({
      items: [item(110)],
      metrics: {
        denseCandidates: 1,
        denseMs: 0,
        ftsCandidates: 0,
        ftsMs: 0,
        fusedCandidates: 1,
        fusionMs: 0,
        totalMs: 0,
      },
    });
    expect(
      (await retriever.retrieve(graphRetrievalInput)).items[0]?.metadata.graphPaths,
    ).toHaveLength(1);
  });
  it("does not duplicate unreturned provenance into each result's graph metadata", async () => {
    const { retriever, query } = setup();
    const original = await query();
    query.mockResolvedValueOnce({
      ...original,
      paths: original.paths.map((path) => ({
        ...path,
        edges: path.edges.map((edge) => ({
          ...edge,
          relation: {
            ...edge.relation,
            sourceNodeIds: [...edge.relation.sourceNodeIds, graphId(999)],
          },
        })),
      })),
    });
    const result = await retriever.retrieve(graphRetrievalInput);
    expect(JSON.stringify(result.items.map((item) => item.metadata.graphPaths))).not.toContain(
      graphId(999),
    );
    expect(graphPathEvidenceText(result.items)).toContain('"subject":"API"');
  });
  it("keeps Fast and supplemental Research legs unchanged while allowing primary semantic intent detection", async () => {
    const { retriever, query } = setup();
    await retriever.retrieve({ ...graphRetrievalInput, mode: "fast" });
    await retriever.retrieve({
      ...graphRetrievalInput,
      mode: "research",
      researchGraphEnabled: false,
      researchGraphSemanticEnabled: false,
    });
    expect(query).not.toHaveBeenCalled();
    await retriever.retrieve({
      ...graphRetrievalInput,
      mode: "research",
      researchGraphEnabled: false,
      researchGraphSemanticEnabled: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("never widens selected nodes or presents incomplete paths as complete evidence", async () => {
    const { retriever, retrieve } = setup();
    const result = await retriever.retrieve({
      ...graphRetrievalInput,
      filters: { nodeIds: [graphId(110)] },
    });
    expect(retrieve.mock.calls[1]?.[0].filters?.nodeIds).toEqual([graphId(110)]);
    expect(result.metrics?.degradationFlags).toContain("graph-path-evidence-incomplete");
    expect(graphPathEvidenceText(result.items)).toBe("");
  });
});
