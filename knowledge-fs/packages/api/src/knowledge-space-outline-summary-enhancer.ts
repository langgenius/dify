import {
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import {
  type DocumentOutlineSummaryEnhancer,
  type DocumentOutlineSummaryProvider,
  createDocumentOutlineSummaryEnhancer,
} from "./document-outline-summary-enhancer";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { LlmAnswerProvider } from "./llm-answer-query-generator";
import { ReasoningCapabilityUnavailableError } from "./profile-aware-query-generator";

export interface KnowledgeSpaceOutlineSummaryEnhancerOptions {
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get">;
  readonly maxInputChars: number;
  readonly maxOutputTokens: number;
  readonly maxSummaryChars: number;
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
  manifests,
  maxInputChars,
  maxOutputTokens,
  maxSummaryChars,
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
        maxConcurrentSummaries: 4,
        maxInputChars,
        maxSummaryChars,
        model: selection.model,
        promptVersion,
        provider: llmOutlineSummaryProvider({
          maxOutputTokens,
          maxSummaryChars,
          model: selection.model,
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
  provider,
  tenantId,
}: {
  readonly maxOutputTokens: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly provider: LlmAnswerProvider;
  readonly tenantId: string;
}): DocumentOutlineSummaryProvider {
  return {
    summarize: async (input) => {
      let summary = "";
      let providerMetadata: Record<string, unknown> = {};

      for await (const event of provider.stream({
        maxOutputTokens,
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
        model,
        ...(input.signal ? { signal: input.signal } : {}),
        temperature: 0,
        tenantId,
      })) {
        if (event.type === "delta") {
          summary += event.delta;
          if (summary.length > maxSummaryChars * 4) {
            throw new Error(
              `PageIndex summary provider output exceeds ${maxSummaryChars * 4} characters`,
            );
          }
        } else if (event.type === "done" && event.metadata) {
          providerMetadata = { ...event.metadata };
        }
      }

      return {
        metadata: {
          ...providerMetadata,
          ...(provider.kind ? { provider: provider.kind } : {}),
        },
        summary,
      };
    },
  };
}
