import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { z } from "zod";

import type { ConcurrencyGate } from "./bounded-concurrency";
import {
  type ResearchModelCallObserver,
  estimateResearchModelPromptTokens,
  notifyResearchModelCallAfter,
  notifyResearchModelCallBefore,
  parseResearchModelUsage,
} from "./research-model-usage";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";

export type ResearchQueryIntent = "comparison" | "direct" | "multi-hop" | "overview";

export interface ResearchQueryPlan {
  readonly evidenceDimensions: readonly string[];
  readonly intent: ResearchQueryIntent;
  readonly modelCalled: boolean;
  readonly subqueries: readonly string[];
  readonly useGraph: boolean;
}

export interface ResearchEvidenceJudgement {
  readonly coverage: number;
  readonly coveredDimensions: readonly string[];
  readonly missingDimensions: readonly string[];
  /** False only when the deterministic empty-evidence shortcut avoided a provider call. */
  readonly modelCalled?: boolean | undefined;
  readonly sufficient: boolean;
  readonly supplementalQuery?: string | undefined;
}

export interface ResearchEvidenceReasoning {
  judge(input: {
    readonly evidence: readonly HybridRetrievalItem[];
    readonly evidenceDimensions: readonly string[];
    readonly query: string;
    readonly reasoningModel: KnowledgeSpaceModelSelection;
    /** Reserves one bounded budget unit immediately before every physical provider call. */
    readonly reserveModelCall?: (() => void) | undefined;
    readonly researchModelCallObserver?: ResearchModelCallObserver | undefined;
    readonly tenantId: string;
    readonly traceId?: string | undefined;
  }): Promise<ResearchEvidenceJudgement>;
  plan(input: {
    readonly query: string;
    readonly reasoningModel: KnowledgeSpaceModelSelection;
    /** Reserves one bounded budget unit immediately before every physical provider call. */
    readonly reserveModelCall?: (() => void) | undefined;
    readonly researchModelCallObserver?: ResearchModelCallObserver | undefined;
    readonly tenantId: string;
    readonly traceId?: string | undefined;
  }): Promise<ResearchQueryPlan>;
}

export interface ResearchEvidenceReasoningOptions {
  readonly maxEvidenceCharsPerItem?: number | undefined;
  readonly maxEvidenceItems?: number | undefined;
  readonly maxOutputTokens: number;
  readonly maxResponseChars?: number | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly providerFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => ResearchEvidenceReasoningProvider;
  readonly timeoutMs: number;
}

export interface ResearchEvidenceReasoningProvider {
  generate(input: {
    readonly maxOutputTokens?: number;
    readonly messages: readonly {
      readonly content: string;
      readonly role: "assistant" | "system" | "user";
    }[];
    readonly model: string;
    readonly reasoningEffort?: "low";
    readonly signal?: AbortSignal;
    readonly structuredOutputSchema?: Readonly<Record<string, unknown>>;
    readonly temperature?: number;
    readonly tenantId?: string;
  }): Promise<{
    readonly finishReason?: string | undefined;
    readonly metadata?: unknown;
    readonly model: string;
    readonly text: string;
  }>;
}

const QueryPlanSchema = z
  .object({
    evidenceDimensions: z.array(z.string().trim().min(1).max(120)).max(6),
    intent: z.enum(["comparison", "direct", "multi-hop", "overview"]),
    subqueries: z.array(z.string().trim().min(1).max(500)).max(3),
    useGraph: z.boolean(),
  })
  .strict();

const EvidenceJudgementSchema = z
  .object({
    coverage: z.number().min(0).max(1),
    coveredDimensions: z.array(z.string().trim().min(1).max(120)).max(12),
    missingDimensions: z.array(z.string().trim().min(1).max(120)).max(12),
    sufficient: z.boolean(),
    supplementalQuery: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export class ResearchEvidenceReasoningContractError extends Error {
  readonly code: "RESEARCH_EVIDENCE_REASONING_INVALID" | "RESEARCH_EVIDENCE_REASONING_TRUNCATED";
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly code?:
        | "RESEARCH_EVIDENCE_REASONING_INVALID"
        | "RESEARCH_EVIDENCE_REASONING_TRUNCATED"
        | undefined;
      readonly retryable?: boolean | undefined;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ResearchEvidenceReasoningContractError";
    this.code = options.code ?? "RESEARCH_EVIDENCE_REASONING_INVALID";
    this.retryable = options.retryable ?? false;
  }
}

export function createResearchEvidenceReasoning({
  maxEvidenceCharsPerItem = 1_200,
  maxEvidenceItems = 20,
  maxOutputTokens,
  maxResponseChars = 16_000,
  modelRequestGate,
  providerFactory,
  timeoutMs,
}: ResearchEvidenceReasoningOptions): ResearchEvidenceReasoning {
  for (const [label, value] of Object.entries({
    maxEvidenceCharsPerItem,
    maxEvidenceItems,
    maxOutputTokens,
    maxResponseChars,
    timeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Research evidence reasoning ${label} must be at least 1`);
    }
  }
  const generate = async ({
    callId,
    callMaxOutputTokens,
    messages,
    observer,
    reasoningModel,
    reserveModelCall,
    schema,
    step,
    tenantId,
  }: {
    readonly callId: string;
    readonly callMaxOutputTokens: number;
    readonly messages: readonly { readonly content: string; readonly role: "system" | "user" }[];
    readonly observer?: ResearchModelCallObserver | undefined;
    readonly reasoningModel: KnowledgeSpaceModelSelection;
    readonly reserveModelCall?: (() => void) | undefined;
    readonly schema: Readonly<Record<string, unknown>>;
    readonly step: "research.judge" | "research.plan";
    readonly tenantId: string;
  }) => {
    reserveModelCall?.();
    const modelCall = {
      callId,
      estimatedPromptTokens: estimateResearchModelPromptTokens({ messages, schema }),
      maxOutputTokens: callMaxOutputTokens,
      model: reasoningModel.model,
      provider: reasoningModel.provider,
      step,
    } as const;
    await notifyResearchModelCallBefore(observer, modelCall);
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new ResearchEvidenceReasoningContractError(`${step} timed out`, { retryable: true }),
        ),
      timeoutMs,
    );
    let result: Awaited<ReturnType<ResearchEvidenceReasoningProvider["generate"]>>;
    try {
      const provider = providerFactory(reasoningModel);
      const operation = () =>
        provider.generate({
          maxOutputTokens: callMaxOutputTokens,
          messages,
          model: reasoningModel.model,
          ...(lowReasoningEffortSupported(reasoningModel) ? { reasoningEffort: "low" } : {}),
          signal: controller.signal,
          structuredOutputSchema: schema,
          temperature: 0,
          tenantId,
        });
      result = await raceWithAbort(
        modelRequestGate ? modelRequestGate.run(operation) : operation(),
        controller.signal,
      );
      if (
        result.model.trim() !== reasoningModel.model ||
        metadataModel(result.metadata) !== reasoningModel.model
      ) {
        throw new ResearchEvidenceReasoningContractError(
          `${step} response model did not match the selected reasoning model`,
        );
      }
      if (Array.from(result.text).length > maxResponseChars) {
        throw new ResearchEvidenceReasoningContractError(`${step} response exceeded its bound`);
      }
    } catch (error) {
      await notifyResearchModelCallAfter(observer, { ...modelCall, status: "failed" });
      if (error instanceof ResearchEvidenceReasoningContractError) throw error;
      throw new ResearchEvidenceReasoningContractError(`${step} model call failed`, {
        cause: error,
        retryable: modelFailureIsRetryable(error),
      });
    } finally {
      clearTimeout(timer);
    }
    await notifyResearchModelCallAfter(observer, {
      ...modelCall,
      metadata: result.metadata,
      status: "succeeded",
    });
    return result;
  };

  const generateStructured = async <T>({
    callId,
    messages,
    observer,
    parse,
    reasoningModel,
    reserveModelCall,
    schema,
    step,
    tenantId,
  }: {
    readonly callId: string;
    readonly messages: readonly { readonly content: string; readonly role: "system" | "user" }[];
    readonly observer?: ResearchModelCallObserver | undefined;
    readonly parse: (text: string) => T;
    readonly reasoningModel: KnowledgeSpaceModelSelection;
    readonly reserveModelCall?: (() => void) | undefined;
    readonly schema: Readonly<Record<string, unknown>>;
    readonly step: "research.judge" | "research.plan";
    readonly tenantId: string;
  }): Promise<T> => {
    const initial = await generate({
      callId,
      callMaxOutputTokens: maxOutputTokens,
      messages,
      observer,
      reasoningModel,
      reserveModelCall,
      schema,
      step,
      tenantId,
    });
    try {
      return parse(initial.text);
    } catch (error) {
      if (responseWasTruncated(initial, maxOutputTokens)) throw truncatedResponseError(step, error);
      throw error;
    }
  };

  return {
    plan: async (input) => {
      const query = requiredText(input.query, "query");
      const local = localResearchQueryPlan(query);
      if (!local.requiresModel) {
        return { ...local.plan, modelCalled: false };
      }
      const parsed = await generateStructured({
        callId: `research-plan:${input.traceId ?? "interactive"}`,
        messages: [
          {
            content:
              "Plan retrieval, not an answer. Return at most three non-overlapping semantic search queries. Use graph only for relationships or multi-hop reasoning. Evidence dimensions are concise coverage requirements.",
            role: "system",
          },
          { content: query, role: "user" },
        ],
        observer: input.researchModelCallObserver,
        parse: (text) => parseJson(text, QueryPlanSchema, "research.plan"),
        reasoningModel: input.reasoningModel,
        reserveModelCall: input.reserveModelCall,
        schema: zodJsonSchema(QueryPlanSchema),
        step: "research.plan",
        tenantId: requiredText(input.tenantId, "tenantId"),
      });
      return {
        ...parsed,
        evidenceDimensions: uniqueStrings(parsed.evidenceDimensions),
        modelCalled: true,
        subqueries: uniqueStrings(parsed.subqueries)
          .filter((value) => value !== query)
          .slice(0, 3),
      };
    },
    judge: async (input) => {
      const query = requiredText(input.query, "query");
      if (input.evidence.length === 0) {
        return {
          coverage: 0,
          coveredDimensions: [],
          missingDimensions: [...input.evidenceDimensions],
          modelCalled: false,
          sufficient: false,
          supplementalQuery: query,
        };
      }
      const evidence = input.evidence.slice(0, maxEvidenceItems).map((item, index) => ({
        id: item.nodeId,
        index: index + 1,
        sectionPath: item.citation.sectionPath,
        text: truncate(evidenceTextFromHybridItem(item), maxEvidenceCharsPerItem),
      }));
      const parsed = await generateStructured({
        callId: `research-judge:${input.traceId ?? "interactive"}:${evidence.length}`,
        messages: [
          {
            content:
              "Judge whether the evidence set is sufficient to answer the query. This is a bounded classification task. Reason briefly. Return only the compact JSON object required by the schema, with no prose. Do not score individual passages. Keep dimension labels concise. The sufficient field must be the JSON boolean true or false, never an explanation or string. A supplemental query must target only missing evidence and must be null when sufficient.",
            role: "system",
          },
          {
            content: JSON.stringify({
              evidence,
              evidenceDimensions: input.evidenceDimensions,
              query,
            }),
            role: "user",
          },
        ],
        observer: input.researchModelCallObserver,
        parse: parseEvidenceJudgement,
        reasoningModel: input.reasoningModel,
        reserveModelCall: input.reserveModelCall,
        schema: zodJsonSchema(EvidenceJudgementSchema),
        step: "research.judge",
        tenantId: requiredText(input.tenantId, "tenantId"),
      });
      return {
        coverage: parsed.coverage,
        coveredDimensions: uniqueStrings(parsed.coveredDimensions),
        missingDimensions: uniqueStrings(parsed.missingDimensions),
        modelCalled: true,
        sufficient: parsed.sufficient,
        ...(parsed.sufficient || !parsed.supplementalQuery
          ? {}
          : { supplementalQuery: parsed.supplementalQuery }),
      };
    },
  };
}

export function localResearchQueryPlan(query: string): {
  readonly plan: Omit<ResearchQueryPlan, "modelCalled">;
  readonly requiresModel: boolean;
} {
  const normalized = requiredText(query, "query");
  const complexPattern =
    /(?:比较|对比|区别|分别|关系|影响|演变|综合|全面|为什么.*(?:以及|并且)|compare|versus|relationship|across|overview)/iu;
  const graphPattern = /(?:关系|关联|依赖|影响|属于|连接|relationship|related|depends|impact)/iu;
  const clauseCount = normalized.split(/[，,；;。.!?？]/u).filter((part) => part.trim()).length;
  const requiresModel =
    complexPattern.test(normalized) || clauseCount > 2 || Array.from(normalized).length > 120;
  return {
    plan: {
      evidenceDimensions: [],
      intent: "direct",
      subqueries: [],
      useGraph: graphPattern.test(normalized),
    },
    requiresModel,
  };
}

function zodJsonSchema(schema: z.ZodTypeAny): Readonly<Record<string, unknown>> {
  // Dify's model-runtime consumes standard JSON Schema. Zod owns response validation; this
  // compact declaration keeps the transport dependency-free and fail-closed on the return path.
  if (schema === QueryPlanSchema) {
    return {
      additionalProperties: false,
      properties: {
        evidenceDimensions: { items: { type: "string" }, maxItems: 6, type: "array" },
        intent: { enum: ["comparison", "direct", "multi-hop", "overview"], type: "string" },
        subqueries: { items: { type: "string" }, maxItems: 3, type: "array" },
        useGraph: { type: "boolean" },
      },
      required: ["evidenceDimensions", "intent", "subqueries", "useGraph"],
      type: "object",
    };
  }
  return {
    additionalProperties: false,
    properties: {
      coverage: { maximum: 1, minimum: 0, type: "number" },
      coveredDimensions: { items: { type: "string" }, maxItems: 12, type: "array" },
      missingDimensions: { items: { type: "string" }, maxItems: 12, type: "array" },
      sufficient: { type: "boolean" },
      supplementalQuery: { type: ["string", "null"] },
    },
    required: [
      "coverage",
      "coveredDimensions",
      "missingDimensions",
      "sufficient",
      "supplementalQuery",
    ],
    type: "object",
  };
}

function parseJson<T>(text: string, schema: z.ZodType<T>, label: string): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch (cause) {
    throw new ResearchEvidenceReasoningContractError(`${label} returned invalid structured JSON`, {
      cause,
    });
  }
}

function parseEvidenceJudgement(text: string): z.infer<typeof EvidenceJudgementSchema> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ResearchEvidenceReasoningContractError(
      "research.judge returned invalid structured JSON",
      { cause },
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sufficient = normalizeSufficientValue(record.sufficient);
    if (sufficient !== undefined) {
      value = { ...record, sufficient };
    }
  }
  try {
    return EvidenceJudgementSchema.parse(value);
  } catch (cause) {
    throw new ResearchEvidenceReasoningContractError(
      "research.judge returned invalid structured JSON",
      { cause },
    );
  }
}

function responseWasTruncated(
  response: {
    readonly finishReason?: string | undefined;
    readonly metadata?: unknown;
  },
  maxOutputTokens: number,
): boolean {
  const finishReason = response.finishReason?.trim().toLocaleLowerCase();
  if (
    finishReason &&
    /^(?:length|max[_ -]?(?:output[_ -]?)?tokens?|token[_ -]?limit|incomplete)$/u.test(finishReason)
  ) {
    return true;
  }
  const usage = parseResearchModelUsage(response.metadata);
  return usage?.completionTokens !== undefined && usage.completionTokens >= maxOutputTokens;
}

function truncatedResponseError(step: "research.judge" | "research.plan", cause: unknown) {
  return new ResearchEvidenceReasoningContractError(
    `${step} response was truncated at the configured output-token bound`,
    {
      cause,
      code: "RESEARCH_EVIDENCE_REASONING_TRUNCATED",
    },
  );
}

function lowReasoningEffortSupported(selection: KnowledgeSpaceModelSelection): boolean {
  const pluginId = selection.pluginId.trim().toLocaleLowerCase();
  const provider = selection.provider.trim().toLocaleLowerCase();
  const model = selection.model.trim().toLocaleLowerCase();
  return (
    pluginId === "langgenius/openai" &&
    provider === "openai" &&
    /^(?:gpt-5(?:[.-]|$)|o(?:1|3|4)(?:[.-]|$))/u.test(model)
  );
}

function normalizeSufficientValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (
    /^(?:false|no|insufficient|not sufficient|不足|不充分|不够|否)(?:[\s.,，。:：;；]|$)/u.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^(?:true|yes|sufficient|充分|足够|是)(?:[\s.,，。:：;；]|$)/u.test(normalized)) {
    return true;
  }
  return undefined;
}

function modelFailureIsRetryable(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { readonly retryable?: unknown }).retryable === true;
  }
  // Preserve the durable runtime's previous behavior for opaque provider/network failures.
  return true;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ResearchEvidenceReasoningContractError(`${label} is required`);
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, maxChars: number): string {
  const chars = Array.from(value);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : value;
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function metadataModel(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const model = (metadata as Readonly<Record<string, unknown>>).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}
