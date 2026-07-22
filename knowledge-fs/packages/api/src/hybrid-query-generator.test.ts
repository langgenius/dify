import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import { createHybridQueryGenerator } from "./hybrid-query-generator";
import type { BasicHybridRetriever } from "./retrieval-types";

describe("hybrid query generator", () => {
  it("streams layered retrieval evidence with plan and citations", async () => {
    const calls: unknown[] = [];
    const resolverCalls: unknown[] = [];
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push({ ...input, permissionScope: [...(input.permissionScope ?? [])] });
        return {
          items: [
            {
              citation: {
                artifactHash: "a".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
                documentVersion: 1,
                pageNumber: 2,
                sectionPath: ["Invoice"],
              },
              metadata: {
                multimodalCandidate: {
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
                  documentVersion: 1,
                  pageNumber: 2,
                  parseElementId: "figure-1",
                  sectionPath: ["Invoice"],
                  source: "image-ocr-retrieval",
                },
                text: "苏州语灵人工智能科技有限公司 发票号码 26322000003220128076",
              },
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
              permissionScope: [],
              projectionIds: ["fts-1"],
              score: 0.9,
              sources: ["fts"],
            },
          ],
          metrics: {
            denseCandidates: 0,
            denseMs: 0,
            ftsCandidates: 1,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 2,
          },
          plan: {
            denseTopK: 0,
            ftsTopK: 10,
            fusionLimit: 10,
            queryLanguage: "cjk",
            requestedMode: "research",
            rerankCandidateLimit: 10,
            resolvedMode: "research",
            strategyVersion: "retrieval-planner-v1",
            topK: 10,
          },
        };
      },
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      multimodalCandidateResolver: {
        resolve: async ({ candidate, knowledgeSpaceId }) => {
          resolverCalls.push({ candidate, knowledgeSpaceId });

          return {
            ...candidate,
            assetDescriptorPath:
              "/knowledge/docs/Invoice.pdf--018f0d60/assets/image-发票--018f0d60.json",
            assetRoute:
              "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d01/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44%3A0%3Afigure-1/asset",
            manifestItemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44:0:figure-1",
            modality: "image",
            parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          };
        },
      },
      retriever,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "research",
      permissionScope: ["knowledge-spaces:read"],
      query: "苏州语灵人工智能科技有限公司",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(calls).toEqual([
      expect.objectContaining({
        limit: 3,
        mode: "research",
        permissionScope: ["knowledge-spaces:read"],
        queryVector: [0],
        topK: 10,
      }),
    ]);
    expect(resolverCalls).toEqual([
      {
        candidate: {
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          documentVersion: 1,
          pageNumber: 2,
          parseElementId: "figure-1",
          sectionPath: ["Invoice"],
          source: "image-ocr-retrieval",
        },
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      },
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        delta: expect.stringContaining("Multimodal evidence:"),
        type: "delta",
      }),
      expect.objectContaining({
        finishReason: "retrieval-evidence",
        metadata: expect.objectContaining({
          citations: [
            expect.objectContaining({
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              label: "node:018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
              multimodalCandidate: {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
                documentVersion: 1,
                assetDescriptorPath:
                  "/knowledge/docs/Invoice.pdf--018f0d60/assets/image-发票--018f0d60.json",
                assetRoute:
                  "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d01/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44%3A0%3Afigure-1/asset",
                manifestItemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44:0:figure-1",
                modality: "image",
                pageNumber: 2,
                parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
                parseElementId: "figure-1",
                sectionPath: ["Invoice"],
                source: "image-ocr-retrieval",
              },
              sources: ["fts"],
            }),
          ],
          evidenceBundle: expect.objectContaining({
            items: [
              expect.objectContaining({
                nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
              }),
            ],
            traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
          }),
          generator: "hybrid-query",
          mode: "research",
          multimodalEvidence: [
            expect.objectContaining({
              assetDescriptorPath:
                "/knowledge/docs/Invoice.pdf--018f0d60/assets/image-发票--018f0d60.json",
              assetRoute:
                "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d01/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44%3A0%3Afigure-1/asset",
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              manifestItemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44:0:figure-1",
              modality: "image",
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
              pageNumber: 2,
              parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
              parseElementId: "figure-1",
              sectionPath: ["Invoice"],
            }),
          ],
          plan: expect.objectContaining({ resolvedMode: "research" }),
        }),
        type: "done",
      }),
    ]);
  });

  it("uses a configured multimodal answer provider when visual evidence is resolved", async () => {
    const providerCalls: unknown[] = [];
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
              documentVersion: 1,
              pageNumber: 5,
              sectionPath: ["Charts"],
            },
            metadata: {
              multimodalCandidate: {
                boundingBox: { height: 100, width: 200, x: 10, y: 20 },
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
                documentVersion: 1,
                modality: "image",
                pageNumber: 5,
                parseElementId: "chart-1",
                sectionPath: ["Charts"],
              },
              text: "Revenue increased 12%",
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
            permissionScope: [],
            projectionIds: ["visual-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
        metrics: {
          denseCandidates: 1,
          denseMs: 0,
          ftsCandidates: 0,
          ftsMs: 0,
          fusedCandidates: 1,
          fusionMs: 0,
          multimodalCandidates: 1,
          totalMs: 1,
          visualEmbeddingCandidates: 1,
        },
      }),
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      multimodalAnswerProvider: {
        generate: async (input) => {
          providerCalls.push(input);

          return {
            metadata: { model: "vision-answer@1", provider: "static-vlm" },
            text: "The chart shows revenue increased by 12%.",
          };
        },
      },
      multimodalCandidateResolver: {
        resolve: async ({ candidate }) => ({
          ...candidate,
          assetDescriptorPath: "/knowledge/docs/Revenue.pdf--018f0d60/assets/image-chart.json",
          assetRoute:
            "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d11/multimodal/manifest-item/asset",
          manifestItemId: "manifest-item",
          parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13",
        }),
      },
      retriever,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "deep",
      permissionScope: ["knowledge-spaces:read"],
      query: "What does the revenue chart show?",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(providerCalls).toEqual([
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
            text: "Revenue increased 12%",
          }),
        ],
        multimodalEvidence: [
          expect.objectContaining({
            assetDescriptorPath: "/knowledge/docs/Revenue.pdf--018f0d60/assets/image-chart.json",
            assetRoute:
              "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d11/multimodal/manifest-item/asset",
            boundingBox: { height: 100, width: 200, x: 10, y: 20 },
            manifestItemId: "manifest-item",
            modality: "image",
          }),
        ],
        query: "What does the revenue chart show?",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
      }),
    ]);
    expect(events[0]).toEqual({
      delta: "The chart shows revenue increased by 12%.",
      type: "delta",
    });
    expect(events[1]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          metrics: expect.objectContaining({ visualEmbeddingCandidates: 1 }),
          multimodalAnswer: {
            metadata: { model: "vision-answer@1", provider: "static-vlm" },
            provider: "configured",
          },
        }),
        type: "done",
      }),
    );
  });

  it("embeds query text before retrieval when a query embedding provider is configured", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const retrieveCalls: unknown[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.2, 0.8]],
          metadata: { model: "query-embed@1", provider: "static" },
          model: "query-embed@1",
        };
      },
      kind: "static",
      models: async () => [],
    };
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        retrieveCalls.push(input);

        return { items: [] };
      },
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      queryEmbeddingModel: "query-embed",
      queryEmbeddingProvider: embeddings,
      retriever,
      topK: 10,
    });

    for await (const _event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "fast",
      permissionScope: ["knowledge-spaces:read"],
      query: "find revenue chart",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a03",
    })) {
      // Drain the stream.
    }

    expect(embedCalls).toEqual([
      {
        inputType: "search_query",
        model: "query-embed",
        tenantId: "tenant-1",
        texts: ["find revenue chart"],
      },
    ]);
    expect(retrieveCalls).toEqual([
      expect.objectContaining({
        denseProjectionModel: "query-embed@1",
        query: "find revenue chart",
        queryVector: [0.2, 0.8],
      }),
    ]);
  });

  it("embeds the query before dense retrieval with main embedding options", async () => {
    const embedCalls: unknown[] = [];
    const retrieveCalls: unknown[] = [];
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        retrieveCalls.push({ ...input, queryVector: [...input.queryVector] });

        return { items: [] };
      },
    };
    const generator = createHybridQueryGenerator({
      embeddingModel: "text-embedding-3-small",
      embeddings: {
        embed: async (input) => {
          embedCalls.push({ ...input, texts: [...input.texts] });

          return {
            dense: [[0.25, 0.75]],
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          };
        },
        kind: "static",
        models: async () => [],
      },
      limit: 3,
      maxAnswerChars: 1_000,
      retriever,
      topK: 10,
    });

    for await (const _event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "fast",
      permissionScope: [],
      query: "contract renewal",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a04",
    })) {
      // Drain the stream.
    }

    expect(embedCalls).toEqual([
      {
        inputType: "search_query",
        model: "text-embedding-3-small",
        tenantId: "tenant-1",
        texts: ["contract renewal"],
      },
    ]);
    expect(retrieveCalls).toEqual([
      expect.objectContaining({
        denseProjectionModel: "text-embedding-3-small",
        query: "contract renewal",
        queryVector: [0.25, 0.75],
      }),
    ]);
  });

  it("emits trace-step events for the retrieve and answer stages", async () => {
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
              documentVersion: 1,
              sectionPath: ["Invoice"],
            },
            metadata: { text: "refund policy evidence" },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
            permissionScope: [],
            projectionIds: ["fts-1"],
            score: 0.9,
            sources: ["fts"],
          },
        ],
      }),
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      retriever,
      topK: 10,
    });

    const steps = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "fast",
      permissionScope: ["knowledge-spaces:read"],
      query: "refund policy",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a09",
    })) {
      if (event.type === "trace-step") {
        steps.push(event.step);
      }
    }

    // No embedding provider configured -> no embed step; retrieve then answer.
    expect(steps.map((step) => step.name)).toEqual(["query.retrieve", "query.answer"]);
    expect(steps[0]).toMatchObject({ metadata: { itemCount: 1 }, status: "ok" });
    expect(typeof steps[0]?.metadata.durationMs).toBe("number");
    expect(Date.parse(String(steps[0]?.startedAt))).toBeLessThanOrEqual(
      Date.parse(String(steps[0]?.endedAt)),
    );
    expect(steps[1]).toMatchObject({
      metadata: { multimodal: false, synthesis: "extractive" },
      status: "ok",
    });
  });

  it("validates numeric bounds and embedding configuration at construction time", () => {
    const retriever: BasicHybridRetriever = { retrieve: async () => ({ items: [] }) };
    const embeddings: EmbeddingProvider = {
      embed: async () => ({
        dense: [[0.1]],
        metadata: { model: "embed-1", provider: "static" },
        model: "embed-1",
      }),
      kind: "static",
      models: async () => [],
    };
    const baseOptions = { limit: 3, maxAnswerChars: 1_000, retriever, topK: 10 };

    expect(() => createHybridQueryGenerator({ ...baseOptions, limit: 0 })).toThrow(
      "Hybrid query generator limit must be at least 1",
    );
    expect(() => createHybridQueryGenerator({ ...baseOptions, topK: 0 })).toThrow(
      "Hybrid query generator topK must be at least 1",
    );
    expect(() => createHybridQueryGenerator({ ...baseOptions, maxAnswerChars: 0 })).toThrow(
      "Hybrid query generator maxAnswerChars must be at least 1",
    );
    expect(() =>
      createHybridQueryGenerator({ ...baseOptions, maxMultimodalEvidenceItems: -1 }),
    ).toThrow("Hybrid query generator maxMultimodalEvidenceItems must be non-negative");
    expect(() => createHybridQueryGenerator({ ...baseOptions, embeddings })).toThrow(
      "Hybrid query generator embeddingModel is required when embeddings are configured",
    );
  });

  it("uses the knowledge-space vectorSpaceId for retrieval while invoking the selected model", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const retrieveCalls: unknown[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.1, 0.2, 0.3]],
          metadata: { dimension: 3, model: "space-model", provider: "dify-model-runtime" },
          model: "space-model",
        };
      },
      kind: "dify-model-runtime",
      models: async () => [],
    };
    const generator = createHybridQueryGenerator({
      embeddingResolver: {
        resolve: async (input) => {
          expect(input).toEqual({
            knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            tenantId: "tenant-1",
          });
          return {
            model: "space-model",
            pluginId: "space/plugin",
            provider: "space-provider",
            providerInstance: embeddings,
            revision: 4,
            vectorSpaceId: "vs-space-r4",
          };
        },
      },
      limit: 3,
      maxAnswerChars: 1_000,
      retriever: {
        retrieve: async (input) => {
          retrieveCalls.push(input);
          return { items: [] };
        },
      },
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "fast",
      permissionScope: [],
      query: "space scoped",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a09",
    })) {
      events.push(event);
    }

    expect(embedCalls).toEqual([
      {
        inputType: "search_query",
        model: "space-model",
        tenantId: "tenant-1",
        texts: ["space scoped"],
      },
    ]);
    expect(retrieveCalls).toEqual([
      expect.objectContaining({
        denseProjectionModel: "vs-space-r4",
        queryVector: [0.1, 0.2, 0.3],
      }),
    ]);
    expect(events.find((event) => event.type === "trace-step")).toMatchObject({
      step: {
        metadata: { dimension: 3, model: "space-model", vectorSpaceId: "vs-space-r4" },
        name: "query.embed",
      },
    });
  });

  it("reports the retrieval plan and metrics when no evidence is found", async () => {
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      retriever: {
        retrieve: async () => ({
          items: [],
          metrics: {
            denseCandidates: 0,
            denseMs: 1,
            ftsCandidates: 0,
            ftsMs: 1,
            fusedCandidates: 0,
            fusionMs: 1,
            totalMs: 3,
          },
          plan: {
            denseTopK: 0,
            ftsTopK: 10,
            fusionLimit: 10,
            queryLanguage: "latin",
            requestedMode: "fast",
            rerankCandidateLimit: 10,
            resolvedMode: "fast",
            strategyVersion: "retrieval-planner-v1",
            topK: 10,
          },
        }),
      },
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "fast",
      permissionScope: [],
      query: "missing evidence",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a05",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        finishReason: "no-retrieval-evidence",
        metadata: expect.objectContaining({
          generator: "hybrid-query",
          metrics: expect.objectContaining({ fusedCandidates: 0 }),
          plan: expect.objectContaining({ resolvedMode: "fast" }),
        }),
        type: "done",
      }),
    );
  });

  it("throws when the embedding provider returns no query vector", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);

        return {
          dense: [],
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      kind: "static",
      models: async () => [],
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      queryEmbeddingModel: "query-embed",
      queryEmbeddingProvider: embeddings,
      retriever: { retrieve: async () => ({ items: [] }) },
      topK: 10,
    });

    const drain = async () => {
      for await (const _event of generator.stream({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mode: "fast",
        permissionScope: [],
        query: "no vector",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "",
        },
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a06",
      })) {
        // Drain the stream.
      }
    };

    await expect(drain()).rejects.toThrow(
      "Hybrid query embedding provider returned no query vector",
    );
    // A blank tenant id is not forwarded to the embedding provider.
    expect(embedCalls[0]).not.toHaveProperty("tenantId");
  });

  it("keeps the original candidate when the resolver returns null and truncates the answer", async () => {
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
              documentVersion: 1,
              sectionPath: [],
            },
            metadata: {
              multimodalCandidate: {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
                modality: "image",
              },
              text: "long extractive evidence text",
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d22",
            permissionScope: [],
            projectionIds: ["dense-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
      }),
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 10,
      multimodalCandidateResolver: {
        resolve: async () => null,
      },
      retriever,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "deep",
      permissionScope: [],
      query: "figure lookup",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a07",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    // The extractive answer is truncated to maxAnswerChars.
    expect(events[0]).toEqual({ delta: "Retrieval ", type: "delta" });
    const metadata = (events.at(-1) as { metadata: Record<string, unknown> }).metadata;
    const citations = metadata.citations as Record<string, unknown>[];
    expect(citations[0]?.multimodalCandidate).toEqual({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
      modality: "image",
    });
  });

  it("defaults multimodal answer metadata to an empty object when the provider omits it", async () => {
    const retriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
              documentVersion: 1,
              sectionPath: ["Charts"],
            },
            metadata: {
              multimodalCandidate: {
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
                modality: "image",
              },
              text: "chart evidence",
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
            permissionScope: [],
            projectionIds: ["dense-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
      }),
    };
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      multimodalAnswerProvider: {
        generate: async () => ({ text: "The chart shows growth." }),
      },
      retriever,
      topK: 10,
    });

    const events = [];
    for await (const event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "deep",
      permissionScope: [],
      query: "what does the chart show",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a08",
    })) {
      if (event.type !== "trace-step") {
        events.push(event);
      }
    }

    expect(events[0]).toEqual({ delta: "The chart shows growth.", type: "delta" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          multimodalAnswer: { metadata: {}, provider: "configured" },
        }),
        type: "done",
      }),
    );
  });

  it("keeps Research independent from the configured embedding capability", async () => {
    const vectors: number[][] = [];
    const generator = createHybridQueryGenerator({
      limit: 3,
      maxAnswerChars: 1_000,
      queryEmbeddingModel: "must-not-run",
      queryEmbeddingProvider: {
        embed: async () => {
          throw new Error("Research must not call embeddings");
        },
        kind: "static",
        models: async () => [],
      },
      retriever: {
        retrieve: async (input) => {
          vectors.push([...input.queryVector]);
          return { items: [] };
        },
      },
      topK: 10,
    });

    for await (const _event of generator.stream({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mode: "research",
      permissionScope: [],
      query: "research camera warranty",
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a09",
    })) {
      // Drain the stream.
    }

    expect(vectors).toEqual([[0]]);
  });
});
