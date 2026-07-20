import type {
  DocumentAssetRepository,
  DocumentOutlineRepository,
  GraphIndexRepository,
} from "@knowledge/api";
import type { LlmProvider } from "@knowledge/generation";
import { describe, expect, it } from "vitest";

import {
  contentTokens,
  createApiAnswerabilityJudge,
  createApiRelevanceTriageSignals,
  createApiTriageCorpusLoader,
  parseAnswerabilityVerdict,
} from "./relevance-triage-signals";

const KS = "10000000-0000-4000-8000-000000000001";
const INPUT = { knowledgeSpaceId: KS, tenantId: "t" };

describe("contentTokens / parseAnswerabilityVerdict", () => {
  it("tokenizes to deduped content words", () => {
    expect(contentTokens("What is the Refund Policy?")).toEqual(["refund", "policy"]);
  });

  it("parses judge replies, defaulting to uncertain", () => {
    expect(parseAnswerabilityVerdict("RETRIEVAL_MISS")).toEqual({ confidence: 0.7, verdict: "retrieval-miss" });
    expect(parseAnswerabilityVerdict("the answer is COVERAGE GAP")).toEqual({ confidence: 0.7, verdict: "coverage-gap" });
    expect(parseAnswerabilityVerdict("no idea")).toEqual({ confidence: 0.4, verdict: "uncertain" });
  });
});

describe("createApiRelevanceTriageSignals", () => {
  it("scores graph/summary overlap, judges answerability, and caches the corpus", async () => {
    let loads = 0;
    const signals = createApiRelevanceTriageSignals({
      judge: async ({ topics }) => ({ confidence: 0.9, verdict: topics.includes("Refund Policy") ? "retrieval-miss" : "uncertain" }),
      loadCorpus: async () => {
        loads += 1;
        return {
          entityTokens: new Set(["refund", "policy"]),
          summaryTokens: new Set(["shipping"]),
          topics: ["Refund Policy"],
        };
      },
    });

    await expect(signals.graphRelevance({ ...INPUT, query: "refund policy help" })).resolves.toEqual({
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
    await expect(signals.answerability({ ...INPUT, query: "q" })).resolves.toEqual({ verdict: "uncertain" });
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
      list: async () => ({ items: [{ id: "a1", version: 1 }] }),
    } as unknown as DocumentAssetRepository;
    const documentOutlines = {
      getByDocumentVersion: async () => ({
        nodes: [{ children: [], summary: "shipping costs vary", title: "Shipping" }],
      }),
    } as unknown as DocumentOutlineRepository;

    const corpus = await createApiTriageCorpusLoader({ documentAssets, documentOutlines, graphIndex })(KS);
    expect([...corpus.entityTokens].sort()).toEqual(["policy", "refund", "refunds"]);
    expect([...corpus.summaryTokens].sort()).toEqual(["costs", "shipping", "vary"]);
    expect(corpus.topics).toEqual(["Refund Policy"]);
  });

  it("yields empty summaries when outline sources are absent (graph still populated)", async () => {
    const graphIndex = {
      listEntities: async () => ({ items: [{ aliases: [], name: "Widget" }] }),
    } as unknown as GraphIndexRepository;

    const corpus = await createApiTriageCorpusLoader({ graphIndex })(KS);
    expect([...corpus.entityTokens]).toEqual(["widget"]);
    expect(corpus.summaryTokens.size).toBe(0);
  });
});

describe("createApiAnswerabilityJudge", () => {
  it("maps the LLM reply to a verdict and falls back to uncertain on error", async () => {
    const ok = createApiAnswerabilityJudge({
      model: "m",
      provider: { generate: async () => ({ model: "m", text: "RETRIEVAL_MISS" }) } as unknown as LlmProvider,
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
    await expect(failing({ query: "q", tenantId: "t", topics: [] })).resolves.toEqual({ verdict: "uncertain" });
  });
});
