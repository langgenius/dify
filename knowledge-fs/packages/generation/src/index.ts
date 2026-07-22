import type {
  ComputeRuntime,
  OmittedPackedEvidenceItem,
  PackEvidenceConfig,
  PackedEvidence,
  PackedEvidenceItem,
} from "@knowledge/compute";
import {
  type CacheAdapter,
  type EvidenceBundle,
  EvidenceBundleSchema,
  stableJson,
} from "@knowledge/core";
import type { DifyModelRuntimeClient } from "@knowledge/dify-model-runtime-client";
import { z } from "zod";

export type LlmProviderKind = "anthropic" | "dify-model-runtime" | "gemini" | "openai" | "static";
export type LlmMessageRole = "assistant" | "system" | "user";

export interface LlmMessage {
  readonly content: string;
  readonly role: LlmMessageRole;
}

export interface GenerateTextInput {
  readonly maxOutputTokens?: number;
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly signal?: AbortSignal;
  readonly temperature?: number;
  /** Tenant scope for Dify-managed model routing. */
  readonly tenantId?: string;
}

export interface LlmUsage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export interface LlmCostBreakdown {
  readonly completionTokens: number;
  readonly currency: "USD";
  readonly inputCostUsd: number;
  readonly model: string;
  readonly outputCostUsd: number;
  readonly outputTokens: number;
  readonly priceVersion: string;
  readonly promptTokens: number;
  readonly provider: LlmProviderKind;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
}

export interface LlmGenerationMetadata {
  cost?: LlmCostBreakdown;
  model: string;
  provider: LlmProviderKind;
  quality?: GenerationQualityMetadata;
  requestId?: string;
  routing?: LlmRoutingMetadata;
  usage?: LlmUsage;
}

export interface GenerateTextResult {
  readonly finishReason: string;
  readonly metadata: LlmGenerationMetadata;
  readonly model: string;
  readonly text: string;
}

export type ProviderErrorCode = "provider_input" | "provider_response_invalid";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(
    message: string,
    {
      cause,
      code,
      status,
    }: {
      readonly cause?: unknown;
      readonly code: ProviderErrorCode;
      readonly status?: number;
    },
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export class ProviderInputError extends ProviderError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { ...options, code: "provider_input" });
    this.name = "ProviderInputError";
  }
}

export class ProviderResponseError extends ProviderError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {},
  ) {
    super(message, { ...options, code: "provider_response_invalid" });
    this.name = "ProviderResponseError";
  }
}

export type LlmStreamEvent =
  | {
      readonly delta: string;
      readonly type: "delta";
    }
  | {
      readonly finishReason: string;
      readonly metadata: LlmGenerationMetadata;
      readonly type: "done";
    };

export interface LlmModelInfo {
  readonly contextWindowTokens: number;
  readonly id: string;
  readonly maxOutputTokens: number;
  readonly provider: LlmProviderKind;
  readonly supportsStreaming: boolean;
  readonly version: string;
}

export interface LlmProvider {
  readonly kind: LlmProviderKind;
  generate(input: GenerateTextInput): Promise<GenerateTextResult>;
  models(): Promise<LlmModelInfo[]>;
  stream(input: GenerateTextInput): AsyncGenerator<LlmStreamEvent>;
}

export interface GenerationModelPrice {
  readonly inputUsdPerMillionTokens: number;
  readonly model: string;
  readonly outputUsdPerMillionTokens: number;
  readonly provider: LlmProviderKind;
}

export interface GenerationCostTrackerOptions {
  readonly prices: readonly GenerationModelPrice[];
  readonly priceVersion: string;
}

export interface EstimateGenerationCostInput {
  readonly model: string;
  readonly provider: LlmProviderKind;
  readonly usage: LlmUsage;
}

export interface GenerationCostTracker {
  estimate(input: EstimateGenerationCostInput): LlmCostBreakdown;
}

export interface GenerationCacheOptions {
  readonly cache: CacheAdapter;
  readonly cacheVersion?: string | undefined;
  readonly maxEntryBytes?: number | undefined;
  readonly ttlMs?: number | undefined;
}

export interface GenerationCacheKeyInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly generationParameters?: GenerationCacheParameters | undefined;
  readonly hasSessionContext?: boolean | undefined;
  readonly model: string;
  readonly modelVersion: string;
  readonly permissionSnapshot?: readonly string[] | undefined;
  readonly promptTemplateId: string;
  readonly promptTemplateVersion: string;
  readonly provider: LlmProviderKind;
}

export interface GenerationCacheParameters {
  readonly maxOutputTokens?: number | undefined;
  readonly mode?: LlmRouteMode | undefined;
  readonly temperature?: number | undefined;
}

export interface GenerationCache {
  get(input: GenerationCacheKeyInput): Promise<GenerateTextResult | null>;
  key(input: GenerationCacheKeyInput): Promise<string>;
  set(input: GenerationCacheKeyInput, result: GenerateTextResult): Promise<void>;
}

export type GenerationSkipReason = "budget_exhausted" | "model_unavailable";

export type GenerationSkipPathResult =
  | {
      readonly cacheHit: boolean;
      readonly generationSkipped: false;
      readonly result: GenerateTextResult;
      readonly type: "generated";
    }
  | {
      readonly evidenceBundle: EvidenceBundle;
      readonly generationSkipped: true;
      readonly reason: GenerationSkipReason;
      readonly type: "skipped";
    };

export interface GenerationSkipPathOptions {
  readonly cache?: GenerationCache | undefined;
  readonly maxEstimatedCostUsd?: number | undefined;
}

export interface GenerateWithSkipPathInput {
  readonly cacheKey?: GenerationCacheKeyInput | undefined;
  readonly estimatedCostUsd?: number | undefined;
  readonly evidenceBundle: EvidenceBundle;
  generate(): Promise<GenerateTextResult>;
  readonly remainingBudgetUsd?: number | undefined;
}

export interface GenerationSkipPath {
  generate(input: GenerateWithSkipPathInput): Promise<GenerationSkipPathResult>;
}

export interface GenerationCostTrackingProviderOptions {
  readonly provider: LlmProvider;
  readonly tracker: GenerationCostTracker;
}

export type LlmRouteMode = "deep" | "fast" | "research";

export interface LlmRoutingMetadata {
  readonly degraded?: boolean | undefined;
  readonly fallbackFromProvider?: string | undefined;
  readonly fallbackReason?: string | undefined;
  readonly mode: LlmRouteMode;
  readonly policyVersion: string;
  readonly provider: string;
}

export interface LlmRouteFallbackPolicy {
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly provider: string;
  readonly temperature?: number | undefined;
}

export interface LlmRoutePolicy {
  readonly fallback?: LlmRouteFallbackPolicy | undefined;
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly provider: string;
  readonly temperature?: number;
}

export interface LlmRouterOptions {
  readonly defaultMode?: LlmRouteMode;
  readonly policies: Partial<Record<LlmRouteMode, LlmRoutePolicy>>;
  readonly policyVersion: string;
  readonly providers: Readonly<Record<string, LlmProvider>>;
}

export type RouteLlmInput = Omit<GenerateTextInput, "model"> & {
  readonly mode?: LlmRouteMode;
};

export interface ResolvedLlmRoute {
  readonly input: GenerateTextInput;
  readonly metadata: LlmRoutingMetadata;
  readonly provider: LlmProvider;
}

export interface LlmRouter {
  generate(input: RouteLlmInput): Promise<GenerateTextResult>;
  select(input: RouteLlmInput): ResolvedLlmRoute;
  stream(input: RouteLlmInput): AsyncGenerator<LlmStreamEvent>;
}

export interface GoldenQuestionGenerationSourceNode {
  readonly id: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly sectionPath?: readonly string[] | undefined;
  readonly text: string;
}

export type GoldenQuestionProposalStatus = "approved" | "pending_review" | "rejected";

export interface GeneratedGoldenQuestionProposal {
  readonly createdAt: string;
  readonly expectedEvidenceIds: readonly string[];
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly question: string;
  readonly rejectionReason?: string | undefined;
  readonly reviewedAt?: string | undefined;
  readonly reviewerId?: string | undefined;
  readonly sourceNodeIds: readonly string[];
  readonly status: GoldenQuestionProposalStatus;
  readonly tags: readonly string[];
}

export interface GenerateGoldenQuestionsInput {
  readonly knowledgeSpaceId: string;
  readonly maxQuestions?: number | undefined;
  readonly sourceNodes: readonly GoldenQuestionGenerationSourceNode[];
  readonly tags?: readonly string[] | undefined;
}

export interface GenerateGoldenQuestionsResult {
  readonly metadata: {
    readonly model: string;
    readonly provider: LlmProviderKind;
    readonly sourceNodeCount: number;
  };
  readonly proposals: readonly GeneratedGoldenQuestionProposal[];
}

export interface AutomaticGoldenQuestionGenerator {
  generate(input: GenerateGoldenQuestionsInput): Promise<GenerateGoldenQuestionsResult>;
}

export interface AutomaticGoldenQuestionGeneratorOptions {
  readonly generateId?: (() => string) | undefined;
  readonly maxQuestionsPerRun?: number | undefined;
  readonly maxSourceNodes?: number | undefined;
  readonly maxSourceTextBytes?: number | undefined;
  readonly model: string;
  readonly now?: (() => string) | undefined;
  readonly provider: LlmProvider;
}

export interface GoldenQuestionInputFromProposal {
  readonly expectedEvidenceIds: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly question: string;
  readonly tags: readonly string[];
}

export interface ApproveGoldenQuestionProposalInput {
  readonly proposal: GeneratedGoldenQuestionProposal;
  readonly reviewerId: string;
}

export interface ApproveGoldenQuestionProposalResult {
  readonly goldenQuestion: GoldenQuestionInputFromProposal;
  readonly proposal: GeneratedGoldenQuestionProposal;
}

export interface RejectGoldenQuestionProposalInput {
  readonly proposal: GeneratedGoldenQuestionProposal;
  readonly reason: string;
  readonly reviewerId: string;
}

export interface GoldenQuestionReviewWorkflowOptions {
  readonly now?: (() => string) | undefined;
}

export interface GoldenQuestionReviewWorkflow {
  approve(input: ApproveGoldenQuestionProposalInput): ApproveGoldenQuestionProposalResult;
  reject(input: RejectGoldenQuestionProposalInput): GeneratedGoldenQuestionProposal;
}

export interface ContextWindowPackerOptions {
  readonly compute: ComputeRuntime;
  readonly defaultSafetyMarginTokens?: number;
}

export interface PackContextWindowInput {
  readonly contextWindowTokens: number;
  readonly evidenceBundle: EvidenceBundle;
  readonly evidenceConfig?: PackEvidenceConfig | undefined;
  readonly model: string;
  readonly outputTokens: number;
  readonly safetyMarginTokens?: number | undefined;
  readonly systemPrompt: string;
}

export interface PackedContextWindow {
  readonly budgets: PackedContextWindowBudgets;
  readonly model: string;
  readonly packedEvidence: PackedEvidence;
  readonly systemPrompt: string;
}

export interface PackedContextWindowBudgets {
  readonly contextWindowTokens: number;
  readonly evidenceTokens: number;
  readonly outputTokens: number;
  readonly remainingTokens: number;
  readonly safetyMarginTokens: number;
  readonly systemTokens: number;
}

export interface ContextWindowPacker {
  pack(input: PackContextWindowInput): PackedContextWindow;
}

export interface CitationNormalizerOptions {
  readonly maxAnswerBytes?: number | undefined;
  readonly maxCitations?: number | undefined;
}

export interface NormalizeCitationsInput {
  readonly evidenceItems: readonly PackedEvidenceItem[];
  readonly text: string;
}

export interface NormalizedCitation {
  readonly citations: unknown[];
  readonly marker: string;
  readonly nodeId: string;
  readonly score: number;
}

export interface NormalizedCitations {
  readonly citations: NormalizedCitation[];
  readonly orphanMarkers: string[];
  readonly text: string;
}

export interface CitationNormalizer {
  normalize(input: NormalizeCitationsInput): NormalizedCitations;
}

export type ClaimEvidenceAlignmentStatus = "grounded" | "ungrounded";
export type ClaimEvidenceAlignmentCheckerKind = "llm-judge" | "rule-based";

export interface ClaimEvidenceAlignmentOptions {
  readonly maxAnswerBytes?: number | undefined;
  readonly maxClaimBytes?: number | undefined;
  readonly maxClaims?: number | undefined;
  readonly minOverlapTerms?: number | undefined;
  readonly mode?: LlmRouteMode | undefined;
}

export interface ClaimEvidenceAlignmentInput {
  readonly citations: readonly NormalizedCitation[];
  readonly evidenceItems: readonly PackedEvidenceItem[];
  readonly mode?: LlmRouteMode | undefined;
  readonly text: string;
}

export interface ClaimEvidenceAlignmentClaim {
  readonly evidenceMarkers: string[];
  readonly evidenceNodeIds: string[];
  readonly reason: string;
  readonly status: ClaimEvidenceAlignmentStatus;
  readonly text: string;
}

export interface ClaimEvidenceAlignmentMetadata {
  readonly checker: ClaimEvidenceAlignmentCheckerKind;
  readonly checkedClaims: number;
  readonly evidenceReferences: number;
  readonly mode: LlmRouteMode;
  readonly model?: string | undefined;
}

export interface ClaimEvidenceAlignmentReport {
  readonly claims: ClaimEvidenceAlignmentClaim[];
  readonly metadata: ClaimEvidenceAlignmentMetadata;
  readonly ungroundedClaims: ClaimEvidenceAlignmentClaim[];
}

export interface ClaimEvidenceAlignmentChecker {
  check(
    input: ClaimEvidenceAlignmentInput,
  ): ClaimEvidenceAlignmentReport | Promise<ClaimEvidenceAlignmentReport>;
}

export interface LlmClaimEvidenceAlignmentJudgeOptions extends ClaimEvidenceAlignmentOptions {
  readonly maxEvidenceBytes?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly provider: LlmProvider;
}

export type GenerationQualityFlag = "stale-evidence" | "ungrounded-claims";

export interface StaleEvidenceFlag {
  readonly marker: string;
  readonly nodeId: string;
  readonly observedAt?: string | undefined;
  readonly sourceUpdatedAt?: string | undefined;
  readonly status: "stale";
}

export interface GenerationQualityMetadata {
  readonly alignment: ClaimEvidenceAlignmentMetadata;
  readonly flags: GenerationQualityFlag[];
  readonly staleEvidence: StaleEvidenceFlag[];
  readonly staleEvidenceCount: number;
  readonly ungroundedClaimCount: number;
  readonly ungroundedClaims: ClaimEvidenceAlignmentClaim[];
}

export interface GenerationQualityFlaggerInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly evidenceItems: readonly PackedEvidenceItem[];
  readonly mode: LlmRouteMode;
  readonly normalized: NormalizedCitations;
  readonly result: GenerateTextResult;
}

export interface GenerationQualityFlaggerOptions {
  readonly alignmentChecker?: ClaimEvidenceAlignmentChecker | undefined;
}

export interface GenerationQualityFlagger {
  flag(input: GenerationQualityFlaggerInput): Promise<GenerateTextResult>;
}

export interface EvidencePromptTemplateRenderInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly packedContextWindow: PackedContextWindow;
  readonly query: string;
}

export interface EvidencePromptTemplate {
  readonly id: string;
  readonly mode: LlmRouteMode;
  render(input: EvidencePromptTemplateRenderInput): readonly LlmMessage[];
  readonly version: string;
}

export interface EvidencePromptTemplateRegistryOptions {
  readonly maxEvidenceContextBytes?: number | undefined;
  readonly maxQueryBytes?: number | undefined;
  readonly templates?: readonly EvidencePromptTemplate[] | undefined;
}

export interface RenderEvidencePromptInput extends EvidencePromptTemplateRenderInput {
  readonly mode: LlmRouteMode;
}

export interface EvidencePromptTemplateMetadata {
  readonly answerabilityState: EvidenceBundle["state"];
  readonly evidenceItemCount: number;
  readonly mode: LlmRouteMode;
  readonly omittedEvidenceCount: number;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly usedEvidenceTokens: number;
}

export interface RenderedEvidencePrompt {
  readonly messages: LlmMessage[];
  readonly metadata: EvidencePromptTemplateMetadata;
}

export interface EvidencePromptTemplateRegistry {
  render(input: RenderEvidencePromptInput): RenderedEvidencePrompt;
}

export interface StaticLlmProviderOptions {
  readonly model: string;
  readonly provider?: "static";
  readonly response: string;
}

interface ProviderRuntimeOptions {
  readonly fetchImpl: typeof fetch;
  readonly maxMessages: number;
  readonly maxOutputTokens: number;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  readonly maxTextBytes: number;
  readonly retryDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

interface ValidatedGoldenQuestionGenerationInput {
  readonly knowledgeSpaceId: string;
  readonly maxQuestions: number;
  readonly sourceNodes: readonly Required<
    Pick<GoldenQuestionGenerationSourceNode, "id" | "metadata" | "sectionPath" | "text">
  >[];
  readonly tags: readonly string[];
}

const defaultMaxMessages = 64;
const defaultMaxEvidenceContextBytes = 256 * 1024;
const defaultMaxOutputTokens = 4096;
const defaultMaxPromptQueryBytes = 16 * 1024;
const defaultMaxResponseBytes = 8 * 1024 * 1024;
const defaultMaxRetries = 0;
const defaultRetryDelayMs = 100;
const defaultMaxTextBytes = 256 * 1024;
const defaultMaxNormalizedAnswerBytes = 256 * 1024;
const defaultMaxNormalizedCitations = 200;
const defaultMaxClaimEvidenceAnswerBytes = 256 * 1024;
const defaultMaxClaimEvidenceClaimBytes = 16 * 1024;
const defaultMaxClaimEvidenceClaims = 100;
const defaultMaxClaimEvidenceContextBytes = 256 * 1024;
const defaultClaimEvidenceJudgeOutputTokens = 1024;
const defaultGenerationCacheEntryBytes = 1024 * 1024;
const defaultGenerationCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const defaultMaxGoldenQuestionSourceNodes = 20;
const defaultMaxGoldenQuestionSourceTextBytes = 8 * 1024;
const defaultMaxGoldenQuestionsPerRun = 10;
const textEncoder = new TextEncoder();

const LlmUsageSchema = z.object({
  completionTokens: z.number().int().nonnegative().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

const LlmCostBreakdownSchema = z.object({
  completionTokens: z.number().int().nonnegative(),
  currency: z.literal("USD"),
  inputCostUsd: z.number().nonnegative(),
  model: z.string().min(1),
  outputCostUsd: z.number().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  priceVersion: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  provider: z.enum(["anthropic", "gemini", "openai", "static"]),
  totalCostUsd: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

const LlmRoutingMetadataSchema = z.object({
  mode: z.enum(["deep", "fast", "research"]),
  policyVersion: z.string().min(1),
  provider: z.string().min(1),
});

const ClaimEvidenceAlignmentClaimSchema = z
  .object({
    evidenceMarkers: z.array(z.string()),
    evidenceNodeIds: z.array(z.string()),
    reason: z.string().min(1),
    status: z.enum(["grounded", "ungrounded"]),
    text: z.string().min(1),
  })
  .strict();

const ClaimEvidenceAlignmentMetadataSchema = z
  .object({
    checker: z.enum(["llm-judge", "rule-based"]),
    checkedClaims: z.number().int().nonnegative(),
    evidenceReferences: z.number().int().nonnegative(),
    mode: z.enum(["deep", "fast", "research"]),
    model: z.string().min(1).optional(),
  })
  .strict();

const GenerationQualityMetadataSchema = z
  .object({
    alignment: ClaimEvidenceAlignmentMetadataSchema,
    flags: z.array(z.enum(["stale-evidence", "ungrounded-claims"])),
    staleEvidence: z.array(
      z
        .object({
          marker: z.string().min(1),
          nodeId: z.string().min(1),
          observedAt: z.string().optional(),
          sourceUpdatedAt: z.string().optional(),
          status: z.literal("stale"),
        })
        .strict(),
    ),
    staleEvidenceCount: z.number().int().nonnegative(),
    ungroundedClaimCount: z.number().int().nonnegative(),
    ungroundedClaims: z.array(ClaimEvidenceAlignmentClaimSchema),
  })
  .strict();

const LlmGenerationMetadataSchema = z.object({
  cost: LlmCostBreakdownSchema.optional(),
  model: z.string().min(1),
  provider: z.enum(["anthropic", "gemini", "openai", "static"]),
  quality: GenerationQualityMetadataSchema.optional(),
  requestId: z.string().optional(),
  routing: LlmRoutingMetadataSchema.optional(),
  usage: LlmUsageSchema.optional(),
});

const GeneratedQuestionResponseSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            expectedEvidenceIds: z.array(z.string().min(1)).min(1),
            metadata: z.record(z.unknown()).default({}),
            question: z.string().min(1).max(4000),
            tags: z.array(z.string().min(1).max(80)).default([]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const GenerateTextResultSchema = z.object({
  finishReason: z.string().min(1),
  metadata: LlmGenerationMetadataSchema,
  model: z.string().min(1),
  text: z.string(),
});

const ClaimEvidenceJudgeOutputSchema = z
  .object({
    claims: z.array(
      z
        .object({
          evidenceMarkers: z.array(z.string().min(1)).default([]),
          reason: z.string().min(1).default("judge-assessed"),
          status: z.enum(["grounded", "ungrounded"]),
          text: z.string().min(1),
        })
        .strict(),
    ),
    summary: z.string().optional(),
  })
  .strict();

export interface DifyModelRuntimeLlmProviderOptions {
  readonly client: DifyModelRuntimeClient;
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly models?: readonly LlmModelInfo[] | undefined;
  readonly pluginId: string;
  readonly provider: string;
}

const DifyModelRuntimeLlmChunkSchema = z.object({
  delta: z
    .object({
      finish_reason: z.string().nullish(),
      message: z.object({ content: z.string().nullish() }).partial().optional(),
      usage: z
        .object({
          completion_tokens: z.number(),
          prompt_tokens: z.number(),
          total_tokens: z.number(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
  model: z.string().optional(),
});

/**
 * LlmProvider backed by Dify's tenant-bound ModelManager/ModelInstance runtime.
 */
export function createDifyModelRuntimeLlmProvider(
  options: DifyModelRuntimeLlmProviderOptions,
): LlmProvider {
  if (!options.pluginId.trim()) {
    throw new ProviderInputError("Dify model runtime LLM pluginId is required");
  }

  if (!options.provider.trim()) {
    throw new ProviderInputError("Dify model runtime LLM provider is required");
  }

  if (!options.model.trim()) {
    throw new ProviderInputError("Dify model runtime LLM model is required");
  }

  const models = (options.models ?? [defaultDifyModelRuntimeLlmModel(options)]).map((model) => ({
    ...model,
  }));

  async function* streamInternal(input: GenerateTextInput): AsyncGenerator<LlmStreamEvent> {
    if (!input.model.trim()) {
      throw new ProviderInputError("Dify model runtime LLM model is required");
    }

    const tenantId = input.tenantId?.trim();

    if (!tenantId) {
      throw new ProviderInputError("Dify model runtime LLM requires a tenantId");
    }

    const maxTokens = input.maxOutputTokens ?? options.maxOutputTokens;
    let model = input.model;
    let finishReason = "stop";
    let usage: LlmUsage | undefined;

    for await (const chunk of options.client.invokeLlm({
      completionParams: {
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      },
      model: input.model,
      pluginId: options.pluginId,
      promptMessages: input.messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      provider: options.provider,
      tenantId,
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      const parsed = DifyModelRuntimeLlmChunkSchema.safeParse(chunk);

      if (!parsed.success) {
        continue;
      }

      if (parsed.data.model) {
        model = parsed.data.model;
      }

      const content = parsed.data.delta?.message?.content;

      if (content) {
        yield { delta: content, type: "delta" };
      }

      const chunkUsage = parsed.data.delta?.usage;

      if (chunkUsage) {
        usage = {
          ...(chunkUsage.completion_tokens === undefined
            ? {}
            : { completionTokens: chunkUsage.completion_tokens }),
          ...(chunkUsage.prompt_tokens === undefined
            ? {}
            : { promptTokens: chunkUsage.prompt_tokens }),
          ...(chunkUsage.total_tokens === undefined
            ? {}
            : { totalTokens: chunkUsage.total_tokens }),
        };
      }

      if (parsed.data.delta?.finish_reason) {
        finishReason = parsed.data.delta.finish_reason;
      }
    }

    yield {
      finishReason,
      metadata: { model, provider: "dify-model-runtime", ...(usage ? { usage } : {}) },
      type: "done",
    };
  }

  return {
    generate: async (input) => {
      let text = "";
      let done: Extract<LlmStreamEvent, { type: "done" }> | undefined;

      for await (const event of streamInternal(input)) {
        if (event.type === "delta") {
          text += event.delta;
        } else {
          done = event;
        }
      }

      return {
        finishReason: done?.finishReason ?? "stop",
        metadata: done?.metadata ?? { model: input.model, provider: "dify-model-runtime" },
        model: done?.metadata.model ?? input.model,
        text,
      };
    },
    kind: "dify-model-runtime",
    models: async () => models.map((model) => ({ ...model })),
    stream: (input) => streamInternal(input),
  };
}

function defaultDifyModelRuntimeLlmModel(
  options: DifyModelRuntimeLlmProviderOptions,
): LlmModelInfo {
  return {
    contextWindowTokens: 128_000,
    id: options.model,
    maxOutputTokens: options.maxOutputTokens ?? 4_096,
    provider: "dify-model-runtime",
    supportsStreaming: true,
    version: "dify-model-runtime",
  };
}

export function createStaticLlmProvider({
  model,
  response,
}: StaticLlmProviderOptions): LlmProvider {
  const models = [
    {
      contextWindowTokens: 1_000_000,
      id: model,
      maxOutputTokens: 1_000_000,
      provider: "static" as const,
      supportsStreaming: true,
      version: "static-v1",
    },
  ];

  return {
    kind: "static",
    generate: async (input) => {
      validateGenerateInput(input, {
        fetchImpl: fetch,
        maxMessages: defaultMaxMessages,
        maxOutputTokens: 1_000_000,
        maxResponseBytes: defaultMaxResponseBytes,
        maxRetries: defaultMaxRetries,
        maxTextBytes: defaultMaxTextBytes,
        retryDelayMs: defaultRetryDelayMs,
        sleep: sleepMs,
      });

      return {
        finishReason: "stop",
        metadata: {
          model,
          provider: "static",
        },
        model,
        text: response,
      };
    },
    models: async () => cloneModels(models),
    stream: async function* (input) {
      validateGenerateInput(input, {
        fetchImpl: fetch,
        maxMessages: defaultMaxMessages,
        maxOutputTokens: 1_000_000,
        maxResponseBytes: defaultMaxResponseBytes,
        maxRetries: defaultMaxRetries,
        maxTextBytes: defaultMaxTextBytes,
        retryDelayMs: defaultRetryDelayMs,
        sleep: sleepMs,
      });
      yield { delta: response, type: "delta" };
      yield {
        finishReason: "stop",
        metadata: { model, provider: "static" },
        type: "done",
      };
    },
  };
}

export function createAutomaticGoldenQuestionGenerator({
  generateId = () => crypto.randomUUID(),
  maxQuestionsPerRun = defaultMaxGoldenQuestionsPerRun,
  maxSourceNodes = defaultMaxGoldenQuestionSourceNodes,
  maxSourceTextBytes = defaultMaxGoldenQuestionSourceTextBytes,
  model,
  now = () => new Date().toISOString(),
  provider,
}: AutomaticGoldenQuestionGeneratorOptions): AutomaticGoldenQuestionGenerator {
  validatePositiveInteger(maxQuestionsPerRun, "maxQuestionsPerRun");
  validatePositiveInteger(maxSourceNodes, "maxSourceNodes");
  validatePositiveInteger(maxSourceTextBytes, "maxSourceTextBytes");

  if (!model.trim()) {
    throw new Error("Golden question generation model is required");
  }

  return {
    generate: async (input) => {
      const validated = validateGoldenQuestionGenerationInput(input, {
        maxQuestionsPerRun,
        maxSourceNodes,
        maxSourceTextBytes,
      });
      const response = await provider.generate({
        maxOutputTokens: 800,
        messages: renderGoldenQuestionGenerationMessages(validated),
        model,
        temperature: 0.2,
      });
      const parsed = parseGeneratedQuestionResponse(response.text, validated.maxQuestions);
      const sourceNodeIds = new Set(validated.sourceNodes.map((node) => node.id));

      return {
        metadata: {
          model,
          provider: response.metadata.provider,
          sourceNodeCount: validated.sourceNodes.length,
        },
        proposals: parsed.questions.map((question) => {
          for (const evidenceId of question.expectedEvidenceIds) {
            if (!sourceNodeIds.has(evidenceId)) {
              throw new Error(
                "Golden question generation expectedEvidenceIds must reference source nodes",
              );
            }
          }

          const tags = uniqueTrimmedStrings([...validated.tags, ...(question.tags ?? [])]);

          return {
            createdAt: now(),
            expectedEvidenceIds: [...question.expectedEvidenceIds],
            id: generateId(),
            knowledgeSpaceId: validated.knowledgeSpaceId,
            metadata: {
              ...question.metadata,
              generatedBy: {
                model,
                provider: response.metadata.provider,
              },
            },
            question: question.question,
            sourceNodeIds: [...sourceNodeIds],
            status: "pending_review" as const,
            tags,
          };
        }),
      };
    },
  };
}

export function createGoldenQuestionReviewWorkflow({
  now = () => new Date().toISOString(),
}: GoldenQuestionReviewWorkflowOptions = {}): GoldenQuestionReviewWorkflow {
  return {
    approve: ({ proposal, reviewerId }) => {
      validatePendingProposal(proposal);
      const reviewer = requiredString(reviewerId, "reviewerId");
      const reviewedAt = now();
      const approvedProposal: GeneratedGoldenQuestionProposal = {
        ...proposal,
        reviewedAt,
        reviewerId: reviewer,
        status: "approved",
      };

      return {
        goldenQuestion: {
          expectedEvidenceIds: [...proposal.expectedEvidenceIds],
          knowledgeSpaceId: proposal.knowledgeSpaceId,
          metadata: {
            ...proposal.metadata,
            approvedAt: reviewedAt,
            generatedQuestionProposalId: proposal.id,
            reviewedBy: reviewer,
          },
          question: proposal.question,
          tags: [...proposal.tags],
        },
        proposal: approvedProposal,
      };
    },
    reject: ({ proposal, reason, reviewerId }) => {
      validatePendingProposal(proposal);
      const reviewer = requiredString(reviewerId, "reviewerId");
      const rejectionReason = requiredString(reason, "reason");

      return {
        ...proposal,
        rejectionReason,
        reviewedAt: now(),
        reviewerId: reviewer,
        status: "rejected",
      };
    },
  };
}

export function createGenerationCostTracker({
  prices,
  priceVersion,
}: GenerationCostTrackerOptions): GenerationCostTracker {
  if (!priceVersion.trim()) {
    throw new Error("Generation cost priceVersion is required");
  }

  const pricesByModel = new Map<string, GenerationModelPrice>();

  for (const price of prices) {
    validateGenerationModelPrice(price);
    const key = generationPriceKey(price.provider, price.model);

    if (pricesByModel.has(key)) {
      throw new Error(
        `Generation pricing is already configured for ${price.provider}/${price.model}`,
      );
    }

    pricesByModel.set(key, { ...price });
  }

  return {
    estimate({ model, provider, usage }) {
      const price = pricesByModel.get(generationPriceKey(provider, model));

      if (!price) {
        throw new Error(`Generation pricing is not configured for ${provider}/${model}`);
      }

      const promptTokens = usage.promptTokens ?? 0;
      const completionTokens = usage.completionTokens ?? 0;
      const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
      validateGenerationUsageTokens({ completionTokens, promptTokens, totalTokens });

      const inputCostUsd = (promptTokens / 1_000_000) * price.inputUsdPerMillionTokens;
      const outputCostUsd = (completionTokens / 1_000_000) * price.outputUsdPerMillionTokens;

      return {
        completionTokens,
        currency: "USD",
        inputCostUsd,
        model,
        outputCostUsd,
        outputTokens: completionTokens,
        priceVersion,
        promptTokens,
        provider,
        totalCostUsd: inputCostUsd + outputCostUsd,
        totalTokens,
      };
    },
  };
}

export function withGenerationCostTracking({
  provider,
  tracker,
}: GenerationCostTrackingProviderOptions): LlmProvider {
  return {
    kind: provider.kind,
    generate: async (input) => {
      const result = await provider.generate(input);

      return {
        ...result,
        metadata: addGenerationCost(result.metadata, tracker),
      };
    },
    models: () => provider.models(),
    stream: async function* (input) {
      for await (const event of provider.stream(input)) {
        if (event.type === "done") {
          yield {
            ...event,
            metadata: addGenerationCost(event.metadata, tracker),
          };
          continue;
        }

        yield event;
      }
    },
  };
}

export function createGenerationCache({
  cache,
  cacheVersion = "generation-cache-v1",
  maxEntryBytes = defaultGenerationCacheEntryBytes,
  ttlMs = defaultGenerationCacheTtlMs,
}: GenerationCacheOptions): GenerationCache {
  if (!cacheVersion.trim()) {
    throw new Error("Generation cache cacheVersion is required");
  }

  if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1) {
    throw new Error("Generation cache maxEntryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Generation cache ttlMs must be at least 1");
  }

  const keyFor = async (input: GenerationCacheKeyInput): Promise<string> => {
    if (input.hasSessionContext) {
      throw new Error("Generation cache is disabled for session-context prompts");
    }

    return generationCacheKey(input, cacheVersion);
  };

  return {
    async get(input) {
      if (input.hasSessionContext) {
        return null;
      }

      const key = await keyFor(input);
      const cached = await cache.get(key);

      if (!cached) {
        return null;
      }

      if (cached.byteLength > maxEntryBytes) {
        return null;
      }

      try {
        return parseGenerateTextResult(JSON.parse(new TextDecoder().decode(cached)));
      } catch {
        return null;
      }
    },
    key: keyFor,
    async set(input, result) {
      if (input.hasSessionContext) {
        return;
      }

      const parsed = parseGenerateTextResult(result);
      const bytes = textEncoder.encode(JSON.stringify(parsed));

      if (bytes.byteLength > maxEntryBytes) {
        throw new Error(`Generation cache entry exceeds maxEntryBytes=${maxEntryBytes}`);
      }

      await cache.set(await keyFor(input), bytes, { ttlMs });
    },
  };
}

export class GenerationModelUnavailableError extends Error {
  constructor(message = "Generation model is unavailable") {
    super(message);
    this.name = "GenerationModelUnavailableError";
  }
}

export function createGenerationSkipPath({
  cache,
  maxEstimatedCostUsd,
}: GenerationSkipPathOptions = {}): GenerationSkipPath {
  if (
    maxEstimatedCostUsd !== undefined &&
    (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd < 0)
  ) {
    throw new Error("Generation skip path maxEstimatedCostUsd must be non-negative");
  }

  return {
    async generate(input) {
      const evidenceBundle = cloneEvidenceBundle(input.evidenceBundle);
      validateGenerationBudget(input.estimatedCostUsd, "estimatedCostUsd");
      validateGenerationBudget(input.remainingBudgetUsd, "remainingBudgetUsd");

      if (
        input.estimatedCostUsd !== undefined &&
        ((input.remainingBudgetUsd !== undefined &&
          input.estimatedCostUsd > input.remainingBudgetUsd) ||
          (maxEstimatedCostUsd !== undefined && input.estimatedCostUsd > maxEstimatedCostUsd))
      ) {
        return {
          evidenceBundle,
          generationSkipped: true,
          reason: "budget_exhausted",
          type: "skipped",
        };
      }

      if (cache && input.cacheKey) {
        const cached = await cache.get(input.cacheKey);

        if (cached) {
          return {
            cacheHit: true,
            generationSkipped: false,
            result: cached,
            type: "generated",
          };
        }
      }

      try {
        const result = cloneGenerateTextResult(await input.generate());

        if (cache && input.cacheKey) {
          await cache.set(input.cacheKey, result);
        }

        return {
          cacheHit: false,
          generationSkipped: false,
          result,
          type: "generated",
        };
      } catch (error) {
        if (error instanceof GenerationModelUnavailableError) {
          return {
            evidenceBundle,
            generationSkipped: true,
            reason: "model_unavailable",
            type: "skipped",
          };
        }

        throw error;
      }
    },
  };
}

export function createCitationNormalizer({
  maxAnswerBytes = defaultMaxNormalizedAnswerBytes,
  maxCitations = defaultMaxNormalizedCitations,
}: CitationNormalizerOptions = {}): CitationNormalizer {
  if (!Number.isSafeInteger(maxAnswerBytes) || maxAnswerBytes < 1) {
    throw new Error("Citation normalization maxAnswerBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxCitations) || maxCitations < 1) {
    throw new Error("Citation normalization maxCitations must be at least 1");
  }

  return {
    normalize({ evidenceItems, text }) {
      if (byteLength(text) > maxAnswerBytes) {
        throw new Error(`Citation normalization answer exceeds maxAnswerBytes=${maxAnswerBytes}`);
      }

      const evidenceByMarker = new Map<string, PackedEvidenceItem>();

      for (const item of evidenceItems) {
        if (evidenceByMarker.has(item.marker)) {
          throw new Error(`Citation normalization evidence marker ${item.marker} is duplicated`);
        }

        evidenceByMarker.set(item.marker, item);
      }

      const citedMarkers = uniqueStrings(
        [...text.matchAll(/\[(E\d+)\]/g)].map((match) => match[1] ?? ""),
      );
      const validMarkers = citedMarkers.filter((marker) => evidenceByMarker.has(marker));
      const orphanMarkers = citedMarkers.filter((marker) => !evidenceByMarker.has(marker));

      if (validMarkers.length > maxCitations) {
        throw new Error(
          `Citation normalization citation count exceeds maxCitations=${maxCitations}`,
        );
      }

      let normalizedText = text;
      for (const marker of orphanMarkers) {
        normalizedText = normalizedText.replaceAll(`[${marker}]`, "");
      }

      return {
        citations: validMarkers.map((marker) => {
          const item = evidenceByMarker.get(marker);

          if (!item) {
            throw new Error(`Citation normalization evidence marker ${marker} is missing`);
          }

          return {
            citations: item.citations.map((citation) => cloneJson(citation)),
            marker,
            nodeId: item.nodeId,
            score: item.score,
          };
        }),
        orphanMarkers,
        text: cleanupCitationText(normalizedText),
      };
    },
  };
}

export function createClaimEvidenceAlignmentChecker({
  maxAnswerBytes = defaultMaxClaimEvidenceAnswerBytes,
  maxClaimBytes = defaultMaxClaimEvidenceClaimBytes,
  maxClaims = defaultMaxClaimEvidenceClaims,
  minOverlapTerms = 1,
  mode = "fast",
}: ClaimEvidenceAlignmentOptions = {}): ClaimEvidenceAlignmentChecker {
  validateClaimEvidenceAlignmentOptions({
    maxAnswerBytes,
    maxClaimBytes,
    maxClaims,
    minOverlapTerms,
  });

  return {
    check(input) {
      const effectiveMode = input.mode ?? mode;
      const claims = extractClaimTexts(input.text, { maxAnswerBytes, maxClaimBytes, maxClaims });
      const citationsByMarker = normalizedCitationsByMarker(input.citations);
      const evidenceByMarker = packedEvidenceByMarker(input.evidenceItems);
      const alignedClaims = claims.map((claimText) =>
        alignClaimWithEvidence({
          citationsByMarker,
          claimText,
          evidenceByMarker,
          minOverlapTerms,
        }),
      );

      return claimEvidenceAlignmentReport({
        checker: "rule-based",
        claims: alignedClaims,
        mode: effectiveMode,
      });
    },
  };
}

export function createLlmClaimEvidenceAlignmentJudge({
  maxAnswerBytes = defaultMaxClaimEvidenceAnswerBytes,
  maxClaimBytes = defaultMaxClaimEvidenceClaimBytes,
  maxClaims = defaultMaxClaimEvidenceClaims,
  maxEvidenceBytes = defaultMaxClaimEvidenceContextBytes,
  maxOutputTokens = defaultClaimEvidenceJudgeOutputTokens,
  minOverlapTerms = 1,
  mode = "deep",
  model,
  provider,
}: LlmClaimEvidenceAlignmentJudgeOptions): ClaimEvidenceAlignmentChecker {
  validateClaimEvidenceAlignmentOptions({
    maxAnswerBytes,
    maxClaimBytes,
    maxClaims,
    minOverlapTerms,
  });

  if (!Number.isSafeInteger(maxEvidenceBytes) || maxEvidenceBytes < 1) {
    throw new Error("Claim-evidence alignment maxEvidenceBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Claim-evidence alignment maxOutputTokens must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Claim-evidence alignment judge model is required");
  }

  return {
    async check(input) {
      const effectiveMode = input.mode ?? mode;
      const claims = extractClaimTexts(input.text, { maxAnswerBytes, maxClaimBytes, maxClaims });
      const evidenceContext = claimEvidenceContext(input.evidenceItems, maxEvidenceBytes);
      const result = await provider.generate({
        maxOutputTokens,
        messages: [
          {
            content:
              "You judge whether answer claims are grounded in the supplied evidence. Return only JSON with a claims array. Each claim needs text, status, evidenceMarkers, and reason.",
            role: "system",
          },
          {
            content: [
              `Mode: ${effectiveMode}`,
              "Answer:",
              input.text,
              "",
              "Detected claims:",
              claims.map((claim, index) => `${index + 1}. ${claim}`).join("\n"),
              "",
              "Evidence:",
              evidenceContext || "(no evidence)",
            ].join("\n"),
            role: "user",
          },
        ],
        model,
        temperature: 0,
      });
      const parsed = parseClaimEvidenceJudgeOutput(result.text, maxClaims);
      const citationsByMarker = normalizedCitationsByMarker(input.citations);
      const alignedClaims = parsed.claims.map((claim) =>
        claimEvidenceAlignmentClaim({
          evidenceMarkers: claim.evidenceMarkers.filter((marker) => citationsByMarker.has(marker)),
          reason: claim.reason,
          status: claim.status,
          text: claim.text,
          citationsByMarker,
        }),
      );

      return claimEvidenceAlignmentReport({
        checker: "llm-judge",
        claims: alignedClaims,
        mode: effectiveMode,
        model,
      });
    },
  };
}

export function createGenerationQualityFlagger({
  alignmentChecker = createClaimEvidenceAlignmentChecker(),
}: GenerationQualityFlaggerOptions = {}): GenerationQualityFlagger {
  return {
    async flag(input) {
      const evidenceBundle = cloneEvidenceBundle(input.evidenceBundle);
      const alignment = await alignmentChecker.check({
        citations: input.normalized.citations,
        evidenceItems: input.evidenceItems,
        mode: input.mode,
        text: input.normalized.text,
      });
      const staleEvidence = staleEvidenceFlags({
        citations: input.normalized.citations,
        evidenceBundle,
      });
      const flags: GenerationQualityFlag[] = [
        ...(alignment.ungroundedClaims.length > 0
          ? (["ungrounded-claims"] as GenerationQualityFlag[])
          : []),
        ...(staleEvidence.length > 0 ? (["stale-evidence"] as GenerationQualityFlag[]) : []),
      ];

      return cloneGenerateTextResult({
        ...input.result,
        metadata: {
          ...input.result.metadata,
          quality: {
            alignment: { ...alignment.metadata },
            flags,
            staleEvidence,
            staleEvidenceCount: staleEvidence.length,
            ungroundedClaimCount: alignment.ungroundedClaims.length,
            ungroundedClaims: alignment.ungroundedClaims.map(cloneClaimEvidenceAlignmentClaim),
          },
        },
      });
    },
  };
}

export function createLlmRouter({
  defaultMode = "fast",
  policies,
  policyVersion,
  providers,
}: LlmRouterOptions): LlmRouter {
  validateLlmRouterConfig({ defaultMode, policies, policyVersion, providers });

  const select = (input: RouteLlmInput): ResolvedLlmRoute => {
    const mode = input.mode ?? defaultMode;
    const policy = policies[mode];

    if (!policy) {
      throw new Error(`LLM route policy ${mode} is not configured`);
    }

    const provider = providers[policy.provider];

    if (!provider) {
      throw new Error(`LLM route policy ${mode} references unknown provider ${policy.provider}`);
    }

    return resolveLlmRoute({
      input,
      mode,
      policy: {
        maxOutputTokens: policy.maxOutputTokens,
        model: policy.model,
        provider: policy.provider,
        temperature: policy.temperature,
      },
      policyVersion,
      provider,
    });
  };

  const selectFallback = (
    input: RouteLlmInput,
    primaryRoute: ResolvedLlmRoute,
    error: unknown,
  ): ResolvedLlmRoute | null => {
    const mode = input.mode ?? defaultMode;
    const policy = policies[mode];

    if (!policy?.fallback) {
      return null;
    }

    const fallbackProvider = providers[policy.fallback.provider];

    if (!fallbackProvider) {
      throw new Error(
        `LLM route policy ${mode} fallback references unknown provider ${policy.fallback.provider}`,
      );
    }

    return resolveLlmRoute({
      degraded: {
        fallbackFromProvider: primaryRoute.metadata.provider,
        fallbackReason: errorClassName(error),
      },
      input,
      mode,
      policy: {
        maxOutputTokens: policy.fallback.maxOutputTokens ?? policy.maxOutputTokens,
        model: policy.fallback.model,
        provider: policy.fallback.provider,
        temperature: policy.fallback.temperature ?? policy.temperature,
      },
      policyVersion,
      provider: fallbackProvider,
    });
  };

  return {
    generate: async (input) => {
      const route = select(input);
      let result: GenerateTextResult;
      let metadata = route.metadata;

      try {
        result = await route.provider.generate(route.input);
      } catch (error) {
        const fallbackRoute = selectFallback(input, route, error);

        if (!fallbackRoute) {
          throw error;
        }

        result = await fallbackRoute.provider.generate(fallbackRoute.input);
        metadata = fallbackRoute.metadata;
      }

      return {
        ...result,
        metadata: {
          ...result.metadata,
          routing: metadata,
        },
      };
    },
    select,
    stream: async function* (input) {
      const route = select(input);
      let emitted = false;

      try {
        for await (const event of streamWithRouting(route)) {
          emitted = true;
          yield event;
        }
      } catch (error) {
        const fallbackRoute = selectFallback(input, route, error);

        if (!fallbackRoute || emitted) {
          throw error;
        }

        for await (const event of streamWithRouting(fallbackRoute)) {
          yield event;
        }
      }
    },
  };
}

function resolveLlmRoute({
  degraded,
  input,
  mode,
  policy,
  policyVersion,
  provider,
}: {
  readonly degraded?:
    | {
        readonly fallbackFromProvider: string;
        readonly fallbackReason: string;
      }
    | undefined;
  readonly input: RouteLlmInput;
  readonly mode: LlmRouteMode;
  readonly policy: {
    readonly maxOutputTokens: number;
    readonly model: string;
    readonly provider: string;
    readonly temperature?: number | undefined;
  };
  readonly policyVersion: string;
  readonly provider: LlmProvider;
}): ResolvedLlmRoute {
  const maxOutputTokens = Math.min(
    input.maxOutputTokens ?? policy.maxOutputTokens,
    policy.maxOutputTokens,
  );
  const temperature = input.temperature ?? policy.temperature;
  const { mode: _mode, ...providerInput } = input;

  return {
    input: {
      ...providerInput,
      maxOutputTokens,
      messages: input.messages.map((message) => ({ ...message })),
      model: policy.model,
      ...(temperature === undefined ? {} : { temperature }),
    },
    metadata: {
      ...(degraded
        ? {
            degraded: true,
            fallbackFromProvider: degraded.fallbackFromProvider,
            fallbackReason: degraded.fallbackReason,
          }
        : {}),
      mode,
      policyVersion,
      provider: policy.provider,
    },
    provider,
  };
}

async function* streamWithRouting(route: ResolvedLlmRoute): AsyncGenerator<LlmStreamEvent> {
  for await (const event of route.provider.stream(route.input)) {
    if (event.type === "done") {
      yield {
        ...event,
        metadata: {
          ...event.metadata,
          routing: route.metadata,
        },
      };
      continue;
    }

    yield event;
  }
}

function errorClassName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

export function createContextWindowPacker({
  compute,
  defaultSafetyMarginTokens = 256,
}: ContextWindowPackerOptions): ContextWindowPacker {
  if (!Number.isInteger(defaultSafetyMarginTokens) || defaultSafetyMarginTokens < 0) {
    throw new Error("Context window defaultSafetyMarginTokens must be non-negative");
  }

  return {
    pack(input) {
      validateContextWindowInput(input);

      const safetyMarginTokens = input.safetyMarginTokens ?? defaultSafetyMarginTokens;

      if (!Number.isInteger(safetyMarginTokens) || safetyMarginTokens < 0) {
        throw new Error("Context window safetyMarginTokens must be non-negative");
      }

      const systemTokens = compute.countTokens(input.systemPrompt);
      const evidenceBudget =
        input.contextWindowTokens - systemTokens - input.outputTokens - safetyMarginTokens;

      if (evidenceBudget < 1) {
        throw new Error("Context window budget leaves no room for evidence");
      }

      const packedEvidence = compute.packEvidence({
        ...(input.evidenceConfig ? { config: input.evidenceConfig } : {}),
        evidenceBundle: input.evidenceBundle,
        model: input.model,
        tokenBudget: evidenceBudget,
      });

      return {
        budgets: {
          contextWindowTokens: input.contextWindowTokens,
          evidenceTokens: packedEvidence.usedTokens,
          outputTokens: input.outputTokens,
          remainingTokens: evidenceBudget - packedEvidence.usedTokens,
          safetyMarginTokens,
          systemTokens,
        },
        model: input.model,
        packedEvidence,
        systemPrompt: input.systemPrompt,
      };
    },
  };
}

export function createEvidencePromptTemplateRegistry({
  maxEvidenceContextBytes = defaultMaxEvidenceContextBytes,
  maxQueryBytes = defaultMaxPromptQueryBytes,
  templates = defaultEvidencePromptTemplates(),
}: EvidencePromptTemplateRegistryOptions = {}): EvidencePromptTemplateRegistry {
  validatePromptTemplateBounds({ maxEvidenceContextBytes, maxQueryBytes });

  const templatesByMode = new Map<LlmRouteMode, EvidencePromptTemplate>();

  for (const template of templates) {
    validateEvidencePromptTemplate(template);

    if (templatesByMode.has(template.mode)) {
      throw new Error(`Prompt template mode ${template.mode} is already registered`);
    }

    templatesByMode.set(template.mode, template);
  }

  return {
    render(input) {
      const query = input.query.trim();

      if (!query) {
        throw new Error("Prompt template query is required");
      }

      if (byteLength(query) > maxQueryBytes) {
        throw new Error(`Prompt template query exceeds maxQueryBytes=${maxQueryBytes}`);
      }

      const evidenceContext = input.packedContextWindow.packedEvidence.context;

      if (byteLength(evidenceContext) > maxEvidenceContextBytes) {
        throw new Error(
          `Prompt template evidence context exceeds maxEvidenceContextBytes=${maxEvidenceContextBytes}`,
        );
      }

      const template = templatesByMode.get(input.mode);

      if (!template) {
        throw new Error(`Prompt template mode ${input.mode} is not configured`);
      }

      const evidenceBundle = EvidenceBundleSchema.parse(cloneJson(input.evidenceBundle));
      const packedContextWindow = cloneJson(input.packedContextWindow) as PackedContextWindow;
      const messages = validatePromptMessages(
        template.render({
          evidenceBundle,
          packedContextWindow,
          query,
        }),
      );

      return {
        messages,
        metadata: {
          answerabilityState: evidenceBundle.state,
          evidenceItemCount: packedContextWindow.packedEvidence.items.length,
          mode: template.mode,
          omittedEvidenceCount: packedContextWindow.packedEvidence.omitted.length,
          templateId: template.id,
          templateVersion: template.version,
          usedEvidenceTokens: packedContextWindow.packedEvidence.usedTokens,
        },
      };
    },
  };
}

function validateContextWindowInput(input: PackContextWindowInput): void {
  if (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens < 1) {
    throw new Error("Context window contextWindowTokens must be at least 1");
  }

  if (!Number.isInteger(input.outputTokens) || input.outputTokens < 1) {
    throw new Error("Context window outputTokens must be at least 1");
  }

  if (input.model.trim().length === 0) {
    throw new Error("Context window model is required");
  }

  if (input.systemPrompt.trim().length === 0) {
    throw new Error("Context window systemPrompt is required");
  }
}

function addGenerationCost(
  metadata: LlmGenerationMetadata,
  tracker: GenerationCostTracker,
): LlmGenerationMetadata {
  if (!metadata.usage) {
    return { ...metadata };
  }

  return {
    ...metadata,
    cost: tracker.estimate({
      model: metadata.model,
      provider: metadata.provider,
      usage: metadata.usage,
    }),
  };
}

function validateGenerationModelPrice(price: GenerationModelPrice): void {
  if (!price.model.trim()) {
    throw new Error("Generation cost model is required");
  }

  if (!Number.isFinite(price.inputUsdPerMillionTokens) || price.inputUsdPerMillionTokens <= 0) {
    throw new Error("Generation cost inputUsdPerMillionTokens must be positive");
  }

  if (!Number.isFinite(price.outputUsdPerMillionTokens) || price.outputUsdPerMillionTokens <= 0) {
    throw new Error("Generation cost outputUsdPerMillionTokens must be positive");
  }
}

function validateGenerationUsageTokens({
  completionTokens,
  promptTokens,
  totalTokens,
}: {
  readonly completionTokens: number;
  readonly promptTokens: number;
  readonly totalTokens: number;
}): void {
  if (
    !Number.isInteger(promptTokens) ||
    !Number.isInteger(completionTokens) ||
    !Number.isInteger(totalTokens) ||
    promptTokens < 0 ||
    completionTokens < 0 ||
    totalTokens < 0
  ) {
    throw new Error("Generation usage tokens must be non-negative integers");
  }
}

function validateGenerationBudget(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Generation skip path ${name} must be non-negative`);
  }
}

function validateClaimEvidenceAlignmentOptions({
  maxAnswerBytes,
  maxClaimBytes,
  maxClaims,
  minOverlapTerms,
}: {
  readonly maxAnswerBytes: number;
  readonly maxClaimBytes: number;
  readonly maxClaims: number;
  readonly minOverlapTerms: number;
}): void {
  if (!Number.isSafeInteger(maxAnswerBytes) || maxAnswerBytes < 1) {
    throw new Error("Claim-evidence alignment maxAnswerBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxClaimBytes) || maxClaimBytes < 1) {
    throw new Error("Claim-evidence alignment maxClaimBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxClaims) || maxClaims < 1) {
    throw new Error("Claim-evidence alignment maxClaims must be at least 1");
  }

  if (!Number.isSafeInteger(minOverlapTerms) || minOverlapTerms < 1) {
    throw new Error("Claim-evidence alignment minOverlapTerms must be at least 1");
  }
}

function extractClaimTexts(
  text: string,
  {
    maxAnswerBytes,
    maxClaimBytes,
    maxClaims,
  }: {
    readonly maxAnswerBytes: number;
    readonly maxClaimBytes: number;
    readonly maxClaims: number;
  },
): string[] {
  if (byteLength(text) > maxAnswerBytes) {
    throw new Error(`Claim-evidence alignment answer exceeds maxAnswerBytes=${maxAnswerBytes}`);
  }

  const claims = (text.match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0);

  if (claims.length > maxClaims) {
    throw new Error(`Claim-evidence alignment claim count exceeds maxClaims=${maxClaims}`);
  }

  for (const claim of claims) {
    if (byteLength(claim) > maxClaimBytes) {
      throw new Error(`Claim-evidence alignment claim exceeds maxClaimBytes=${maxClaimBytes}`);
    }
  }

  return claims;
}

function normalizedCitationsByMarker(
  citations: readonly NormalizedCitation[],
): Map<string, NormalizedCitation> {
  const byMarker = new Map<string, NormalizedCitation>();

  for (const citation of citations) {
    if (byMarker.has(citation.marker)) {
      throw new Error(`Claim-evidence alignment citation marker ${citation.marker} is duplicated`);
    }

    byMarker.set(citation.marker, {
      citations: citation.citations.map((item) => cloneJson(item)),
      marker: citation.marker,
      nodeId: citation.nodeId,
      score: citation.score,
    });
  }

  return byMarker;
}

function packedEvidenceByMarker(
  evidenceItems: readonly PackedEvidenceItem[],
): Map<string, PackedEvidenceItem> {
  const byMarker = new Map<string, PackedEvidenceItem>();

  for (const item of evidenceItems) {
    if (byMarker.has(item.marker)) {
      throw new Error(`Claim-evidence alignment evidence marker ${item.marker} is duplicated`);
    }

    byMarker.set(item.marker, {
      citations: item.citations.map((citation) => cloneJson(citation)),
      marker: item.marker,
      nodeId: item.nodeId,
      score: item.score,
      text: item.text,
      tokens: item.tokens,
    });
  }

  return byMarker;
}

function alignClaimWithEvidence({
  citationsByMarker,
  claimText,
  evidenceByMarker,
  minOverlapTerms,
}: {
  readonly citationsByMarker: ReadonlyMap<string, NormalizedCitation>;
  readonly claimText: string;
  readonly evidenceByMarker: ReadonlyMap<string, PackedEvidenceItem>;
  readonly minOverlapTerms: number;
}): ClaimEvidenceAlignmentClaim {
  const validMarkers = markersInText(claimText).filter((marker) => citationsByMarker.has(marker));

  if (validMarkers.length === 0) {
    return claimEvidenceAlignmentClaim({
      citationsByMarker,
      evidenceMarkers: [],
      reason: "missing-citation",
      status: "ungrounded",
      text: claimText,
    });
  }

  const claimTerms = normalizedClaimTerms(claimText);
  const evidenceTerms = new Set(
    validMarkers.flatMap((marker) => [
      ...normalizedClaimTerms(evidenceByMarker.get(marker)?.text ?? ""),
    ]),
  );
  const overlap = [...claimTerms].filter((term) => evidenceTerms.has(term)).length;
  const grounded = claimTerms.size === 0 || overlap >= minOverlapTerms;

  return claimEvidenceAlignmentClaim({
    citationsByMarker,
    evidenceMarkers: validMarkers,
    reason: grounded ? "citation-overlap" : "citation-without-evidence-overlap",
    status: grounded ? "grounded" : "ungrounded",
    text: claimText,
  });
}

function markersInText(text: string): string[] {
  return uniqueStrings([...text.matchAll(/\[(E\d+)\]/g)].map((match) => match[1] ?? ""));
}

function normalizedClaimTerms(text: string): Set<string> {
  const stopWords = new Set([
    "and",
    "are",
    "but",
    "for",
    "from",
    "has",
    "have",
    "into",
    "is",
    "the",
    "this",
    "that",
    "was",
    "were",
    "with",
  ]);

  return new Set(
    text
      .replace(/\[(E\d+)\]/g, " ")
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length > 2 && !stopWords.has(term)),
  );
}

function claimEvidenceAlignmentClaim({
  citationsByMarker,
  evidenceMarkers,
  reason,
  status,
  text,
}: {
  readonly citationsByMarker: ReadonlyMap<string, NormalizedCitation>;
  readonly evidenceMarkers: readonly string[];
  readonly reason: string;
  readonly status: ClaimEvidenceAlignmentStatus;
  readonly text: string;
}): ClaimEvidenceAlignmentClaim {
  return {
    evidenceMarkers: [...evidenceMarkers],
    evidenceNodeIds: evidenceMarkers
      .map((marker) => citationsByMarker.get(marker)?.nodeId)
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
    reason,
    status,
    text,
  };
}

function claimEvidenceAlignmentReport({
  checker,
  claims,
  mode,
  model,
}: {
  readonly checker: ClaimEvidenceAlignmentCheckerKind;
  readonly claims: readonly ClaimEvidenceAlignmentClaim[];
  readonly mode: LlmRouteMode;
  readonly model?: string | undefined;
}): ClaimEvidenceAlignmentReport {
  const clonedClaims = claims.map(cloneClaimEvidenceAlignmentClaim);

  return {
    claims: clonedClaims,
    metadata: {
      checker,
      checkedClaims: clonedClaims.length,
      evidenceReferences: uniqueStrings(clonedClaims.flatMap((claim) => claim.evidenceMarkers))
        .length,
      mode,
      ...(model ? { model } : {}),
    },
    ungroundedClaims: clonedClaims
      .filter((claim) => claim.status === "ungrounded")
      .map(cloneClaimEvidenceAlignmentClaim),
  };
}

function claimEvidenceContext(
  evidenceItems: readonly PackedEvidenceItem[],
  maxEvidenceBytes: number,
): string {
  const lines: string[] = [];
  let bytes = 0;

  for (const item of evidenceItems) {
    const line = `[${item.marker}] ${item.text}`;
    const nextBytes = byteLength(`${line}\n`);

    if (bytes + nextBytes > maxEvidenceBytes) {
      break;
    }

    bytes += nextBytes;
    lines.push(line);
  }

  return lines.join("\n");
}

function parseClaimEvidenceJudgeOutput(
  text: string,
  maxClaims: number,
): z.infer<typeof ClaimEvidenceJudgeOutputSchema> {
  let json: unknown;

  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("Claim-evidence judge returned invalid output", { cause: error });
  }

  const parsed = ClaimEvidenceJudgeOutputSchema.safeParse(json);

  if (!parsed.success || parsed.data.claims.length > maxClaims) {
    throw new Error("Claim-evidence judge returned invalid output");
  }

  return parsed.data;
}

function staleEvidenceFlags({
  citations,
  evidenceBundle,
}: {
  readonly citations: readonly NormalizedCitation[];
  readonly evidenceBundle: EvidenceBundle;
}): StaleEvidenceFlag[] {
  const itemsByNodeId = new Map(evidenceBundle.items.map((item) => [item.nodeId, item]));
  const stale: StaleEvidenceFlag[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    const item = itemsByNodeId.get(citation.nodeId);

    if (!item || item.freshness.status !== "stale") {
      continue;
    }

    const key = `${citation.marker}:${citation.nodeId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    stale.push({
      marker: citation.marker,
      nodeId: citation.nodeId,
      ...(item.freshness.observedAt ? { observedAt: item.freshness.observedAt } : {}),
      ...(item.freshness.sourceUpdatedAt
        ? { sourceUpdatedAt: item.freshness.sourceUpdatedAt }
        : {}),
      status: "stale",
    });
  }

  return stale;
}

function generationPriceKey(provider: LlmProviderKind, model: string): string {
  return `${provider}/${model}`;
}

async function generationCacheKey(
  input: GenerationCacheKeyInput,
  cacheVersion: string,
): Promise<string> {
  const canonical = await canonicalGenerationCacheInput(input, cacheVersion);
  const digest = await sha256Hex(stableJson(canonical));

  return `generation:${cacheVersion}:${digest}`;
}

async function canonicalGenerationCacheInput(
  input: GenerationCacheKeyInput,
  cacheVersion: string,
): Promise<Record<string, unknown>> {
  const evidenceBundle = cloneEvidenceBundle(input.evidenceBundle);
  const promptTemplateId = input.promptTemplateId.trim();
  const promptTemplateVersion = input.promptTemplateVersion.trim();
  const model = input.model.trim();
  const modelVersion = input.modelVersion.trim();

  if (!promptTemplateId) {
    throw new Error("Generation cache promptTemplateId is required");
  }

  if (!promptTemplateVersion) {
    throw new Error("Generation cache promptTemplateVersion is required");
  }

  if (!model) {
    throw new Error("Generation cache model is required");
  }

  if (!modelVersion) {
    throw new Error("Generation cache modelVersion is required");
  }

  return {
    cacheVersion,
    evidence: {
      items: evidenceBundle.items.map((item) => ({
        citations: item.citations.map((citation) => ({
          artifactHash: citation.artifactHash ?? null,
          documentAssetId: citation.documentAssetId,
          documentVersion: citation.documentVersion,
        })),
        nodeId: item.nodeId,
        score: item.score,
      })),
      missingEvidence: evidenceBundle.missingEvidence.map((item) => ({
        expectedEvidenceId: item.expectedEvidenceId ?? null,
        reason: item.reason,
      })),
      queryHash: await sha256Hex(evidenceBundle.query),
      state: evidenceBundle.state,
    },
    generationParameters: normalizeGenerationCacheParameters(input.generationParameters),
    model,
    modelVersion,
    permissionSnapshot: uniqueStrings(
      (input.permissionSnapshot ?? []).map((scope) => scope.trim()),
    ).sort(),
    promptTemplateId,
    promptTemplateVersion,
    provider: input.provider,
  };
}

function normalizeGenerationCacheParameters(
  parameters: GenerationCacheParameters | undefined,
): Record<string, number | string> {
  const normalized: Record<string, number | string> = {};

  if (parameters?.maxOutputTokens !== undefined) {
    if (!Number.isSafeInteger(parameters.maxOutputTokens) || parameters.maxOutputTokens < 1) {
      throw new Error("Generation cache maxOutputTokens must be at least 1");
    }

    normalized.maxOutputTokens = parameters.maxOutputTokens;
  }

  if (parameters?.mode !== undefined) {
    normalized.mode = parameters.mode;
  }

  if (parameters?.temperature !== undefined) {
    if (!Number.isFinite(parameters.temperature) || parameters.temperature < 0) {
      throw new Error("Generation cache temperature must be non-negative");
    }

    normalized.temperature = parameters.temperature;
  }

  return normalized;
}

function defaultEvidencePromptTemplates(): EvidencePromptTemplate[] {
  return [
    createDefaultEvidencePromptTemplate({
      instruction: "Answer briefly with citations.",
      mode: "fast",
      templateId: "knowledge-answer-fast",
    }),
    createDefaultEvidencePromptTemplate({
      instruction: "Give a structured answer with concise reasoning and citations.",
      mode: "deep",
      templateId: "knowledge-answer-deep",
    }),
    createDefaultEvidencePromptTemplate({
      instruction:
        "Compare evidence, call out conflicts, explain uncertainty, and cite every factual claim.",
      mode: "research",
      templateId: "knowledge-answer-research",
    }),
  ];
}

function createDefaultEvidencePromptTemplate({
  instruction,
  mode,
  templateId,
}: {
  readonly instruction: string;
  readonly mode: LlmRouteMode;
  readonly templateId: string;
}): EvidencePromptTemplate {
  return {
    id: templateId,
    mode,
    render: ({ evidenceBundle, packedContextWindow, query }) => [
      {
        content: `${packedContextWindow.systemPrompt} Answer only from supplied evidence. Cite evidence markers like [E1]. If evidence is insufficient, say so plainly.`,
        role: "system",
      },
      {
        content: [
          instruction,
          "",
          `Answerability state: ${evidenceBundle.state}`,
          "Question:",
          query,
          "",
          "Evidence context:",
          packedContextWindow.packedEvidence.context || "(no evidence provided)",
          "",
          `Omitted evidence: ${formatOmittedEvidence(packedContextWindow.packedEvidence.omitted)}`,
          `Token budget: used ${packedContextWindow.packedEvidence.usedTokens} of ${packedContextWindow.packedEvidence.tokenBudget}`,
        ].join("\n"),
        role: "user",
      },
    ],
    version: "prompt-v1",
  };
}

function formatOmittedEvidence(omitted: readonly OmittedPackedEvidenceItem[]): string {
  if (omitted.length === 0) {
    return "none";
  }

  return omitted.map((item) => `${item.nodeId}: ${item.reason}`).join(", ");
}

function validatePromptTemplateBounds({
  maxEvidenceContextBytes,
  maxQueryBytes,
}: {
  readonly maxEvidenceContextBytes: number;
  readonly maxQueryBytes: number;
}): void {
  if (!Number.isSafeInteger(maxEvidenceContextBytes) || maxEvidenceContextBytes < 1) {
    throw new Error("Prompt template maxEvidenceContextBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Prompt template maxQueryBytes must be at least 1");
  }
}

function validateEvidencePromptTemplate(template: EvidencePromptTemplate): void {
  if (!template.id.trim()) {
    throw new Error("Prompt template id is required");
  }

  if (!template.version.trim()) {
    throw new Error("Prompt template version is required");
  }

  if (!["deep", "fast", "research"].includes(template.mode)) {
    throw new Error(`Prompt template mode ${template.mode} is not supported`);
  }
}

function validatePromptMessages(messages: readonly LlmMessage[]): LlmMessage[] {
  if (messages.length === 0) {
    throw new Error("Prompt template must render at least one message");
  }

  return messages.map((message) => {
    if (!["assistant", "system", "user"].includes(message.role)) {
      throw new Error(`Prompt template message role ${message.role} is not supported`);
    }

    if (!message.content.trim()) {
      throw new Error("Prompt template message content is required");
    }

    return { content: message.content, role: message.role };
  });
}

function validateLlmRouterConfig({
  defaultMode,
  policies,
  policyVersion,
  providers,
}: Required<LlmRouterOptions>): void {
  if (policyVersion.trim().length === 0) {
    throw new Error("LLM router policyVersion is required");
  }

  if (!policies[defaultMode]) {
    throw new Error(`LLM route policy ${defaultMode} is not configured`);
  }

  for (const [mode, policy] of Object.entries(policies)) {
    if (!policy) {
      continue;
    }

    if (!providers[policy.provider]) {
      throw new Error(`LLM route policy ${mode} references unknown provider ${policy.provider}`);
    }

    if (policy.model.trim().length === 0) {
      throw new Error(`LLM route policy ${mode} model is required`);
    }

    if (!Number.isInteger(policy.maxOutputTokens) || policy.maxOutputTokens < 1) {
      throw new Error(`LLM route policy ${mode} maxOutputTokens must be at least 1`);
    }

    if (policy.fallback) {
      if (!providers[policy.fallback.provider]) {
        throw new Error(
          `LLM route policy ${mode} fallback references unknown provider ${policy.fallback.provider}`,
        );
      }

      if (policy.fallback.model.trim().length === 0) {
        throw new Error(`LLM route policy ${mode} fallback model is required`);
      }

      if (
        policy.fallback.maxOutputTokens !== undefined &&
        (!Number.isInteger(policy.fallback.maxOutputTokens) || policy.fallback.maxOutputTokens < 1)
      ) {
        throw new Error(`LLM route policy ${mode} fallback maxOutputTokens must be at least 1`);
      }
    }
  }
}

function validateGenerateInput(
  input: GenerateTextInput,
  options: ProviderRuntimeOptions,
): GenerateTextInput {
  if (input.model.trim().length === 0) {
    throw new ProviderInputError("LLM model is required");
  }

  if (input.messages.length === 0) {
    throw new ProviderInputError("LLM input must include at least one message");
  }

  if (input.messages.length > options.maxMessages) {
    throw new ProviderInputError(
      `LLM message count ${input.messages.length} exceeds maxMessages=${options.maxMessages}`,
    );
  }

  for (const [index, message] of input.messages.entries()) {
    if (textEncoder.encode(message.content).byteLength > options.maxTextBytes) {
      throw new ProviderInputError(
        `LLM message at index ${index} exceeds maxTextBytes=${options.maxTextBytes}`,
      );
    }
  }

  const maxOutputTokens = input.maxOutputTokens ?? options.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new ProviderInputError("LLM maxOutputTokens must be at least 1");
  }

  if (maxOutputTokens > options.maxOutputTokens) {
    throw new ProviderInputError(
      `LLM maxOutputTokens ${maxOutputTokens} exceeds maxOutputTokens=${options.maxOutputTokens}`,
    );
  }

  return {
    ...input,
    maxOutputTokens,
    messages: input.messages.map((message) => ({ ...message })),
  };
}

async function sleepMs(ms: number): Promise<void> {
  if (ms === 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

function validateGoldenQuestionGenerationInput(
  input: GenerateGoldenQuestionsInput,
  bounds: {
    readonly maxQuestionsPerRun: number;
    readonly maxSourceNodes: number;
    readonly maxSourceTextBytes: number;
  },
): ValidatedGoldenQuestionGenerationInput {
  const knowledgeSpaceId = requiredString(input.knowledgeSpaceId, "knowledgeSpaceId");

  if (input.sourceNodes.length === 0) {
    throw new Error("Golden question generation sourceNodes is required");
  }

  if (input.sourceNodes.length > bounds.maxSourceNodes) {
    throw new Error(
      `Golden question generation sourceNodes exceeds maxSourceNodes=${bounds.maxSourceNodes}`,
    );
  }

  const maxQuestions = input.maxQuestions ?? bounds.maxQuestionsPerRun;
  if (
    !Number.isSafeInteger(maxQuestions) ||
    maxQuestions < 1 ||
    maxQuestions > bounds.maxQuestionsPerRun
  ) {
    throw new Error(
      `Golden question generation maxQuestions must be between 1 and ${bounds.maxQuestionsPerRun}`,
    );
  }

  const sourceNodes = input.sourceNodes.map((node) => ({
    ...node,
    id: requiredString(node.id, "sourceNode.id"),
    metadata: node.metadata ? { ...node.metadata } : {},
    sectionPath: [...(node.sectionPath ?? [])],
    text: requiredString(node.text, "sourceNode.text"),
  }));
  const totalSourceTextBytes = sourceNodes.reduce(
    (total, node) => total + byteLength(node.text),
    0,
  );

  if (totalSourceTextBytes > bounds.maxSourceTextBytes) {
    throw new Error(
      `Golden question generation source text exceeds maxSourceTextBytes=${bounds.maxSourceTextBytes}`,
    );
  }

  return {
    knowledgeSpaceId,
    maxQuestions,
    sourceNodes,
    tags: uniqueTrimmedStrings(input.tags ?? []),
  };
}

function renderGoldenQuestionGenerationMessages(
  input: ValidatedGoldenQuestionGenerationInput,
): LlmMessage[] {
  return [
    {
      content:
        'Generate evaluation golden questions as strict JSON. Return {"questions":[{"question":"...","expectedEvidenceIds":["source-node-id"],"tags":["tag"]}]}. Every expectedEvidenceIds item must come from the provided source node ids. Do not include answers.',
      role: "system",
    },
    {
      content: JSON.stringify({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxQuestions: input.maxQuestions,
        sourceNodes: input.sourceNodes.map((node) => ({
          id: node.id,
          sectionPath: node.sectionPath ?? [],
          text: node.text,
        })),
        tags: input.tags,
      }),
      role: "user",
    },
  ];
}

function parseGeneratedQuestionResponse(text: string, maxQuestions: number) {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("Golden question generation response is invalid JSON", { cause: error });
  }

  const parsed = GeneratedQuestionResponseSchema.parse(value);
  if (parsed.questions.length > maxQuestions) {
    throw new Error(
      `Golden question generation returned ${parsed.questions.length} questions over maxQuestions=${maxQuestions}`,
    );
  }

  return parsed;
}

function validatePendingProposal(proposal: GeneratedGoldenQuestionProposal): void {
  if (proposal.status !== "pending_review") {
    throw new Error("Golden question proposal must be pending review");
  }
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Golden question generation ${label} is required`);
  }

  return normalized;
}

function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique];
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Golden question generation ${label} must be at least 1`);
  }
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function cleanupCitationText(text: string): string {
  return text
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function cloneGenerateTextResult(result: GenerateTextResult): GenerateTextResult {
  return parseGenerateTextResult(cloneJson(result));
}

function parseGenerateTextResult(value: unknown): GenerateTextResult {
  const parsed = GenerateTextResultSchema.parse(value);

  return {
    finishReason: parsed.finishReason,
    metadata: {
      model: parsed.metadata.model,
      provider: parsed.metadata.provider,
      ...(parsed.metadata.cost === undefined ? {} : { cost: parsed.metadata.cost }),
      ...(parsed.metadata.quality === undefined ? {} : { quality: parsed.metadata.quality }),
      ...(parsed.metadata.requestId === undefined ? {} : { requestId: parsed.metadata.requestId }),
      ...(parsed.metadata.routing === undefined ? {} : { routing: parsed.metadata.routing }),
      ...(parsed.metadata.usage === undefined
        ? {}
        : { usage: normalizeParsedUsage(parsed.metadata.usage) }),
    },
    model: parsed.model,
    text: parsed.text,
  };
}

function normalizeParsedUsage(usage: z.infer<typeof LlmUsageSchema>): LlmUsage {
  return {
    ...(usage.completionTokens === undefined ? {} : { completionTokens: usage.completionTokens }),
    ...(usage.promptTokens === undefined ? {} : { promptTokens: usage.promptTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
}

function cloneEvidenceBundle(bundle: EvidenceBundle): EvidenceBundle {
  return EvidenceBundleSchema.parse(cloneJson(bundle));
}

function cloneClaimEvidenceAlignmentClaim(
  claim: ClaimEvidenceAlignmentClaim,
): ClaimEvidenceAlignmentClaim {
  return {
    evidenceMarkers: [...claim.evidenceMarkers],
    evidenceNodeIds: [...claim.evidenceNodeIds],
    reason: claim.reason,
    status: claim.status,
    text: claim.text,
  };
}

function cloneModels(models: readonly LlmModelInfo[]): LlmModelInfo[] {
  return models.map((model) => ({ ...model }));
}

function cloneJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;

  /* c8 ignore next 3 -- Node and Workers expose Web Crypto; this fallback protects older runtimes. */
  if (!subtle) {
    return fallbackHashHex(value);
  }

  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* c8 ignore start -- Web Crypto is available in supported runtimes; retained for defensive fallback. */
function fallbackHashHex(value: string): string {
  let hash = 0xcbf29ce484222325n;

  for (const byte of textEncoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash.toString(16).padStart(16, "0");
}
/* c8 ignore stop */
