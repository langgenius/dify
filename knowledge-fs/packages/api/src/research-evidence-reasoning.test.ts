import { describe, expect, it, vi } from "vitest";

import {
  ResearchEvidenceReasoningContractError,
  createResearchEvidenceReasoning,
} from "./research-evidence-reasoning";

const reasoningModel = {
  model: "reasoning-model",
  pluginId: "plugin/reasoning",
  provider: "reasoning",
};

describe("Research evidence reasoning", () => {
  it("keeps direct queries deterministic and uses one bounded model plan for complex queries", async () => {
    const generate = vi.fn(async (_input: unknown) => ({
      metadata: { model: reasoningModel.model, usage: { totalTokens: 24 } },
      model: reasoningModel.model,
      text: JSON.stringify({
        evidenceDimensions: ["renewal", "termination"],
        intent: "comparison",
        subqueries: ["renewal terms", "termination terms", "renewal terms"],
        useGraph: false,
      }),
    }));
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 256,
      providerFactory: () => ({ generate }),
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.plan({
        query: "合同编号是什么？",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      evidenceDimensions: [],
      intent: "direct",
      modelCalled: false,
      subqueries: [],
      useGraph: false,
    });
    expect(generate).not.toHaveBeenCalled();

    await expect(
      reasoning.plan({
        query: "比较续约条款和终止条款，并说明两者风险",
        reasoningModel,
        tenantId: "tenant-1",
        traceId: "trace-1",
      }),
    ).resolves.toEqual({
      evidenceDimensions: ["renewal", "termination"],
      intent: "comparison",
      modelCalled: true,
      subqueries: ["renewal terms", "termination terms"],
      useGraph: false,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      model: reasoningModel.model,
      temperature: 0,
      tenantId: "tenant-1",
    });
  });

  it("recovers a provider-truncated complex query plan once", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        finishReason: "length",
        metadata: { model: reasoningModel.model, usage: { completionTokens: 256 } },
        model: reasoningModel.model,
        text: '{"intent":"comparison","subqueries":["renewal terms"',
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        metadata: { model: reasoningModel.model, usage: { completionTokens: 96 } },
        model: reasoningModel.model,
        text: JSON.stringify({
          evidenceDimensions: ["renewal", "termination"],
          intent: "comparison",
          subqueries: ["renewal terms", "termination terms"],
          useGraph: false,
        }),
      });
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 256,
      providerFactory: () => ({ generate }),
      recoveryMaxOutputTokens: 1_024,
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.plan({
        query: "比较续约条款和终止条款，并说明两者风险",
        reasoningModel,
        tenantId: "tenant-1",
        traceId: "trace-plan",
      }),
    ).resolves.toMatchObject({
      evidenceDimensions: ["renewal", "termination"],
      intent: "comparison",
      modelCalled: true,
      subqueries: ["renewal terms", "termination terms"],
    });
    expect(generate.mock.calls.map(([input]) => input.maxOutputTokens)).toEqual([256, 1_024]);
  });

  it("judges the evidence set once and emits only a focused supplemental query", async () => {
    const generate = vi.fn(async (_input: unknown) => ({
      metadata: { model: reasoningModel.model },
      model: reasoningModel.model,
      text: JSON.stringify({
        coverage: 0.5,
        coveredDimensions: ["renewal"],
        missingDimensions: ["termination"],
        sufficient: false,
        supplementalQuery: "termination notice period",
      }),
    }));
    const reasoning = createResearchEvidenceReasoning({
      maxEvidenceCharsPerItem: 20,
      maxEvidenceItems: 2,
      maxOutputTokens: 128,
      providerFactory: () => ({ generate }),
      timeoutMs: 1_000,
    });

    const result = await reasoning.judge({
      evidence: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId: "doc-1",
            documentVersion: 1,
            sectionPath: ["Renewal"],
          },
          metadata: { text: "renewal evidence that is deliberately longer than twenty chars" },
          nodeId: "node-1",
          projectionIds: ["projection-1"],
          score: 0.9,
          sources: ["dense"],
        },
      ],
      evidenceDimensions: ["renewal", "termination"],
      query: "compare terms",
      reasoningModel,
      tenantId: "tenant-1",
    });

    expect(result).toEqual({
      coverage: 0.5,
      coveredDimensions: ["renewal"],
      missingDimensions: ["termination"],
      modelCalled: true,
      sufficient: false,
      supplementalQuery: "termination notice period",
    });
    const request = generate.mock.calls[0]?.[0] as
      | { readonly messages: readonly { readonly content: string }[] }
      | undefined;
    const userMessage = request?.messages[1]?.content ?? "";
    expect(userMessage).toContain("renewal evidence tha");
    expect(userMessage).not.toContain("deliberately longer");

    await expect(
      reasoning.judge({
        evidence: [],
        evidenceDimensions: ["renewal"],
        query: "compare terms",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      coverage: 0,
      coveredDimensions: [],
      missingDimensions: ["renewal"],
      modelCalled: false,
      sufficient: false,
      supplementalQuery: "compare terms",
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("normalizes a provider explanation in the boolean sufficient field", async () => {
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 128,
      providerFactory: () => ({
        generate: async () => ({
          metadata: { model: reasoningModel.model },
          model: reasoningModel.model,
          text: JSON.stringify({
            coverage: 0.2,
            coveredDimensions: ["governance conflict"],
            missingDimensions: ["event timeline"],
            sufficient: "不足。现有证据缺少具体时间线。",
            supplementalQuery: "Apple 1985 event timeline",
          }),
        }),
      }),
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.judge({
        evidence: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "doc-1",
              documentVersion: 1,
              sectionPath: ["Apple, 1985"],
            },
            metadata: { text: "The evidence only summarizes a governance conflict." },
            nodeId: "node-1",
            projectionIds: ["projection-1"],
            score: 0.99,
            sources: ["dense"],
          },
        ],
        evidenceDimensions: [],
        query: "Apple，1985 到底发生了什么",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      coverage: 0.2,
      coveredDimensions: ["governance conflict"],
      missingDimensions: ["event timeline"],
      modelCalled: true,
      sufficient: false,
      supplementalQuery: "Apple 1985 event timeline",
    });
  });

  it.each([
    {
      finishReason: "length",
      label: "an explicit provider length finish reason",
      metadata: { model: reasoningModel.model, usage: { completionTokens: 480 } },
    },
    {
      finishReason: undefined,
      label: "usage that reaches the requested output-token bound",
      metadata: { model: reasoningModel.model, usage: { completionTokens: 512 } },
    },
  ])("recovers one truncated judgement detected from $label", async (firstResponse) => {
    const before = vi.fn();
    const after = vi.fn();
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        ...(firstResponse.finishReason ? { finishReason: firstResponse.finishReason } : {}),
        metadata: firstResponse.metadata,
        model: reasoningModel.model,
        text: '{"coverage":0.8,"coveredDimensions":["timeline"]',
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        metadata: {
          model: reasoningModel.model,
          usage: { completionTokens: 180 },
        },
        model: reasoningModel.model,
        text: JSON.stringify({
          coverage: 1,
          coveredDimensions: ["timeline"],
          missingDimensions: [],
          sufficient: true,
          supplementalQuery: null,
        }),
      });
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 512,
      providerFactory: () => ({ generate }),
      recoveryMaxOutputTokens: 2_048,
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.judge({
        evidence: [researchEvidenceItem()],
        evidenceDimensions: ["timeline"],
        query: "Apple，1985 到底发生了什么",
        reasoningModel,
        researchModelCallObserver: { after, before },
        tenantId: "tenant-1",
        traceId: "trace-1",
      }),
    ).resolves.toEqual({
      coverage: 1,
      coveredDimensions: ["timeline"],
      missingDimensions: [],
      modelCalled: true,
      sufficient: true,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.map(([input]) => input.maxOutputTokens)).toEqual([512, 2_048]);
    expect(before.mock.calls.map(([input]) => input.callId)).toEqual([
      "research-judge:trace-1:1",
      "research-judge:trace-1:1:recovery",
    ]);
    expect(after.mock.calls.map(([input]) => input.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("does not retry a non-truncated judgement contract violation", async () => {
    const generate = vi.fn(async () => ({
      finishReason: "stop",
      metadata: {
        model: reasoningModel.model,
        usage: { completionTokens: 120 },
      },
      model: reasoningModel.model,
      text: "not-json",
    }));
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 512,
      providerFactory: () => ({ generate }),
      recoveryMaxOutputTokens: 2_048,
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.judge({
        evidence: [researchEvidenceItem()],
        evidenceDimensions: ["timeline"],
        query: "Apple，1985 到底发生了什么",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({
      code: "RESEARCH_EVIDENCE_REASONING_INVALID",
      retryable: false,
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("fails with a distinct terminal code when the bounded recovery is also truncated", async () => {
    const generate = vi.fn(async (input: { readonly maxOutputTokens?: number | undefined }) => ({
      finishReason: "length",
      metadata: {
        model: reasoningModel.model,
        usage: { completionTokens: input.maxOutputTokens },
      },
      model: reasoningModel.model,
      text: '{"coverage":0.8',
    }));
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 512,
      providerFactory: () => ({ generate }),
      recoveryMaxOutputTokens: 2_048,
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.judge({
        evidence: [researchEvidenceItem()],
        evidenceDimensions: ["timeline"],
        query: "Apple，1985 到底发生了什么",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({
      code: "RESEARCH_EVIDENCE_REASONING_TRUNCATED",
      retryable: false,
    });
    expect(generate.mock.calls.map(([input]) => input.maxOutputTokens)).toEqual([512, 2_048]);
  });

  it("reports successful and failed provider calls through the model observer", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        metadata: { model: reasoningModel.model },
        model: reasoningModel.model,
        text: JSON.stringify({
          evidenceDimensions: ["risk"],
          intent: "overview",
          subqueries: ["risk evidence"],
          useGraph: false,
        }),
      })
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const run = vi.fn();
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 128,
      modelRequestGate: {
        run: async <T>(operation: () => Promise<T>) => {
          run();
          return operation();
        },
      },
      providerFactory: () => ({ generate }),
      timeoutMs: 1_000,
    });
    const researchModelCallObserver = { after, before };

    await expect(
      reasoning.plan({
        query: "Provide a comprehensive overview of risk",
        reasoningModel,
        researchModelCallObserver,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ modelCalled: true });
    await expect(
      reasoning.plan({
        query: "Compare risk and mitigation",
        reasoningModel,
        researchModelCallObserver,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(ResearchEvidenceReasoningContractError);

    expect(before).toHaveBeenCalledTimes(2);
    expect(after.mock.calls.map(([call]) => call.status)).toEqual(["succeeded", "failed"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "returns a different model identity",
      maxResponseChars: 16_000,
      response: {
        metadata: { model: "another-model" },
        model: "another-model",
        text: "{}",
      },
      message: "did not match",
    },
    {
      label: "omits the metadata model identity",
      maxResponseChars: 16_000,
      response: {
        metadata: null,
        model: reasoningModel.model,
        text: "{}",
      },
      message: "did not match",
    },
    {
      label: "returns an oversized response",
      maxResponseChars: 2,
      response: {
        metadata: { model: reasoningModel.model },
        model: reasoningModel.model,
        text: "{}{}",
      },
      message: "exceeded its bound",
    },
    {
      label: "violates the structured output contract",
      maxResponseChars: 16_000,
      response: {
        metadata: { model: reasoningModel.model },
        model: reasoningModel.model,
        text: "not-json",
      },
      message: "invalid structured JSON",
    },
  ])("fails closed when research.plan $label", async ({ maxResponseChars, message, response }) => {
    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 128,
      maxResponseChars,
      providerFactory: () => ({ generate: async () => response }),
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.plan({
        query: "Compare renewal and termination",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(message);
  });

  it("validates bounds and required query text before invoking a provider", async () => {
    expect(() =>
      createResearchEvidenceReasoning({
        maxOutputTokens: 0,
        providerFactory: vi.fn(),
        timeoutMs: 1_000,
      }),
    ).toThrow("maxOutputTokens must be at least 1");

    expect(() =>
      createResearchEvidenceReasoning({
        maxOutputTokens: 128,
        providerFactory: vi.fn(),
        recoveryMaxOutputTokens: 64,
        timeoutMs: 1_000,
      }),
    ).toThrow("recoveryMaxOutputTokens must be at least maxOutputTokens");

    const reasoning = createResearchEvidenceReasoning({
      maxOutputTokens: 128,
      providerFactory: vi.fn(),
      timeoutMs: 1_000,
    });
    await expect(
      reasoning.plan({ query: " ", reasoningModel, tenantId: "tenant-1" }),
    ).rejects.toThrow("query is required");
  });

  it("omits supplemental work when the evidence set is sufficient", async () => {
    const reasoning = createResearchEvidenceReasoning({
      maxEvidenceCharsPerItem: 1_000,
      maxOutputTokens: 128,
      providerFactory: () => ({
        generate: async () => ({
          metadata: { model: reasoningModel.model },
          model: reasoningModel.model,
          text: JSON.stringify({
            coverage: 1,
            coveredDimensions: ["renewal"],
            missingDimensions: [],
            sufficient: true,
            supplementalQuery: null,
          }),
        }),
      }),
      timeoutMs: 1_000,
    });

    await expect(
      reasoning.judge({
        evidence: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "doc-1",
              documentVersion: 1,
              sectionPath: ["Renewal"],
            },
            metadata: { text: "short evidence" },
            nodeId: "node-1",
            projectionIds: ["projection-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
        evidenceDimensions: ["renewal"],
        query: "renewal terms",
        reasoningModel,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      coverage: 1,
      coveredDimensions: ["renewal"],
      missingDimensions: [],
      modelCalled: true,
      sufficient: true,
    });
  });
});

function researchEvidenceItem() {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "doc-1",
      documentVersion: 1,
      sectionPath: ["Apple, 1985"],
    },
    metadata: { text: "Apple's board removed Steve Jobs from operational control in 1985." },
    nodeId: "node-1",
    projectionIds: ["projection-1"],
    score: 0.99,
    sources: ["dense" as const],
  };
}
