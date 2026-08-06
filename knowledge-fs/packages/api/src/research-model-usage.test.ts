import { describe, expect, it, vi } from "vitest";

import {
  ResearchModelCallObserverError,
  calculateResearchModelCallCost,
  estimateResearchModelPromptTokens,
  notifyResearchModelCallAfter,
  notifyResearchModelCallBefore,
  parseResearchModelUsage,
} from "./research-model-usage";

describe("Research model usage", () => {
  it("normalizes Dify runtime token metadata and computes usage-based cost", () => {
    const usage = parseResearchModelUsage({
      model: "reasoning-v1",
      provider: "dify-model-runtime",
      usage: { completionTokens: 25, promptTokens: 100, totalTokens: 125 },
    });

    expect(usage).toEqual({
      completionTokens: 25,
      promptTokens: 100,
      totalTokens: 125,
    });
    expect(
      calculateResearchModelCallCost({
        fallback: { completionTokens: 512, promptTokens: 1_000 },
        metadata: { usage },
        pricing: { inputPerTokenUsd: 0.000_003, outputPerTokenUsd: 0.000_012 },
      }),
    ).toEqual({ costUsd: 0.0006, estimated: false, usage });
  });

  it("accepts snake-case usage and conservatively falls back to the reserved token bound", () => {
    expect(
      parseResearchModelUsage({
        usage: { completion_tokens: 3, prompt_tokens: 7, total_tokens: 10 },
      }),
    ).toEqual({ completionTokens: 3, promptTokens: 7, totalTokens: 10 });
    expect(
      calculateResearchModelCallCost({
        fallback: { completionTokens: 20, promptTokens: 50 },
        metadata: undefined,
        pricing: { inputPerTokenUsd: 0.000_001, outputPerTokenUsd: 0.000_002 },
      }),
    ).toEqual({
      costUsd: 0.00009,
      estimated: true,
      usage: { completionTokens: 20, promptTokens: 50, totalTokens: 70 },
    });
  });

  it("supports absent observers and wraps reservation or accounting failures", async () => {
    const descriptor = {
      callId: "call-1",
      estimatedPromptTokens: 64,
      maxOutputTokens: 32,
      model: "reasoning-v1",
      provider: "dify",
      step: "pageindex.layer" as const,
    };
    await expect(notifyResearchModelCallBefore(undefined, descriptor)).resolves.toBeUndefined();
    await expect(
      notifyResearchModelCallAfter(undefined, { ...descriptor, status: "succeeded" }),
    ).resolves.toBeUndefined();

    const before = vi.fn().mockResolvedValue(undefined);
    const after = vi.fn().mockResolvedValue(undefined);
    await notifyResearchModelCallBefore({ after, before }, descriptor);
    await notifyResearchModelCallAfter({ after, before }, { ...descriptor, status: "failed" });
    expect(before).toHaveBeenCalledWith(descriptor);
    expect(after).toHaveBeenCalledWith({ ...descriptor, status: "failed" });

    await expect(
      notifyResearchModelCallBefore(
        { after, before: vi.fn().mockRejectedValue(new Error("reserve")) },
        descriptor,
      ),
    ).rejects.toBeInstanceOf(ResearchModelCallObserverError);
    await expect(
      notifyResearchModelCallAfter(
        { after: vi.fn().mockRejectedValue(new Error("account")), before },
        { ...descriptor, status: "succeeded" },
      ),
    ).rejects.toThrow("Research model call accounting failed");
  });

  it("rejects malformed usage and pricing while accepting partial provider usage", () => {
    for (const metadata of [undefined, null, [], {}, { usage: "invalid" }, { usage: {} }]) {
      expect(parseResearchModelUsage(metadata)).toBeUndefined();
    }
    expect(
      parseResearchModelUsage({
        usage: {
          completionTokens: -1,
          promptTokens: 9,
          totalTokens: 9.5,
        },
      }),
    ).toEqual({ promptTokens: 9 });
    expect(
      calculateResearchModelCallCost({
        fallback: { completionTokens: 4, promptTokens: 10 },
        metadata: { usage: { promptTokens: 6 } },
        pricing: { inputPerTokenUsd: 0.1, outputPerTokenUsd: 0.2 },
      }),
    ).toEqual({
      costUsd: 1.4,
      estimated: true,
      usage: { completionTokens: 4, promptTokens: 6, totalTokens: 10 },
    });

    expect(() =>
      calculateResearchModelCallCost({
        fallback: { completionTokens: -1, promptTokens: 1 },
        metadata: undefined,
        pricing: { inputPerTokenUsd: 0, outputPerTokenUsd: 0 },
      }),
    ).toThrow("completionTokens must be a non-negative integer");
    for (const pricing of [
      { inputPerTokenUsd: -1, outputPerTokenUsd: 0 },
      { inputPerTokenUsd: 0, outputPerTokenUsd: Number.POSITIVE_INFINITY },
    ]) {
      expect(() =>
        calculateResearchModelCallCost({
          fallback: { completionTokens: 1, promptTokens: 1 },
          metadata: undefined,
          pricing,
        }),
      ).toThrow("must be non-negative and finite");
    }
    expect(estimateResearchModelPromptTokens({ query: "发票" })).toBeGreaterThan(32);
  });
});
