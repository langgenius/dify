import {
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import type { ConcurrencyGate } from "./bounded-concurrency";
import type { DocumentOutlineSummaryCheckpointRepository } from "./document-outline-summary-checkpoint-repository";
import {
  DocumentOutlineSummaryBatchContractError,
  type DocumentOutlineSummaryEnhancer,
  type DocumentOutlineSummaryOperationalMetrics,
  type DocumentOutlineSummaryProvider,
  type DocumentOutlineSummaryProviderInput,
  createDocumentOutlineSummaryEnhancer,
} from "./document-outline-summary-enhancer";
import type { IngestionModelCallOperationalMetrics } from "./ingestion-model-observability";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { LlmAnswerProvider } from "./llm-answer-query-generator";
import { ReasoningCapabilityUnavailableError } from "./profile-aware-query-generator";

export interface KnowledgeSpaceOutlineSummaryEnhancerOptions {
  readonly checkpoints?: DocumentOutlineSummaryCheckpointRepository | undefined;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get">;
  readonly maxBatchInputChars?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  readonly maxConcurrentSummaries?: number | undefined;
  readonly maxInputChars: number;
  readonly maxOutputTokens: number;
  readonly maxSummaryChars: number;
  readonly metrics?: DocumentOutlineSummaryOperationalMetrics | undefined;
  readonly modelCallMetrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly promptVersion?: string | undefined;
  readonly providerFactory: (selection: KnowledgeSpaceModelSelection) => LlmAnswerProvider;
}

/**
 * Resolves the owning space's versioned reasoning model at ingestion time so
 * PageIndex Summary artifacts and online answer synthesis use the same user
 * selection. Legacy spaces without a retrieval profile retain deterministic
 * builder summaries.
 */
export function createKnowledgeSpaceOutlineSummaryEnhancer({
  checkpoints,
  manifests,
  maxBatchInputChars = 32_000,
  maxBatchSize = 8,
  maxConcurrentSummaries = 8,
  maxInputChars,
  maxOutputTokens,
  maxSummaryChars,
  metrics,
  modelCallMetrics,
  modelRequestGate,
  promptVersion = "document-outline-summary-v2",
  providerFactory,
}: KnowledgeSpaceOutlineSummaryEnhancerOptions): DocumentOutlineSummaryEnhancer {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Knowledge-space outline summary maxOutputTokens must be at least 1");
  }

  return {
    enhance: async (input) => {
      if (!input.tenantId?.trim()) {
        throw new ReasoningCapabilityUnavailableError(
          "Knowledge-space PageIndex summary enhancement requires a tenant scope",
        );
      }

      const frozenProfile = input.retrievalProfile
        ? KnowledgeSpaceRetrievalProfileSchema.parse(input.retrievalProfile)
        : undefined;
      const manifest = frozenProfile
        ? undefined
        : await manifests.get({
            knowledgeSpaceId: input.outline.knowledgeSpaceId,
            tenantId: input.tenantId,
          });
      const selection = frozenProfile?.reasoningModel ?? manifest?.retrievalProfile?.reasoningModel;
      if (!selection) {
        return input.outline;
      }

      const provider = providerFactory(selection);
      const enhancer = createDocumentOutlineSummaryEnhancer({
        ...(checkpoints ? { checkpoints } : {}),
        maxConcurrentSummaries,
        maxBatchInputChars,
        maxBatchSize,
        maxInputChars,
        maxSummaryChars,
        ...(metrics ? { metrics } : {}),
        ...(modelCallMetrics ? { modelCallMetrics } : {}),
        model: selection.model,
        promptVersion,
        provider: llmOutlineSummaryProvider({
          maxOutputTokens,
          maxSummaryChars,
          model: selection.model,
          modelRequestGate,
          provider,
          tenantId: input.tenantId,
        }),
      });

      return enhancer.enhance(input);
    },
  };
}

function llmOutlineSummaryProvider({
  maxOutputTokens,
  maxSummaryChars,
  model,
  modelRequestGate,
  provider,
  tenantId,
}: {
  readonly maxOutputTokens: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly provider: LlmAnswerProvider;
  readonly tenantId: string;
}): DocumentOutlineSummaryProvider {
  const invoke = async ({
    maxResponseChars,
    messages,
    outputTokens,
    signal,
  }: {
    readonly maxResponseChars: number;
    readonly messages: Parameters<LlmAnswerProvider["stream"]>[0]["messages"];
    readonly outputTokens: number;
    readonly signal?: AbortSignal | undefined;
  }): Promise<{ readonly metadata: Record<string, unknown>; readonly text: string }> => {
    const request = async () => {
      let text = "";
      let providerMetadata: Record<string, unknown> = {};

      for await (const event of provider.stream({
        maxOutputTokens: outputTokens,
        messages,
        model,
        ...(signal ? { signal } : {}),
        temperature: 0,
        tenantId,
      })) {
        if (event.type === "delta") {
          text += event.delta;
          if (text.length > maxResponseChars) {
            throw new Error(
              `PageIndex summary provider output exceeds ${maxResponseChars} characters`,
            );
          }
        } else if (event.type === "done" && event.metadata) {
          providerMetadata = { ...event.metadata };
        }
      }

      return { metadata: providerMetadata, text };
    };

    return modelRequestGate ? modelRequestGate.run(request) : request();
  };

  return {
    summarize: async (input) => {
      const result = await invoke({
        maxResponseChars: maxSummaryChars * 4,
        messages: [
          {
            content:
              "Summarize this document section for PageIndex retrieval. Preserve concrete entities, specifications, constraints, and conclusions. Return only the concise summary.",
            role: "system",
          },
          {
            content: JSON.stringify({
              childSummaries: input.childSummaries,
              sectionPath: input.sectionPath,
              text: input.text,
              title: input.title,
            }),
            role: "user",
          },
        ],
        outputTokens: maxOutputTokens,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      return {
        metadata: {
          ...result.metadata,
          ...(provider.kind ? { provider: provider.kind } : {}),
        },
        summary: result.text,
      };
    },
    summarizeBatch: async (inputs) => {
      if (inputs.length === 0) {
        return [];
      }
      let messages: Parameters<LlmAnswerProvider["stream"]>[0]["messages"] = [
        {
          content: [
            "Summarize document sections for PageIndex retrieval.",
            "Preserve concrete entities, specifications, constraints, and conclusions.",
            "Return strict JSON only in this shape:",
            '{"summaries":[{"outlineNodeId":"node-id","summary":"concise summary"}]}',
            "Return exactly one non-empty summary for every supplied outlineNodeId and do not invent ids.",
          ].join("\n"),
          role: "system",
        },
        {
          content: JSON.stringify({
            sections: inputs.map((input) => ({
              childSummaries: input.childSummaries,
              outlineNodeId: input.outlineNodeId,
              sectionPath: input.sectionPath,
              text: input.text,
              title: input.title,
            })),
          }),
          role: "user",
        },
      ];
      let lastText = "";
      let lastMetadata: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await invoke({
          maxResponseChars: maxSummaryChars * inputs.length * 4 + 8_000,
          messages,
          outputTokens: Math.min(4_096, Math.max(maxOutputTokens, inputs.length * 256)),
          ...(inputs[0]?.signal ? { signal: inputs[0].signal } : {}),
        });
        lastText = result.text;
        lastMetadata = result.metadata;
        try {
          const summaries = parseBatchSummaryResponse(lastText, inputs);
          return summaries.map((summary) => ({
            metadata: {
              ...lastMetadata,
              batchSize: inputs.length,
              ...(provider.kind ? { provider: provider.kind } : {}),
            },
            retries: attempt,
            summary,
          }));
        } catch (error) {
          if (attempt === 1) {
            throw new DocumentOutlineSummaryBatchContractError(
              "PageIndex batch summary provider returned an invalid result",
              { cause: error },
            );
          }
          messages = [
            ...messages,
            {
              content: lastText.slice(0, 16_000),
              role: "assistant",
            },
            {
              content:
                "The response violated the required JSON contract. Return a corrected complete JSON object with exactly one summary for every supplied outlineNodeId.",
              role: "user",
            },
          ];
        }
      }
      throw new DocumentOutlineSummaryBatchContractError(
        "PageIndex batch summary provider exhausted its contract retries",
      );
    },
  };
}

function parseBatchSummaryResponse(
  text: string,
  inputs: readonly DocumentOutlineSummaryProviderInput[],
): string[] {
  const parsed = parseJsonObject(text);
  if (!Array.isArray(parsed.summaries)) {
    throw new Error("PageIndex batch summary response is missing summaries");
  }
  const expectedIds = new Set(inputs.map((input) => input.outlineNodeId));
  const summaries = new Map<string, string>();
  for (const item of parsed.summaries) {
    if (!isRecord(item)) {
      throw new Error("PageIndex batch summary item must be an object");
    }
    const outlineNodeId = typeof item.outlineNodeId === "string" ? item.outlineNodeId : "";
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!expectedIds.has(outlineNodeId) || !summary || summaries.has(outlineNodeId)) {
      throw new Error("PageIndex batch summary item has an invalid id or summary");
    }
    summaries.set(outlineNodeId, summary);
  }
  if (summaries.size !== inputs.length) {
    throw new Error("PageIndex batch summary response is incomplete");
  }
  return inputs.map((input) => {
    const summary = summaries.get(input.outlineNodeId);
    if (!summary) {
      throw new Error(`PageIndex batch summary is missing node ${input.outlineNodeId}`);
    }
    return summary;
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("PageIndex batch summary response is not JSON");
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
  if (!isRecord(parsed)) {
    throw new Error("PageIndex batch summary response must be an object");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
