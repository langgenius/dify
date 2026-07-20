import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { type ComputeRuntime, createTypeScriptComputeRuntime } from "@knowledge/compute";
import { type KnowledgeNode, KnowledgeNodeSchema, ParseArtifactSchema } from "@knowledge/core";
import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  type HybridRetrievalRepository,
  type RetrievalCandidate,
  createBasicHybridRetriever,
  createDenseVectorProjectionBuilder,
  createFtsProjectionBuilder,
  createInMemoryDocumentAssetRepository,
  createInMemoryGoldenQuestionRepository,
  createInMemoryIndexProjectionRepository,
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryParseArtifactRepository,
  createKnowledgeGateway,
  createRetrievalEvaluationRunner,
  createStaticAuthVerifier,
} from "./index";

const writeToken = "write-token";
const subject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a03";
const nodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a04";
const denseProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a05";
const ftsProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a06";
const goldenQuestionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a07";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("Phase 1 end-to-end integration", () => {
  it("uploads a PDF, parses, chunks, indexes, retrieves, and cites the source location", async () => {
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const documentAssets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-11T14:00:00.000Z",
    });
    const knowledgeNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const indexProjections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: subject } }),
      compute: createDeterministicComputeRuntime(),
      documentAssets,
      generateDocumentAssetId: () => documentAssetId,
      knowledgeNodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-11T13:59:00.000Z",
      }),
      parseArtifacts,
      parser: createPdfParser(),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Contracts", slug: "contracts" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const upload = new FormData();
    upload.set(
      "file",
      new File([new TextEncoder().encode("%PDF-1.7 contract fixture")], "vendor-contract.pdf", {
        type: "application/pdf",
      }),
    );
    const uploaded = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: upload,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      filename: "vendor-contract.pdf",
      id: documentAssetId,
      knowledgeSpaceId,
      mimeType: "application/pdf",
      parserStatus: "parsed",
      version: 1,
    });

    const artifactResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentAssetId}/parse-artifacts/1`,
      { headers: bearer(writeToken) },
    );
    const artifact = ParseArtifactSchema.parse(await artifactResponse.json());
    const storedNodes = (
      await knowledgeNodes.listByArtifact({
        limit: 10,
        parseArtifactId: artifact.id,
        knowledgeSpaceId,
      })
    ).items;

    expect(storedNodes).toHaveLength(1);
    expect(storedNodes[0]).toMatchObject({
      documentAssetId,
      id: nodeId,
      knowledgeSpaceId,
      permissionScope: ["tenant:tenant-1"],
      sourceLocation: {
        endOffset: 56,
        pageNumber: 2,
        sectionPath: ["Contract", "Termination"],
        startOffset: 0,
      },
    });

    const embeddings = createKeywordEmbeddingProvider();
    const denseBuilder = createDenseVectorProjectionBuilder({
      embeddings: embeddings.provider,
      generateId: () => denseProjectionId,
      maxBatchSize: 10,
      projections: indexProjections,
    });
    const ftsBuilder = createFtsProjectionBuilder({
      generateId: () => ftsProjectionId,
      maxBatchSize: 10,
      projections: indexProjections,
    });
    await denseBuilder.build({
      model: "keyword-dense",
      nodes: storedNodes,
      projectionVersion: 1,
    });
    await ftsBuilder.build({ nodes: storedNodes, projectionVersion: 1 });

    const retriever = createBasicHybridRetriever({
      repository: createInMemoryE2eRetrievalRepository({
        nodes: storedNodes,
        projections: indexProjections,
      }),
    });
    const queryEmbedding = await embeddings.provider.embed({
      inputType: "search_query",
      model: "keyword-dense",
      texts: ["How many days of notice are required for termination?"],
    });
    const result = await retriever.retrieve({
      knowledgeSpaceId,
      limit: 3,
      query: "termination notice",
      queryVector: queryEmbedding.dense[0] ?? [],
      topK: 3,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        citation: {
          artifactHash: "a".repeat(64),
          documentAssetId,
          documentVersion: 1,
          endOffset: 56,
          pageNumber: 2,
          sectionPath: ["Contract", "Termination"],
          startOffset: 0,
        },
        nodeId,
        projectionIds: [denseProjectionId, ftsProjectionId],
        sources: ["dense", "fts"],
      }),
    ]);

    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => goldenQuestionId,
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-11T14:01:00.000Z",
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: [nodeId, documentAssetId],
      knowledgeSpaceId,
      question: "How many days of notice are required for termination?",
      tags: ["phase-1-smoke"],
    });
    const evaluation = await createRetrievalEvaluationRunner({
      embeddingModel: "keyword-dense",
      embeddings: embeddings.provider,
      goldenQuestions,
      maxQuestions: 10,
      maxTopK: 5,
      retriever,
    }).run({ knowledgeSpaceId, limit: 1, topK: 3 });

    expect(evaluation.metrics).toEqual({
      citationHitRate: 1,
      noAnswerRate: 0,
      recallAtK: 1,
      totalQuestions: 1,
    });
    expect(embeddings.calls.map((call) => call.inputType)).toEqual([
      "search_document",
      "search_query",
      "search_query",
    ]);
  });
});

function createPdfParser(): ParserAdapter {
  return {
    kind: "unstructured",
    parse: async (input) =>
      ParseArtifactSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-05-11T14:00:01.000Z",
        documentAssetId: input.documentAssetId,
        elements: [
          {
            id: `${input.documentAssetId}:title`,
            metadata: {},
            pageNumber: 1,
            sectionPath: ["Contract"],
            text: "Vendor Contract",
            type: "title",
          },
          {
            id: `${input.documentAssetId}:paragraph-1`,
            metadata: {},
            pageNumber: 2,
            sectionPath: ["Contract", "Termination"],
            text: "Termination notice requires 30 days before cancellation.",
            type: "paragraph",
          },
        ],
        id: parseArtifactId,
        metadata: {
          filename: input.filename,
          mimeType: input.mimeType,
        },
        parser: "unstructured",
        version: input.version,
      }),
  };
}

function createDeterministicComputeRuntime(): ComputeRuntime {
  const compute = createTypeScriptComputeRuntime();

  return {
    ...compute,
    chunkParseArtifact(input) {
      const paragraph = input.parseArtifact.elements.find(
        (element) => element.type === "paragraph" && element.text !== undefined,
      );
      const text = paragraph?.text;

      if (!paragraph || text === undefined) {
        return [];
      }

      return [
        KnowledgeNodeSchema.parse({
          artifactHash: input.parseArtifact.artifactHash,
          documentAssetId: input.parseArtifact.documentAssetId,
          endOffset: text.length,
          id: nodeId,
          kind: "chunk",
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: {
            chunkIndex: 0,
            elementTypes: ["paragraph"],
          },
          parseArtifactId: input.parseArtifact.id,
          permissionScope:
            input.permissionScope && input.permissionScope.length > 0
              ? [...input.permissionScope]
              : ["tenant:tenant-1"],
          sourceLocation: {
            endOffset: text.length,
            pageNumber: paragraph.pageNumber,
            sectionPath: paragraph.sectionPath,
            startOffset: 0,
          },
          startOffset: 0,
          text,
        }),
      ];
    },
  };
}

function createKeywordEmbeddingProvider(): {
  readonly calls: EmbedTextsInput[];
  readonly provider: EmbeddingProvider;
} {
  const calls: EmbedTextsInput[] = [];
  return {
    calls,
    provider: {
      kind: "static",
      embed: async (input) => {
        calls.push({ ...input, texts: [...input.texts] });
        return {
          dense: input.texts.map((text) => [
            /\btermination\b/i.test(text) ? 1 : 0,
            /\bnotice\b/i.test(text) ? 1 : 0,
          ]),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      models: async () => [],
    },
  };
}

function createInMemoryE2eRetrievalRepository({
  nodes,
  projections,
}: {
  readonly nodes: readonly KnowledgeNode[];
  readonly projections: {
    listReadyBySpace(input: {
      knowledgeSpaceId: string;
      limit: number;
      type: "dense-vector" | "fts";
    }): Promise<{ items: { id: string; metadata: Record<string, unknown>; nodeId: string }[] }>;
  };
}): HybridRetrievalRepository {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return {
    searchDense: async ({ knowledgeSpaceId, queryVector, topK }) => {
      const page = await projections.listReadyBySpace({
        knowledgeSpaceId,
        limit: topK,
        type: "dense-vector",
      });
      return page.items
        .map((projection) => {
          const vector = projection.metadata.denseVector;
          const node = nodesById.get(projection.nodeId);

          if (!node || !Array.isArray(vector)) {
            return null;
          }

          return candidateFromNode({
            node,
            projectionId: projection.id,
            score: dotProduct(vector, queryVector),
            source: "dense",
          });
        })
        .filter((candidate): candidate is RetrievalCandidate => Boolean(candidate))
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);
    },
    searchFts: async ({ knowledgeSpaceId, query, topK }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const page = await projections.listReadyBySpace({
        knowledgeSpaceId,
        limit: topK,
        type: "fts",
      });
      return page.items
        .map((projection) => {
          const node = nodesById.get(projection.nodeId);

          if (!node) {
            return null;
          }

          const text = node.text.toLowerCase();
          const hits = terms.filter((term) => text.includes(term)).length;

          if (hits === 0) {
            return null;
          }

          return candidateFromNode({
            node,
            projectionId: projection.id,
            score: hits,
            source: "fts",
          });
        })
        .filter((candidate): candidate is RetrievalCandidate => Boolean(candidate))
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);
    },
  };
}

function candidateFromNode({
  node,
  projectionId,
  score,
  source,
}: {
  readonly node: KnowledgeNode;
  readonly projectionId: string;
  readonly score: number;
  readonly source: RetrievalCandidate["source"];
}): RetrievalCandidate {
  return {
    citation: {
      artifactHash: node.artifactHash,
      documentAssetId: node.documentAssetId,
      documentVersion: 1,
      ...(node.sourceLocation.endOffset === undefined
        ? {}
        : { endOffset: node.sourceLocation.endOffset }),
      ...(node.sourceLocation.pageNumber === undefined
        ? {}
        : { pageNumber: node.sourceLocation.pageNumber }),
      sectionPath: [...node.sourceLocation.sectionPath],
      ...(node.sourceLocation.startOffset === undefined
        ? {}
        : { startOffset: node.sourceLocation.startOffset }),
    },
    metadata: { kind: node.kind },
    nodeId: node.id,
    permissionScope: [...node.permissionScope],
    projectionId,
    score,
    source,
  };
}

function dotProduct(left: unknown, right: readonly number[]): number {
  if (!Array.isArray(left)) {
    return 0;
  }

  return left.reduce(
    (sum, value, index) => sum + (typeof value === "number" ? value * (right[index] ?? 0) : 0),
    0,
  );
}
