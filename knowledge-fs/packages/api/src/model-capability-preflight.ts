import { createHash } from "node:crypto";

import {
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceModelSelectionSchema,
  stableJson,
} from "@knowledge/core";
import type { EmbeddingProvider, RerankerProvider } from "@knowledge/embeddings";
import { z } from "zod";

import type { ImageBytesVisualEmbeddingProvider } from "./index-projection-builders";
import { resolveVectorIndexCapability } from "./vector-index-capability";

export const ModelCapabilityKindSchema = z.enum(["embedding", "reasoning", "rerank"]);
export type ModelCapabilityKind = z.infer<typeof ModelCapabilityKindSchema>;

export const ModelInputModalitySchema = z.enum(["text", "image"]);
export type ModelInputModality = z.infer<typeof ModelInputModalitySchema>;

const ModelInputModalitiesSchema = z
  .array(ModelInputModalitySchema)
  .min(1)
  .max(2)
  .refine((modalities) => modalities[0] === "text", {
    message: "Model input modalities must start with text",
  })
  .refine((modalities) => new Set(modalities).size === modalities.length, {
    message: "Model input modalities must be unique",
  });

export const ModelCatalogEntrySchema = z
  .object({
    capabilities: z.record(z.unknown()).default({}),
    kinds: z.array(ModelCapabilityKindSchema).min(1),
    model: z.string().trim().min(1).max(256),
    pluginId: z.string().trim().min(1).max(256),
    pluginUniqueIdentifier: z.string().trim().min(1).max(1024),
    pluginVersion: z.string().trim().min(1).max(256).optional(),
    provider: z.string().trim().min(1).max(256),
    schemaFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

export interface ResolveModelCatalogEntryInput {
  readonly kind: ModelCapabilityKind;
  readonly selection: KnowledgeSpaceModelSelection;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
}

export interface ListModelCatalogEntriesInput {
  readonly cursor?: string | undefined;
  readonly kind?: ModelCapabilityKind | undefined;
  readonly limit: number;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
}

export interface ListModelCatalogEntriesResult {
  readonly items: readonly ModelCatalogEntry[];
  readonly nextCursor?: string | undefined;
}

/** Tenant-scoped view of models that Dify reports as active and invokable. */
export interface ModelCapabilityCatalog {
  list(input: ListModelCatalogEntriesInput): Promise<ListModelCatalogEntriesResult>;
  resolve(input: ResolveModelCatalogEntryInput): Promise<ModelCatalogEntry | null>;
  /** Optional runtime validation before the active invocation probe. */
  validate?(input: ResolveModelCatalogEntryInput): Promise<boolean>;
}

export const ModelCapabilitySnapshotSchema = z
  .object({
    capabilityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    checkedAt: z.string().datetime({ offset: true }),
    dimension: z.number().int().positive().optional(),
    distanceMetric: z.enum(["cosine", "dot", "l2"]).optional(),
    /**
     * Normalized input modalities frozen from the tenant-active model catalog. Optional only for
     * capability snapshots created before modality-aware profiles were introduced.
     */
    inputModalities: ModelInputModalitiesSchema.optional(),
    kind: ModelCapabilityKindSchema,
    pluginUniqueIdentifier: z.string().trim().min(1).max(1024),
    pluginVersion: z.string().trim().min(1).max(256).optional(),
    schemaFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    selection: KnowledgeSpaceModelSelectionSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.kind === "embedding" && snapshot.dimension === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Embedding capability snapshots require an observed dimension",
        path: ["dimension"],
      });
    }
    if (snapshot.kind !== "embedding" && snapshot.dimension !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only embedding capability snapshots may contain a dimension",
        path: ["dimension"],
      });
    }
  });
export type ModelCapabilitySnapshot = z.infer<typeof ModelCapabilitySnapshotSchema>;

export function modelCapabilitySupportsInput(
  snapshot: Pick<ModelCapabilitySnapshot, "inputModalities"> | null | undefined,
  modality: ModelInputModality,
): boolean {
  return snapshot?.inputModalities?.includes(modality) === true;
}

export type ModelCapabilityPreflightErrorCode =
  | "EMBEDDING_DIMENSION_INVALID"
  | "EMBEDDING_DIMENSION_UNSUPPORTED"
  | "MODEL_CAPABILITY_MISMATCH"
  | "MODEL_CREDENTIAL_INVALID"
  | "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE"
  | "MODEL_IDENTITY_MISMATCH"
  | "MODEL_PREFLIGHT_CANCELED"
  | "MODEL_PREFLIGHT_FAILED"
  | "MODEL_PREFLIGHT_TIMEOUT"
  | "MODEL_PREFLIGHT_UNAVAILABLE"
  | "MODEL_SELECTION_NOT_FOUND";

export class ModelCapabilityPreflightError extends Error {
  readonly code: ModelCapabilityPreflightErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ModelCapabilityPreflightErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelCapabilityPreflightError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface ModelCapabilityPreflightInput extends ResolveModelCatalogEntryInput {
  readonly signal?: AbortSignal | undefined;
}

export interface ModelCapabilityPreflight {
  /**
   * Captures a tenant-active catalog declaration without invoking the model. This is used for
   * configured non-embedding models whose credentials were already checked by Dify.
   */
  resolveConfigured?(input: ModelCapabilityPreflightInput): Promise<ModelCapabilitySnapshot>;
  verify(input: ModelCapabilityPreflightInput): Promise<ModelCapabilitySnapshot>;
}

export interface ModelCapabilityPreflightOptions {
  readonly catalog: ModelCapabilityCatalog;
  readonly embeddingProviderFactory: (selection: KnowledgeSpaceModelSelection) => EmbeddingProvider;
  /** Required when the catalog declares `vision` for an embedding model. */
  readonly imageEmbeddingProviderFactory?:
    | ((selection: KnowledgeSpaceModelSelection) => ImageBytesVisualEmbeddingProvider)
    | undefined;
  readonly now?: (() => string) | undefined;
  readonly reasoningProviderFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => ReasoningModelPreflightProvider;
  readonly rerankerProviderFactory: (selection: KnowledgeSpaceModelSelection) => RerankerProvider;
  readonly timeoutMs?: number | undefined;
  /**
   * Production vector storage dialect. Embedding models are probed dynamically, then rejected
   * only when their observed dimension cannot be stored by this backend. Dimensions that merely
   * exceed an ANN index limit remain valid and use the exact-search fallback.
   */
  readonly vectorStorageDialect?: "postgres" | "tidb" | undefined;
}

/** Structural subset implemented by the Dify-managed LLM provider without coupling API to it. */
export interface ReasoningModelPreflightProvider {
  generate(input: {
    readonly maxOutputTokens: number;
    readonly messages: readonly { readonly content: string; readonly role: "user" }[];
    readonly model: string;
    readonly signal: AbortSignal;
    readonly temperature: number;
    readonly tenantId: string;
  }): Promise<{
    readonly metadata: { readonly model: string };
    readonly model: string;
    readonly text: string;
  }>;
}

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 15_000;
const PREFLIGHT_EMBEDDING_SENTINEL = "knowledge-fs model capability preflight";
// 1x1 transparent PNG. A real image payload verifies the provider's multimodal dispatch and
// catches models that advertise `vision` but only implement text embedding.
const PREFLIGHT_IMAGE_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

/**
 * Verifies that a catalog declaration is actually invokable before a profile revision can be
 * persisted. Provider errors are deliberately collapsed to a stable, non-secret response.
 */
export function createModelCapabilityPreflight({
  catalog,
  embeddingProviderFactory,
  imageEmbeddingProviderFactory,
  now = () => new Date().toISOString(),
  reasoningProviderFactory,
  rerankerProviderFactory,
  timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS,
  vectorStorageDialect,
}: ModelCapabilityPreflightOptions): ModelCapabilityPreflight {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Model capability preflight timeoutMs must be a positive integer");
  }

  return {
    resolveConfigured: async (input) => {
      const tenantId = input.tenantId.trim();
      if (!tenantId) {
        throw new ModelCapabilityPreflightError(
          "MODEL_CAPABILITY_MISMATCH",
          "Model capability resolution requires a tenant",
        );
      }
      const kind = ModelCapabilityKindSchema.parse(input.kind);
      if (kind === "embedding") {
        throw new ModelCapabilityPreflightError(
          "EMBEDDING_DIMENSION_INVALID",
          "Embedding capabilities require an observed vector dimension",
        );
      }
      const selection = KnowledgeSpaceModelSelectionSchema.parse(input.selection);
      const scoped = createPreflightAbortScope(input.signal, timeoutMs);
      try {
        return await scoped.race(
          (async () => {
            const catalogEntry = await resolveCatalogDeclaration({
              catalog,
              kind,
              selection,
              signal: scoped.signal,
              tenantId,
            });
            assertPreflightActive(scoped.signal);
            return capabilitySnapshot({
              catalogEntry,
              checkedAt: z.string().datetime({ offset: true }).parse(now()),
              kind,
              selection,
            });
          })(),
        );
      } catch (error) {
        if (error instanceof ModelCapabilityPreflightError) throw error;
        throw normalizePreflightProviderError(error);
      } finally {
        scoped.dispose();
      }
    },
    verify: async (input) => {
      const tenantId = input.tenantId.trim();
      if (!tenantId) {
        throw new ModelCapabilityPreflightError(
          "MODEL_CAPABILITY_MISMATCH",
          "Model capability preflight requires a tenant",
        );
      }
      const kind = ModelCapabilityKindSchema.parse(input.kind);
      const selection = KnowledgeSpaceModelSelectionSchema.parse(input.selection);
      const scoped = createPreflightAbortScope(input.signal, timeoutMs);
      try {
        return await scoped.race(
          (async () => {
            assertPreflightActive(scoped.signal);
            const catalogEntry = await resolveCatalogDeclaration({
              catalog,
              kind,
              selection,
              signal: scoped.signal,
              tenantId,
            });
            if (catalog.validate) {
              let valid: boolean;
              try {
                valid = await catalog.validate({
                  kind,
                  selection,
                  signal: scoped.signal,
                  tenantId,
                });
              } catch (cause) {
                throw new ModelCapabilityPreflightError(
                  "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE",
                  "The selected model's credentials could not be validated",
                  { cause, retryable: true },
                );
              }
              assertPreflightActive(scoped.signal);
              if (!valid) {
                throw new ModelCapabilityPreflightError(
                  "MODEL_CREDENTIAL_INVALID",
                  "The selected model's credentials are not valid",
                );
              }
            }

            const observed = await invokePreflight({
              catalogEntry,
              embeddingProviderFactory,
              imageEmbeddingProviderFactory,
              kind,
              reasoningProviderFactory,
              rerankerProviderFactory,
              selection,
              signal: scoped.signal,
              tenantId,
            });
            if (
              kind === "embedding" &&
              vectorStorageDialect &&
              observed.dimension !== undefined &&
              observed.distanceMetric !== undefined
            ) {
              const storage = resolveVectorIndexCapability({
                dialect: vectorStorageDialect,
                dimension: observed.dimension,
                metric: observed.distanceMetric,
              });
              if (storage.status === "unsupported") {
                throw new ModelCapabilityPreflightError(
                  "EMBEDDING_DIMENSION_UNSUPPORTED",
                  `The embedding model dimension=${observed.dimension} exceeds ${vectorStorageDialect} vector storage capacity`,
                );
              }
            }
            assertPreflightActive(scoped.signal);
            return capabilitySnapshot({
              catalogEntry,
              checkedAt: z.string().datetime({ offset: true }).parse(now()),
              kind,
              observed,
              selection,
            });
          })(),
        );
      } catch (error) {
        if (error instanceof ModelCapabilityPreflightError) {
          throw error;
        }
        throw normalizePreflightProviderError(error);
      } finally {
        scoped.dispose();
      }
    },
  };
}

async function resolveCatalogDeclaration({
  catalog,
  kind,
  selection,
  signal,
  tenantId,
}: {
  readonly catalog: ModelCapabilityCatalog;
  readonly kind: ModelCapabilityKind;
  readonly selection: KnowledgeSpaceModelSelection;
  readonly signal: AbortSignal;
  readonly tenantId: string;
}): Promise<ModelCatalogEntry> {
  assertPreflightActive(signal);
  let entry: ModelCatalogEntry | null;
  try {
    entry = await catalog.resolve({ kind, selection, signal, tenantId });
  } catch (cause) {
    throw new ModelCapabilityPreflightError(
      "MODEL_PREFLIGHT_UNAVAILABLE",
      "Model capability catalog is temporarily unavailable",
      { cause, retryable: true },
    );
  }
  assertPreflightActive(signal);
  if (!entry) {
    throw new ModelCapabilityPreflightError(
      "MODEL_SELECTION_NOT_FOUND",
      "The selected model is not installed for this tenant",
    );
  }
  const catalogEntry = ModelCatalogEntrySchema.parse(entry);
  assertCatalogIdentity({ catalogEntry, kind, selection });
  return catalogEntry;
}

function capabilitySnapshot({
  catalogEntry,
  checkedAt,
  kind,
  observed = {},
  selection,
}: {
  readonly catalogEntry: ModelCatalogEntry;
  readonly checkedAt: string;
  readonly kind: ModelCapabilityKind;
  readonly observed?: {
    readonly dimension?: number | undefined;
    readonly distanceMetric?: "cosine" | "dot" | "l2" | undefined;
  };
  readonly selection: KnowledgeSpaceModelSelection;
}): ModelCapabilitySnapshot {
  const capabilityMaterial = {
    ...(observed.dimension === undefined ? {} : { dimension: observed.dimension }),
    ...(observed.distanceMetric === undefined ? {} : { distanceMetric: observed.distanceMetric }),
    inputModalities: modelInputModalitiesFromCatalogCapabilities(catalogEntry.capabilities),
    kind,
    pluginUniqueIdentifier: catalogEntry.pluginUniqueIdentifier,
    ...(catalogEntry.pluginVersion ? { pluginVersion: catalogEntry.pluginVersion } : {}),
    schemaFingerprint: catalogEntry.schemaFingerprint,
    selection,
  };
  return ModelCapabilitySnapshotSchema.parse({
    ...capabilityMaterial,
    capabilityDigest: `sha256:${createHash("sha256")
      .update(stableJson({ ...capabilityMaterial, capabilities: catalogEntry.capabilities }))
      .digest("hex")}`,
    checkedAt,
  });
}

export function modelInputModalitiesFromCatalogCapabilities(
  capabilities: Readonly<Record<string, unknown>>,
): ModelInputModality[] {
  const features = Array.isArray(capabilities.features) ? capabilities.features : [];
  const supportsVision = features.some(
    (feature) => typeof feature === "string" && feature.trim().toLowerCase() === "vision",
  );
  return supportsVision ? ["text", "image"] : ["text"];
}

function assertCatalogIdentity({
  catalogEntry,
  kind,
  selection,
}: {
  readonly catalogEntry: ModelCatalogEntry;
  readonly kind: ModelCapabilityKind;
  readonly selection: KnowledgeSpaceModelSelection;
}): void {
  if (
    catalogEntry.pluginId !== selection.pluginId ||
    catalogEntry.provider !== selection.provider ||
    catalogEntry.model !== selection.model
  ) {
    throw new ModelCapabilityPreflightError(
      "MODEL_IDENTITY_MISMATCH",
      "The model catalog returned a different model identity",
    );
  }
  if (!catalogEntry.kinds.includes(kind)) {
    throw new ModelCapabilityPreflightError(
      "MODEL_CAPABILITY_MISMATCH",
      "The selected model does not support the requested capability",
    );
  }
}

async function invokePreflight({
  catalogEntry,
  embeddingProviderFactory,
  imageEmbeddingProviderFactory,
  kind,
  reasoningProviderFactory,
  rerankerProviderFactory,
  selection,
  signal,
  tenantId,
}: {
  readonly catalogEntry: ModelCatalogEntry;
  readonly embeddingProviderFactory: ModelCapabilityPreflightOptions["embeddingProviderFactory"];
  readonly imageEmbeddingProviderFactory: ModelCapabilityPreflightOptions["imageEmbeddingProviderFactory"];
  readonly kind: ModelCapabilityKind;
  readonly reasoningProviderFactory: ModelCapabilityPreflightOptions["reasoningProviderFactory"];
  readonly rerankerProviderFactory: ModelCapabilityPreflightOptions["rerankerProviderFactory"];
  readonly selection: KnowledgeSpaceModelSelection;
  readonly signal: AbortSignal;
  readonly tenantId: string;
}): Promise<{ readonly dimension?: number; readonly distanceMetric?: "cosine" | "dot" | "l2" }> {
  if (kind === "embedding") {
    const provider = embeddingProviderFactory(selection);
    const result = await provider.embed({
      inputType: "search_query",
      model: selection.model,
      signal,
      tenantId,
      texts: [PREFLIGHT_EMBEDDING_SENTINEL],
    });
    assertPreflightActive(signal);
    assertObservedIdentity(selection.model, result.model);
    const vector = result.dense[0];
    if (
      result.dense.length !== 1 ||
      !vector ||
      vector.length < 1 ||
      !vector.every(Number.isFinite) ||
      (result.metadata.dimension !== undefined && result.metadata.dimension !== vector.length)
    ) {
      throw new ModelCapabilityPreflightError(
        "EMBEDDING_DIMENSION_INVALID",
        "The embedding model returned an invalid vector dimension",
      );
    }
    const modelInfo = (await provider.models()).find((model) => model.id === selection.model);
    assertPreflightActive(signal);
    if (modelInfo?.dimension !== undefined && modelInfo.dimension !== vector.length) {
      throw new ModelCapabilityPreflightError(
        "EMBEDDING_DIMENSION_INVALID",
        "The embedding model returned a dimension that conflicts with its capability declaration",
      );
    }
    if (modelInputModalitiesFromCatalogCapabilities(catalogEntry.capabilities).includes("image")) {
      if (!imageEmbeddingProviderFactory) {
        throw new ModelCapabilityPreflightError(
          "MODEL_CAPABILITY_MISMATCH",
          "The vision embedding model cannot be verified with image input",
        );
      }
      const imageProvider = imageEmbeddingProviderFactory(selection);
      // Document indexing and image-query retrieval use distinct provider input types. Verify both
      // before activation so a catalog-level `vision` declaration cannot publish an index that the
      // interactive query path is unable to search.
      for (const inputType of ["document", "query"] as const) {
        const imageResult = await imageProvider.embedImages({
          images: [
            {
              assetRef: {},
              body: PREFLIGHT_IMAGE_PNG,
              contentType: "image/png",
              documentAssetId: "model-capability-preflight-document",
              metadata: {},
              modality: "image",
              nodeId: "model-capability-preflight-image",
              objectKey: "model-capability-preflight.png",
              sourceText: "",
            },
          ],
          inputType,
          model: selection.model,
          signal,
          tenantId,
        });
        assertPreflightActive(signal);
        assertObservedIdentity(selection.model, imageResult.model);
        assertObservedIdentity(selection.model, imageResult.metadata.model);
        const imageVector = imageResult.dense[0];
        if (
          imageResult.dense.length !== 1 ||
          !imageVector ||
          imageVector.length !== vector.length ||
          !imageVector.every(Number.isFinite)
        ) {
          throw new ModelCapabilityPreflightError(
            "EMBEDDING_DIMENSION_INVALID",
            "The vision embedding model returned an image vector outside its text vector space",
          );
        }
      }
    }
    return { dimension: vector.length, distanceMetric: modelInfo?.distanceMetric ?? "cosine" };
  }

  if (kind === "rerank") {
    const documents = [
      { id: "preflight-relevant", text: "knowledge retrieval" },
      { id: "preflight-control", text: "unrelated control" },
    ];
    const topN = 2;
    const result = await rerankerProviderFactory(selection).rerank({
      documents,
      model: selection.model,
      query: "knowledge retrieval",
      signal,
      tenantId,
      topN,
    });
    assertPreflightActive(signal);
    assertObservedIdentity(selection.model, result.model);
    assertObservedIdentity(selection.model, result.metadata?.model);
    const seenDocumentIds = new Set<string>();
    const seenIndices = new Set<number>();
    const items = Array.isArray(result.items) ? result.items : [];
    const invalidItems =
      items.length < 1 ||
      items.length > topN ||
      items.some((item) => {
        const returnedDocument = item.document;
        const original = documents[item.index];
        const invalid =
          !Number.isInteger(item.index) ||
          !original ||
          !returnedDocument ||
          seenIndices.has(item.index) ||
          seenDocumentIds.has(returnedDocument.id) ||
          returnedDocument.id !== original.id ||
          returnedDocument.text !== original.text ||
          !Number.isFinite(item.score) ||
          item.score < 0 ||
          item.score > 1;
        seenIndices.add(item.index);
        if (returnedDocument) {
          seenDocumentIds.add(returnedDocument.id);
        }
        return invalid;
      });
    if (invalidItems) {
      throw new ModelCapabilityPreflightError(
        "MODEL_CAPABILITY_MISMATCH",
        "The rerank model returned an invalid capability response",
      );
    }
    return {};
  }

  const result = await reasoningProviderFactory(selection).generate({
    maxOutputTokens: 512,
    messages: [{ content: "Reply OK.", role: "user" }],
    model: selection.model,
    signal,
    temperature: 0,
    tenantId,
  });
  assertPreflightActive(signal);
  if (typeof result.text !== "string" || !result.text.trim()) {
    throw new ModelCapabilityPreflightError(
      "MODEL_CAPABILITY_MISMATCH",
      "The reasoning model returned an invalid capability response",
    );
  }
  assertObservedIdentity(selection.model, result.model);
  assertObservedIdentity(selection.model, result.metadata?.model);
  return {};
}

function assertObservedIdentity(requested: string, observed: unknown): void {
  if (typeof observed !== "string" || !observed.trim() || observed.trim() !== requested) {
    throw new ModelCapabilityPreflightError(
      "MODEL_IDENTITY_MISMATCH",
      "The model response identity did not match the selected model",
    );
  }
}

function assertPreflightActive(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Model capability preflight was aborted");
}

function createPreflightAbortScope(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly dispose: () => void;
  readonly race: <T>(operation: Promise<T>) => Promise<T>;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  let rejectBoundary: ((reason: unknown) => void) | undefined;
  let settled = false;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const abort = (error: ModelCapabilityPreflightError) => {
    if (settled) {
      return;
    }
    settled = true;
    controller.abort(error);
    rejectBoundary?.(error);
  };
  const abortFromParent = () =>
    abort(
      new ModelCapabilityPreflightError(
        "MODEL_PREFLIGHT_CANCELED",
        "The selected model capability preflight was canceled",
        { cause: parentSignal?.reason, retryable: true },
      ),
    );
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeout = setTimeout(() => {
    abort(
      new ModelCapabilityPreflightError(
        "MODEL_PREFLIGHT_TIMEOUT",
        "The selected model capability preflight timed out",
        { retryable: true },
      ),
    );
  }, timeoutMs);
  return {
    dispose: () => {
      settled = true;
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    race: <T>(operation: Promise<T>) => Promise.race([operation, boundary]),
    signal: controller.signal,
  };
}

function normalizePreflightProviderError(error: unknown): ModelCapabilityPreflightError {
  const providerCode =
    error && typeof error === "object" && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  const normalizedProviderCode =
    typeof providerCode === "string" ? providerCode.trim().toLowerCase() : "";
  const retryable =
    error && typeof error === "object" && "retryable" in error
      ? (error as { readonly retryable?: unknown }).retryable === true
      : true;

  if (normalizedProviderCode.includes("timeout")) {
    return new ModelCapabilityPreflightError(
      "MODEL_PREFLIGHT_TIMEOUT",
      "The selected model capability preflight timed out",
      { cause: error, retryable: true },
    );
  }
  if (
    normalizedProviderCode.includes("abort") ||
    normalizedProviderCode.includes("cancel") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new ModelCapabilityPreflightError(
      "MODEL_PREFLIGHT_CANCELED",
      "The selected model capability preflight was canceled",
      { cause: error, retryable: true },
    );
  }
  if (
    normalizedProviderCode.includes("request_failed") ||
    normalizedProviderCode.includes("unavailable")
  ) {
    return new ModelCapabilityPreflightError(
      "MODEL_PREFLIGHT_UNAVAILABLE",
      "The selected model service is temporarily unavailable",
      { cause: error, retryable },
    );
  }
  return new ModelCapabilityPreflightError(
    "MODEL_PREFLIGHT_FAILED",
    "The selected model failed its capability preflight",
    { cause: error, retryable },
  );
}
