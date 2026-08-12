import type {
  DocumentAssetRepository,
  DocumentOutlineRepository,
  GraphIndexRepository,
} from "@knowledge/api";
import type { LlmProvider } from "@knowledge/generation";
import { describe, expect, it, vi } from "vitest";

import {
  contentTokens,
  createApiAnswerabilityJudge,
  createApiRelevanceTriageSignals,
  createApiTriageCorpusLoader,
  createApiWorkflowFailedRetrievalTriage,
  parseAnswerabilityVerdict,
  parseWorkflowFailedRetrievalVerdict,
} from "./relevance-triage-signals";

const KS = "10000000-0000-4000-8000-000000000001";
const INPUT = { knowledgeSpaceId: KS, tenantId: "t" };

describe("contentTokens / parseAnswerabilityVerdict", () => {
  it("tokenizes to deduped content words", () => {
    expect(contentTokens("What is the Refund Policy?")).toEqual(["refund", "policy"]);
  });

  it("parses judge replies, defaulting to uncertain", () => {
    expect(parseAnswerabilityVerdict("RETRIEVAL_MISS")).toEqual({
      confidence: 0.7,
      verdict: "retrieval-miss",
    });
    expect(parseAnswerabilityVerdict("the answer is COVERAGE GAP")).toEqual({
      confidence: 0.7,
      verdict: "coverage-gap",
    });
    expect(parseAnswerabilityVerdict("no idea")).toEqual({ confidence: 0.4, verdict: "uncertain" });
  });
});

describe("createApiRelevanceTriageSignals", () => {
  it("scores graph/summary overlap, judges answerability, and caches the corpus", async () => {
    let loads = 0;
    const signals = createApiRelevanceTriageSignals({
      judge: async ({ topics }) => ({
        confidence: 0.9,
        verdict: topics.includes("Refund Policy") ? "retrieval-miss" : "uncertain",
      }),
      loadCorpus: async () => {
        loads += 1;
        return {
          entityTokens: new Set(["refund", "policy"]),
          summaryTokens: new Set(["shipping"]),
          topics: ["Refund Policy"],
        };
      },
    });

    await expect(
      signals.graphRelevance({ ...INPUT, query: "refund policy help" }),
    ).resolves.toEqual({
      entityOverlap: 2,
      matched: true,
    });
    await expect(signals.summaryRelevance({ ...INPUT, query: "shipping info" })).resolves.toEqual({
      matched: true,
      score: 0.5,
    });
    await expect(signals.graphRelevance({ ...INPUT, query: "totally off base" })).resolves.toEqual({
      entityOverlap: 0,
      matched: false,
    });
    await expect(signals.answerability({ ...INPUT, query: "refund policy" })).resolves.toEqual({
      confidence: 0.9,
      verdict: "retrieval-miss",
    });

    expect(loads).toBe(1); // corpus cached across all calls for the space
  });

  it("returns uncertain answerability when no judge is configured", async () => {
    const signals = createApiRelevanceTriageSignals({
      loadCorpus: async () => ({ entityTokens: new Set(), summaryTokens: new Set(), topics: [] }),
    });
    await expect(signals.answerability({ ...INPUT, query: "q" })).resolves.toEqual({
      verdict: "uncertain",
    });
  });
});

describe("createApiTriageCorpusLoader", () => {
  it("builds entity + summary vocabularies from graph and outlines", async () => {
    const graphIndex = {
      listEntities: async () => ({
        items: [{ aliases: ["refunds"], name: "Refund Policy" }],
      }),
    } as unknown as GraphIndexRepository;
    const documentAssets = {
      list: async () => ({
        items: [{ filename: "Store Guide.pdf", id: "a1", metadata: {}, version: 1 }],
      }),
    } as unknown as DocumentAssetRepository;
    const documentOutlines = {
      getByDocumentVersion: async () => ({
        nodes: [{ children: [], summary: "shipping costs vary", title: "Shipping" }],
      }),
    } as unknown as DocumentOutlineRepository;

    const corpus = await createApiTriageCorpusLoader({
      documentAssets,
      documentOutlines,
      graphIndex,
    })(KS);
    expect([...corpus.entityTokens].sort()).toEqual(["policy", "refund", "refunds"]);
    expect([...corpus.summaryTokens].sort()).toEqual(["costs", "shipping", "vary"]);
    expect(corpus.topics).toEqual([
      "Refund Policy",
      "Store Guide.pdf",
      "Shipping",
      "shipping costs vary",
    ]);
  });

  it("yields empty summaries when outline sources are absent (graph still populated)", async () => {
    const graphIndex = {
      listEntities: async () => ({ items: [{ aliases: [], name: "Widget" }] }),
    } as unknown as GraphIndexRepository;

    const corpus = await createApiTriageCorpusLoader({ graphIndex })(KS);
    expect([...corpus.entityTokens]).toEqual(["widget"]);
    expect(corpus.summaryTokens.size).toBe(0);
  });

  it("fails closed for malformed or inaccessible asset permission scopes", async () => {
    const documentAssets = {
      list: async () => ({
        items: [
          { filename: "Public.pdf", id: "a1", metadata: {}, version: 1 },
          {
            filename: "Private.pdf",
            id: "a2",
            metadata: { permissionScope: ["team:finance"] },
            version: 1,
          },
          {
            filename: "Malformed.pdf",
            id: "a3",
            metadata: { permissionScope: "team:finance" },
            version: 1,
          },
        ],
      }),
    } as unknown as DocumentAssetRepository;

    const corpus = await createApiTriageCorpusLoader({ documentAssets })(KS, ["tenant:t"]);
    expect(corpus.topics).toEqual(["Public.pdf"]);
  });
});

describe("workflow failed-retrieval LLM triage", () => {
  it.each([
    ["RETRIEVAL_MISS", "retrieval-miss"],
    ["COVERAGE_GAP", "coverage-gap"],
    ["IRRELEVANT", "irrelevant"],
    ["UNCERTAIN", "uncertain"],
  ] as const)("maps %s to %s using the space reasoning model", async (reply, verdict) => {
    const generate = vi.fn(async () => ({
      finishReason: "stop",
      metadata: { model: "space-reasoning", provider: "static" as const },
      model: "space-reasoning",
      text: reply,
    }));
    const providerFactory = vi.fn(() => ({ generate }) as unknown as LlmProvider);
    const triage = createApiWorkflowFailedRetrievalTriage({
      loadCorpus: async () => ({
        entityTokens: new Set(),
        summaryTokens: new Set(),
        topics: ["电子发票", "开票日期"],
      }),
      manifests: {
        get: vi.fn(async () => ({
          retrievalProfile: {
            reasoningModel: {
              model: "space-reasoning",
              pluginId: "plugin-1",
              provider: "provider-1",
            },
          },
        })) as never,
      },
      providerFactory,
    });

    await expect(
      triage.triage({
        candidateGrants: ["tenant:t"],
        knowledgeSpaceId: KS,
        query: "发票号码在哪里？",
        tenantId: "t",
      }),
    ).resolves.toEqual({ verdict });
    expect(providerFactory).toHaveBeenCalledWith({
      model: "space-reasoning",
      pluginId: "plugin-1",
      provider: "provider-1",
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "space-reasoning", temperature: 0 }),
    );
    const request = generate.mock.calls.at(0)?.at(0) as
      | { readonly messages: readonly { readonly content: string }[] }
      | undefined;
    expect(request?.messages[1]?.content).toContain("电子发票");
  });

  it("returns uncertain on provider failure or response model mismatch", async () => {
    for (const generate of [
      vi.fn(async () => {
        throw new Error("provider down");
      }),
      vi.fn(async () => ({
        finishReason: "stop",
        metadata: { model: "wrong", provider: "static" as const },
        model: "wrong",
        text: "RETRIEVAL_MISS",
      })),
    ]) {
      const triage = createApiWorkflowFailedRetrievalTriage({
        loadCorpus: async () => ({
          entityTokens: new Set(),
          summaryTokens: new Set(),
          topics: ["电子发票"],
        }),
        manifests: {
          get: vi.fn(async () => ({
            retrievalProfile: {
              reasoningModel: { model: "expected", pluginId: "p", provider: "v" },
            },
          })) as never,
        },
        providerFactory: () => ({ generate }) as unknown as LlmProvider,
      });
      await expect(
        triage.triage({
          candidateGrants: [],
          knowledgeSpaceId: KS,
          query: "q",
          tenantId: "t",
        }),
      ).resolves.toEqual({ verdict: "uncertain" });
    }
  });

  it("filters inaccessible Chinese graph topics before judging", async () => {
    const graphIndex = {
      listEntities: async () => ({
        items: [
          { aliases: [], name: "公开发票", permissionScope: [] },
          { aliases: [], name: "机密工资", permissionScope: ["team:finance"] },
        ],
      }),
    } as unknown as GraphIndexRepository;
    const corpus = await createApiTriageCorpusLoader({ graphIndex })(KS, ["tenant:t"]);
    expect(corpus.topics).toEqual(["公开发票"]);
  });

  it("parses only exact classifier tokens", () => {
    expect(parseWorkflowFailedRetrievalVerdict("retrieval miss")).toBe("retrieval-miss");
    expect(parseWorkflowFailedRetrievalVerdict("The answer is RETRIEVAL_MISS")).toBe("uncertain");
  });
});

describe("createApiAnswerabilityJudge", () => {
  it("maps the LLM reply to a verdict and falls back to uncertain on error", async () => {
    const ok = createApiAnswerabilityJudge({
      model: "m",
      provider: {
        generate: async () => ({ model: "m", text: "RETRIEVAL_MISS" }),
      } as unknown as LlmProvider,
    });
    await expect(ok({ query: "q", tenantId: "t", topics: ["x"] })).resolves.toEqual({
      confidence: 0.7,
      verdict: "retrieval-miss",
    });

    const failing = createApiAnswerabilityJudge({
      model: "m",
      provider: {
        generate: async () => {
          throw new Error("llm down");
        },
      } as unknown as LlmProvider,
    });
    await expect(failing({ query: "q", tenantId: "t", topics: [] })).resolves.toEqual({
      verdict: "uncertain",
    });
  });
});
