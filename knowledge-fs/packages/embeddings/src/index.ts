import { createHash } from "node:crypto";
import { stableJson } from "@knowledge/core";
import type { PluginDaemonClient } from "@knowledge/plugin-daemon-client";
import { z } from "zod";

export type EmbeddingProviderKind = "plugin-daemon" | "static";
export type RerankerProviderKind = "plugin-daemon" | "static";
export type EmbeddingDistanceMetric = "cosine" | "dot" | "l2";
export type EmbeddingInputType =
  | "classification"
  | "clustering"
  | "search_document"
  | "search_query";

export interface EmbeddingModelInfo {
  /**
   * The model's output dimension when known from configuration or a completed model call.
   * Plugin-backed models may not know this value until their first response.
   */
  dimension?: number | undefined;
  distanceMetric: EmbeddingDistanceMetric;
  id: string;
  maxInputTokens: number;
  provider: string;
  recommendedBatchSize: number;
  supportsDense: boolean;
  supportsMultiVector: boolean;
  supportsSparse: boolean;
  tokenizerVersion: string;
  version: string;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface EmbedTextsInput {
  inputType?: EmbeddingInputType;
  model: string;
  signal?: AbortSignal;
  /** Tenant scope for model routing (required by the plugin-daemon adapter). */
  tenantId?: string;
  texts: string[];
}

export interface EmbedTextsResult {
  dense: number[][];
  metadata: {
    /** Dimension observed in this response. */
    dimension?: number | undefined;
    model: string;
    provider: EmbeddingProviderKind;
    usage?: {
      totalTokens: number;
    };
  };
  model: string;
  sparse?: SparseVector[];
}

export interface EmbeddingProvider {
  kind: EmbeddingProviderKind;
  embed(input: EmbedTextsInput): Promise<EmbedTextsResult>;
  models(): Promise<EmbeddingModelInfo[]>;
}

export interface RerankDocumentInput {
  id: string;
  metadata?: Record<string, unknown>;
  text: string;
}

export interface RerankDocumentsInput {
  documents: RerankDocumentInput[];
  model: string;
  query: string;
  signal?: AbortSignal;
  /** Tenant scope for model routing (required by the plugin-daemon adapter). */
  tenantId?: string;
  topN?: number;
}

export interface RerankedDocument {
  document: {
    id: string;
    metadata: Record<string, unknown>;
    text: string;
  };
  index: number;
  score: number;
}

export interface RerankDocumentsResult {
  items: RerankedDocument[];
  metadata: {
    model: string;
    provider: RerankerProviderKind;
    usage?: {
      searchUnits?: number;
      totalTokens?: number;
    };
  };
  model: string;
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

export interface RerankerProvider {
  kind: RerankerProviderKind;
  models(): Promise<RerankerModelInfo[]>;
  rerank(input: RerankDocumentsInput): Promise<RerankDocumentsResult>;
}

export interface RerankerModelInfo {
  id: string;
  maxDocuments: number;
  maxInputTokens: number;
  provider: RerankerProviderKind;
  version: string;
}

export interface EmbeddingCacheAdapter {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array, options?: { readonly ttlMs?: number }): Promise<void>;
}

export interface CachedEmbeddingProviderOptions {
  readonly cache: EmbeddingCacheAdapter;
  readonly cacheVersion?: string | undefined;
  readonly maxEntryBytes?: number | undefined;
  readonly provider: EmbeddingProvider;
  readonly ttlMs?: number | undefined;
}

export interface CachedRerankerProviderOptions {
  readonly cache: EmbeddingCacheAdapter;
  readonly cacheVersion?: string | undefined;
  readonly maxEntryBytes?: number | undefined;
  readonly reranker: RerankerProvider;
  readonly ttlMs?: number | undefined;
}

export interface StaticEmbeddingProviderOptions {
  dimension: number;
  model: string;
  provider?: "static";
}

export interface StaticRerankerProviderOptions {
  model: string;
  provider?: "static";
}

const defaultMaxBatchSize = 128;
const defaultMaxDocuments = 128;
const defaultCacheEntryBytes = 1024 * 1024;
const defaultCacheTtlMs = 60 * 60 * 1000;
const defaultMaxTextBytes = 64 * 1024;
const textEncoder = new TextEncoder();

export function createStaticEmbeddingProvider({
  dimension,
  model,
  provider = "static",
}: StaticEmbeddingProviderOptions): EmbeddingProvider {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new Error("Static embedding dimension must be a positive integer");
  }

  const modelInfo: EmbeddingModelInfo = {
    dimension,
    distanceMetric: "cosine",
    id: model,
    maxInputTokens: 8191,
    provider,
    recommendedBatchSize: 128,
    supportsDense: true,
    supportsMultiVector: false,
    supportsSparse: false,
    tokenizerVersion: "static",
    version: "static@1",
  };

  return {
    kind: provider,
    async embed(input) {
      validateEmbedInput(input, {
        maxBatchSize: defaultMaxBatchSize,
        maxTextBytes: defaultMaxTextBytes,
      });

      if (input.model !== model) {
        throw new Error(`Embedding model ${input.model} is not supported by static provider`);
      }

      return {
        dense: input.texts.map((text) => stableVector(text, dimension)),
        metadata: {
          model,
          provider,
        },
        model,
      };
    },
    async models() {
      return [cloneModelInfo(modelInfo)];
    },
  };
}

export function createCachedEmbeddingProvider({
  cache,
  cacheVersion = "embedding-cache-v1",
  maxEntryBytes = defaultCacheEntryBytes,
  provider,
  ttlMs = defaultCacheTtlMs,
}: CachedEmbeddingProviderOptions): EmbeddingProvider {
  validateCacheOptions("Embedding cache", { cacheVersion, maxEntryBytes, ttlMs });
  let modelsPromise: Promise<EmbeddingModelInfo[]> | undefined;

  const modelInfoFor = async (model: string) => {
    modelsPromise ??= provider.models();
    return findModel(await modelsPromise, model, provider.kind);
  };

  return {
    kind: provider.kind,
    async embed(input) {
      const modelInfo = await modelInfoFor(input.model);
      const key = embeddingCacheKey({
        cacheVersion,
        input,
        modelInfo,
        providerKind: provider.kind,
      });
      const cached = await cache.get(key);

      if (cached && cached.byteLength <= maxEntryBytes) {
        const result = decodeEmbedTextsResult(cached);

        if (result) {
          return cloneEmbedTextsResult(result);
        }
      }

      const result = await provider.embed(input);
      const bytes = encodeJson(result);

      if (bytes.byteLength > maxEntryBytes) {
        throw new Error(`Embedding cache entry exceeds maxEntryBytes=${maxEntryBytes}`);
      }

      await cache.set(key, bytes, { ttlMs });

      return cloneEmbedTextsResult(result);
    },
    async models() {
      return provider.models();
    },
  };
}

export function createCachedRerankerProvider({
  cache,
  cacheVersion = "rerank-cache-v1",
  maxEntryBytes = defaultCacheEntryBytes,
  reranker,
  ttlMs = defaultCacheTtlMs,
}: CachedRerankerProviderOptions): RerankerProvider {
  validateCacheOptions("Rerank cache", { cacheVersion, maxEntryBytes, ttlMs });
  let modelsPromise: Promise<RerankerModelInfo[]> | undefined;

  const modelInfoFor = async (model: string) => {
    modelsPromise ??= reranker.models();
    return findRerankerModel(await modelsPromise, model, reranker.kind);
  };

  return {
    kind: reranker.kind,
    async models() {
      return reranker.models();
    },
    async rerank(input) {
      const modelInfo = await modelInfoFor(input.model);
      const key = rerankCacheKey({ cacheVersion, input, modelInfo, providerKind: reranker.kind });
      const cached = await cache.get(key);

      if (cached && cached.byteLength <= maxEntryBytes) {
        const result = decodeRerankDocumentsResult(cached);

        if (result) {
          return cloneRerankDocumentsResult(result);
        }
      }

      const result = await reranker.rerank(input);
      const bytes = encodeJson(cloneRerankDocumentsResult(result));

      if (bytes.byteLength > maxEntryBytes) {
        throw new Error(`Rerank cache entry exceeds maxEntryBytes=${maxEntryBytes}`);
      }

      await cache.set(key, bytes, { ttlMs });

      return cloneRerankDocumentsResult(result);
    },
  };
}

export function createStaticRerankerProvider({
  model,
  provider = "static",
}: StaticRerankerProviderOptions): RerankerProvider {
  const modelInfo: RerankerModelInfo = {
    id: model,
    maxDocuments: defaultMaxDocuments,
    maxInputTokens: 8191,
    provider,
    version: "static@1",
  };

  return {
    kind: provider,
    async models() {
      return [cloneRerankerModelInfo(modelInfo)];
    },
    async rerank(input) {
      validateRerankInput(input, {
        maxDocuments: defaultMaxDocuments,
        maxTextBytes: defaultMaxTextBytes,
      });

      if (input.model !== model) {
        throw new Error(`Reranker model ${input.model} is not supported by static provider`);
      }

      const terms = tokenizeForRerank(input.query);
      const items = input.documents
        .map((document, index) => ({
          document: cloneRerankDocument(document),
          index,
          score: scoreStaticRerankDocument(terms, document.text),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, input.topN ?? input.documents.length);

      return {
        items: items.map(cloneRerankedDocument),
        metadata: {
          model,
          provider,
        },
        model,
      };
    },
  };
}

export interface PluginDaemonEmbeddingProviderOptions {
  readonly client: PluginDaemonClient;
  readonly credentials?: Record<string, unknown> | undefined;
  /** Optional model configuration used for early response validation. */
  readonly dimension?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  readonly maxTextBytes?: number | undefined;
  readonly model: string;
  readonly models?: readonly EmbeddingModelInfo[] | undefined;
  readonly pluginId: string;
  readonly provider: string;
  readonly userId?: string | undefined;
}

const PluginDaemonEmbeddingDataSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  model: z.string().optional(),
  // Mirrors dify's EmbeddingUsage (graphon text_embedding_entities): token counts live in
  // `tokens` / `total_tokens` (price fields are ignored here).
  usage: z.object({ tokens: z.number(), total_tokens: z.number() }).partial().optional(),
});

/**
 * EmbeddingProvider backed by Dify's plugin-daemon `text_embedding` dispatch.
 * The tenant is taken per-call from `input.tenantId` (required); credentials are
 * resolved daemon-side, so an empty object is sent unless overridden.
 */
export function createPluginDaemonEmbeddingProvider(
  options: PluginDaemonEmbeddingProviderOptions,
): EmbeddingProvider {
  if (!options.pluginId.trim()) {
    throw new ProviderInputError("Plugin daemon embedding pluginId is required");
  }

  if (!options.provider.trim()) {
    throw new ProviderInputError("Plugin daemon embedding provider is required");
  }

  if (!options.model.trim()) {
    throw new ProviderInputError("Plugin daemon embedding model is required");
  }

  if (
    options.dimension !== undefined &&
    (!Number.isSafeInteger(options.dimension) || options.dimension < 1)
  ) {
    throw new ProviderInputError("Plugin daemon embedding dimension must be a positive integer");
  }

  const maxBatchSize = options.maxBatchSize ?? defaultMaxBatchSize;
  const maxTextBytes = options.maxTextBytes ?? defaultMaxTextBytes;
  const credentials = options.credentials ?? {};
  const models = (options.models ?? [defaultPluginDaemonEmbeddingModel(options)]).map(
    cloneModelInfo,
  );
  const observedDimensions = new Map<string, number>();

  for (const model of models) {
    if (model.dimension !== undefined) {
      observedDimensions.set(model.id, model.dimension);
    }
  }

  return {
    kind: "plugin-daemon",
    async embed(input) {
      validateEmbedInput(input, { maxBatchSize, maxTextBytes });

      const tenantId = input.tenantId?.trim();

      if (!tenantId) {
        throw new ProviderInputError("Plugin daemon embedding requires a tenantId");
      }

      const data = await options.client.dispatchUnary({
        data: {
          credentials,
          // dify's EmbeddingInputType is a lowercase StrEnum ("document" | "query").
          input_type: input.inputType === "search_query" ? "query" : "document",
          model: input.model,
          model_type: "text-embedding",
          provider: options.provider,
          texts: input.texts,
        },
        op: "text_embedding",
        pluginId: options.pluginId,
        tenantId,
        ...(options.userId ? { userId: options.userId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      const parsed = PluginDaemonEmbeddingDataSchema.safeParse(data);

      if (!parsed.success) {
        throw new ProviderResponseError("Plugin daemon returned an invalid embedding response", {
          cause: parsed.error,
        });
      }

      if (parsed.data.embeddings.length !== input.texts.length) {
        throw new ProviderResponseError(
          `Plugin daemon returned ${parsed.data.embeddings.length} embeddings for ${input.texts.length} texts`,
        );
      }

      const model = parsed.data.model ?? input.model;
      const dimension = validateEmbeddingResponseVectors(parsed.data.embeddings);
      const configuredDimension =
        observedDimensions.get(input.model) ?? observedDimensions.get(model);

      if (configuredDimension !== undefined && configuredDimension !== dimension) {
        throw new ProviderResponseError(
          `Plugin daemon returned embedding dimension=${dimension}; expected ${configuredDimension} for model ${input.model}`,
        );
      }

      observedDimensions.set(input.model, dimension);
      observedDimensions.set(model, dimension);
      const totalTokens = parsed.data.usage?.total_tokens ?? parsed.data.usage?.tokens;

      return {
        dense: parsed.data.embeddings.map((vector) => [...vector]),
        metadata: {
          dimension,
          model,
          provider: "plugin-daemon",
          ...(totalTokens === undefined ? {} : { usage: { totalTokens } }),
        },
        model,
      };
    },
    async models() {
      return models.map((model) => ({
        ...cloneModelInfo(model),
        ...(observedDimensions.get(model.id) === undefined
          ? {}
          : { dimension: observedDimensions.get(model.id) }),
      }));
    },
  };
}

function defaultPluginDaemonEmbeddingModel(
  options: PluginDaemonEmbeddingProviderOptions,
): EmbeddingModelInfo {
  return {
    ...(options.dimension === undefined ? {} : { dimension: options.dimension }),
    distanceMetric: "cosine",
    id: options.model,
    maxInputTokens: 8192,
    provider: "plugin-daemon",
    recommendedBatchSize: options.maxBatchSize ?? defaultMaxBatchSize,
    supportsDense: true,
    supportsMultiVector: false,
    supportsSparse: false,
    tokenizerVersion: "plugin-daemon",
    version: "plugin-daemon",
  };
}

function validateEmbeddingResponseVectors(vectors: readonly (readonly number[])[]): number {
  const dimension = vectors[0]?.length ?? 0;

  if (dimension < 1) {
    throw new ProviderResponseError("Plugin daemon returned an empty embedding vector");
  }

  for (const [index, vector] of vectors.entries()) {
    if (vector.length !== dimension) {
      throw new ProviderResponseError(
        `Plugin daemon returned inconsistent embedding dimension at index ${index}: ${vector.length}; expected ${dimension}`,
      );
    }

    if (!vector.every((value) => Number.isFinite(value))) {
      throw new ProviderResponseError(
        `Plugin daemon returned a non-finite embedding value at index ${index}`,
      );
    }
  }

  return dimension;
}

export interface PluginDaemonRerankerProviderOptions {
  readonly client: PluginDaemonClient;
  readonly credentials?: Record<string, unknown> | undefined;
  readonly maxDocuments?: number | undefined;
  readonly maxTextBytes?: number | undefined;
  readonly model: string;
  readonly models?: readonly RerankerModelInfo[] | undefined;
  readonly pluginId: string;
  readonly provider: string;
  readonly scoreThreshold?: number | undefined;
  readonly userId?: string | undefined;
}

const PluginDaemonRerankDataSchema = z.object({
  docs: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      score: z.number().finite().min(0).max(1),
      text: z.string().optional(),
    }),
  ),
  model: z.string().optional(),
});

/**
 * RerankerProvider backed by Dify's plugin-daemon `rerank` dispatch. The daemon returns scored
 * indices; the original documents are matched back by index. Tenant is required per call.
 */
export function createPluginDaemonRerankerProvider(
  options: PluginDaemonRerankerProviderOptions,
): RerankerProvider {
  if (!options.pluginId.trim()) {
    throw new ProviderInputError("Plugin daemon reranker pluginId is required");
  }

  if (!options.provider.trim()) {
    throw new ProviderInputError("Plugin daemon reranker provider is required");
  }

  if (!options.model.trim()) {
    throw new ProviderInputError("Plugin daemon reranker model is required");
  }

  const maxDocuments = options.maxDocuments ?? defaultMaxDocuments;
  const maxTextBytes = options.maxTextBytes ?? defaultMaxTextBytes;
  const credentials = options.credentials ?? {};
  const models = (options.models ?? [defaultPluginDaemonRerankerModel(options)]).map(
    cloneRerankerModelInfo,
  );

  return {
    kind: "plugin-daemon",
    async rerank(input) {
      validateRerankInput(input, { maxDocuments, maxTextBytes });

      const tenantId = input.tenantId?.trim();

      if (!tenantId) {
        throw new ProviderInputError("Plugin daemon rerank requires a tenantId");
      }

      const data = await options.client.dispatchUnary({
        data: {
          credentials,
          docs: input.documents.map((document) => document.text),
          model: input.model,
          model_type: "rerank",
          provider: options.provider,
          query: input.query,
          ...(options.scoreThreshold === undefined
            ? {}
            : { score_threshold: options.scoreThreshold }),
          ...(input.topN === undefined ? {} : { top_n: input.topN }),
        },
        op: "rerank",
        pluginId: options.pluginId,
        tenantId,
        ...(options.userId ? { userId: options.userId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      const parsed = PluginDaemonRerankDataSchema.safeParse(data);

      if (!parsed.success) {
        throw new ProviderResponseError("Plugin daemon returned an invalid rerank response", {
          cause: parsed.error,
        });
      }

      if (parsed.data.docs.length > input.documents.length) {
        throw new ProviderResponseError(
          `Plugin daemon returned ${parsed.data.docs.length} rerank results for ${input.documents.length} documents`,
        );
      }

      const seenIndices = new Set<number>();
      const items = parsed.data.docs.map((doc): RerankedDocument => {
        const original = input.documents[doc.index];

        if (!original) {
          throw new ProviderResponseError(
            `Plugin daemon returned out-of-range rerank index ${doc.index}`,
          );
        }
        if (seenIndices.has(doc.index)) {
          throw new ProviderResponseError(
            `Plugin daemon returned duplicate rerank index ${doc.index}`,
          );
        }
        seenIndices.add(doc.index);

        return {
          document: {
            id: original.id,
            metadata: original.metadata ?? {},
            text: original.text,
          },
          index: doc.index,
          score: doc.score,
        };
      });

      const model = (parsed.data.model ?? input.model).trim();
      if (!model || model !== input.model) {
        throw new ProviderResponseError(
          `Plugin daemon rerank model mismatch: requested=${input.model}, returned=${parsed.data.model ?? ""}`,
        );
      }

      return {
        items,
        metadata: { model, provider: "plugin-daemon" },
        model,
      };
    },
    async models() {
      return models.map(cloneRerankerModelInfo);
    },
  };
}

function defaultPluginDaemonRerankerModel(
  options: PluginDaemonRerankerProviderOptions,
): RerankerModelInfo {
  return {
    id: options.model,
    maxDocuments: options.maxDocuments ?? defaultMaxDocuments,
    maxInputTokens: 8192,
    provider: "plugin-daemon",
    version: "plugin-daemon",
  };
}

function validateEmbedInput(
  input: EmbedTextsInput,
  limits: { readonly maxBatchSize: number; readonly maxTextBytes: number },
): void {
  if (!input.model.trim()) {
    throw new ProviderInputError("Embedding model is required");
  }

  if (input.texts.length === 0) {
    throw new ProviderInputError("Embedding input must include at least one text");
  }

  if (input.texts.length > limits.maxBatchSize) {
    throw new ProviderInputError(
      `Embedding batch size ${input.texts.length} exceeds maxBatchSize=${limits.maxBatchSize}`,
    );
  }

  for (const [index, text] of input.texts.entries()) {
    if (text.length === 0) {
      throw new ProviderInputError(`Embedding text at index ${index} is empty`);
    }

    const bytes = textEncoder.encode(text).byteLength;

    if (bytes > limits.maxTextBytes) {
      throw new ProviderInputError(
        `Embedding text at index ${index} exceeds maxTextBytes=${limits.maxTextBytes}`,
      );
    }
  }
}

function validateRerankInput(
  input: RerankDocumentsInput,
  limits: { readonly maxDocuments: number; readonly maxTextBytes: number },
): void {
  if (!input.model.trim()) {
    throw new ProviderInputError("Reranker model is required");
  }

  if (!input.query.trim()) {
    throw new ProviderInputError("Reranker query is required");
  }

  if (input.documents.length === 0) {
    throw new ProviderInputError("Reranker input must include at least one document");
  }

  if (input.documents.length > limits.maxDocuments) {
    throw new ProviderInputError(
      `Reranker document count ${input.documents.length} exceeds maxDocuments=${limits.maxDocuments}`,
    );
  }

  if (input.topN !== undefined && (!Number.isSafeInteger(input.topN) || input.topN < 1)) {
    throw new ProviderInputError("Reranker topN must be a positive integer");
  }

  for (const [index, document] of input.documents.entries()) {
    if (!document.id.trim()) {
      throw new ProviderInputError(`Reranker document at index ${index} must include an id`);
    }

    if (!document.text.trim()) {
      throw new ProviderInputError(`Reranker document at index ${index} is empty`);
    }

    const bytes = textEncoder.encode(document.text).byteLength;

    if (bytes > limits.maxTextBytes) {
      throw new ProviderInputError(
        `Reranker document at index ${index} exceeds maxTextBytes=${limits.maxTextBytes}`,
      );
    }
  }
}

function findModel(
  models: readonly EmbeddingModelInfo[],
  model: string,
  provider: EmbeddingProviderKind,
): EmbeddingModelInfo {
  const modelInfo = models.find((candidate) => candidate.id === model);

  if (!modelInfo) {
    throw new Error(`Embedding model ${model} is not supported by ${provider} provider`);
  }

  return cloneModelInfo(modelInfo);
}

function findRerankerModel(
  models: readonly RerankerModelInfo[],
  model: string,
  provider: RerankerProviderKind,
): RerankerModelInfo {
  const modelInfo = models.find((candidate) => candidate.id === model);

  if (!modelInfo) {
    throw new Error(`Reranker model ${model} is not supported by ${provider} provider`);
  }

  return cloneRerankerModelInfo(modelInfo);
}

function stableVector(text: string, dimension: number): number[] {
  const digest = createHash("sha256").update(text).digest();
  const vector: number[] = [];

  for (let index = 0; index < dimension; index += 1) {
    vector.push(Number(((digest[index % digest.length] ?? 0) / 255).toFixed(6)));
  }

  return vector;
}

function tokenizeForRerank(input: string): Set<string> {
  return new Set(
    input
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter((token) => token.length > 0),
  );
}

function scoreStaticRerankDocument(queryTerms: ReadonlySet<string>, text: string): number {
  if (queryTerms.size === 0) {
    return 0;
  }

  const documentTerms = tokenizeForRerank(text);
  let matches = 0;

  for (const term of queryTerms) {
    if (documentTerms.has(term)) {
      matches += 1;
    }
  }

  return matches / queryTerms.size;
}

function validateCacheOptions(
  label: "Embedding cache" | "Rerank cache",
  {
    cacheVersion,
    maxEntryBytes,
    ttlMs,
  }: { readonly cacheVersion: string; readonly maxEntryBytes: number; readonly ttlMs: number },
): void {
  if (!cacheVersion.trim()) {
    throw new Error(`${label} cacheVersion is required`);
  }

  if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1) {
    throw new Error(`${label} maxEntryBytes must be at least 1`);
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error(`${label} ttlMs must be at least 1`);
  }
}

function embeddingCacheKey({
  cacheVersion,
  input,
  modelInfo,
  providerKind,
}: {
  readonly cacheVersion: string;
  readonly input: EmbedTextsInput;
  readonly modelInfo: EmbeddingModelInfo;
  readonly providerKind: EmbeddingProviderKind;
}): string {
  const digest = createHash("sha256")
    .update(
      stableJson({
        cacheVersion,
        inputType: input.inputType ?? null,
        model: modelInfo.id,
        modelVersion: modelInfo.version,
        providerKind,
        texts: input.texts.map(sha256Hex),
        tokenizerVersion: modelInfo.tokenizerVersion,
      }),
    )
    .digest("hex");

  return `embedding:${cacheVersion}:${digest}`;
}

function rerankCacheKey({
  cacheVersion,
  input,
  modelInfo,
  providerKind,
}: {
  readonly cacheVersion: string;
  readonly input: RerankDocumentsInput;
  readonly modelInfo: RerankerModelInfo;
  readonly providerKind: RerankerProviderKind;
}): string {
  const digest = createHash("sha256")
    .update(
      stableJson({
        cacheVersion,
        documents: input.documents.map((document) => ({
          id: document.id,
          metadata: stableJson(document.metadata ?? {}),
          text: sha256Hex(document.text),
        })),
        model: modelInfo.id,
        modelVersion: modelInfo.version,
        providerKind,
        query: sha256Hex(input.query),
        topN: input.topN ?? null,
      }),
    )
    .digest("hex");

  return `rerank:${cacheVersion}:${digest}`;
}

function encodeJson(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

function decodeEmbedTextsResult(bytes: Uint8Array): EmbedTextsResult | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as EmbedTextsResult;

    if (
      !payload ||
      typeof payload.model !== "string" ||
      !Array.isArray(payload.dense) ||
      typeof payload.metadata?.model !== "string" ||
      typeof payload.metadata?.provider !== "string"
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function decodeRerankDocumentsResult(bytes: Uint8Array): RerankDocumentsResult | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as RerankDocumentsResult;

    if (
      !payload ||
      typeof payload.model !== "string" ||
      !Array.isArray(payload.items) ||
      typeof payload.metadata?.model !== "string" ||
      typeof payload.metadata?.provider !== "string"
    ) {
      return null;
    }

    return cloneRerankDocumentsResult(payload);
  } catch {
    return null;
  }
}

function cloneEmbedTextsResult(result: EmbedTextsResult): EmbedTextsResult {
  return {
    dense: cloneDenseVectors(result.dense),
    metadata: cloneRecord(result.metadata) as EmbedTextsResult["metadata"],
    model: result.model,
    ...(result.sparse ? { sparse: result.sparse.map(cloneSparseVector) } : {}),
  };
}

function cloneRerankDocumentsResult(result: RerankDocumentsResult): RerankDocumentsResult {
  return {
    items: result.items.map(cloneRerankedDocument),
    metadata: cloneRecord(result.metadata) as RerankDocumentsResult["metadata"],
    model: result.model,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneDenseVectors(vectors: readonly (readonly number[])[]): number[][] {
  return vectors.map((vector) => [...vector]);
}

function cloneSparseVector(vector: SparseVector): SparseVector {
  return {
    indices: [...vector.indices],
    values: [...vector.values],
  };
}

function cloneModelInfo(model: EmbeddingModelInfo): EmbeddingModelInfo {
  return { ...model };
}

function cloneRerankerModelInfo(model: RerankerModelInfo): RerankerModelInfo {
  return { ...model };
}

function cloneRerankDocument(document: RerankDocumentInput): RerankedDocument["document"] {
  return {
    id: document.id,
    metadata: cloneRecord(document.metadata ?? {}),
    text: document.text,
  };
}

function cloneRerankedDocument(item: RerankedDocument): RerankedDocument {
  return {
    document: {
      id: item.document.id,
      metadata: cloneRecord(item.document.metadata),
      text: item.document.text,
    },
    index: item.index,
    score: item.score,
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}
