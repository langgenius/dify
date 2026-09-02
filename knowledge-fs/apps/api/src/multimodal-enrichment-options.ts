import {
  type ConcurrencyGate,
  type DocumentMultimodalUnderstandingProvider,
  type DocumentMultimodalUnderstandingProviderInput,
  type DocumentMultimodalUnderstandingProviderResult,
  type EnhanceDocumentMultimodalManifestInput,
  type KnowledgeGatewayOptions,
  ModelCapabilitySnapshotSchema,
  type ModelInputModalityResolver,
  type PublishedKnowledgeSpaceRuntimeSnapshotResolver,
  createCompositeDocumentMultimodalEnrichmentProvider,
  createConcurrencyGate,
  createDocumentMultimodalManifestEnhancer,
  createMetadataDocumentMultimodalEnrichmentProvider,
  createUnderstandingDocumentMultimodalEnrichmentProvider,
} from "@knowledge/api";
import { DocumentMultimodalManifestSchema } from "@knowledge/core";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
  difyLlmCompletion,
  difyModelRuntimeRequired,
} from "./dify-model-runtime-options";

/** @deprecated Production model routing is profile-driven; retained only for source compatibility. */
export interface ApiMultimodalEnrichmentEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE?: string | undefined;
}

export interface ApiProfileMultimodalEnrichmentEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE?: string | undefined;
}

/**
 * @deprecated Production assembly uses `createApiProfileMultimodalEnrichmentOptions`. This legacy
 * helper remains temporarily source-compatible but is not read by the running service.
 */
export function createApiMultimodalEnrichmentOptions({
  env = process.env,
  objectStorage,
}: {
  readonly env?: ApiMultimodalEnrichmentEnv | undefined;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
}): Partial<KnowledgeGatewayOptions> {
  if (!enrichmentEnabled(env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER)) {
    return {};
  }

  const model = difyModelRuntimeRequired(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MODEL",
    "multimodal enrichment",
  );
  const understandingProvider = createDifyMultimodalUnderstandingProvider({
    client: createApiDifyModelRuntimeClient(env),
    imageDetail: imageDetailEnv(env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL),
    maxImageBytes: positiveIntegerEnv(
      env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES,
      10 * 1024 * 1024,
      "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES",
    ),
    maxOutputTokens: positiveIntegerEnv(
      env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS,
      1_000,
      "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS",
    ),
    objectStorage,
    pluginId: difyModelRuntimeRequired(
      env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID,
      "KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID",
      "multimodal enrichment",
    ),
    provider: difyModelRuntimeRequired(
      env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER,
      "KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_PROVIDER",
      "multimodal enrichment",
    ),
    temperature: nonNegativeNumberEnv(
      env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE,
      0,
      "KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE",
    ),
  });

  return {
    documentMultimodalManifestEnhancer: createDocumentMultimodalManifestEnhancer({
      maxConcurrency: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY,
        4,
        "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY",
      ),
      maxItems: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS,
        100,
        "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS",
      ),
      maxSourceTextChars: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS,
        4_000,
        "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS",
      ),
      model,
      promptVersion: "multimodal-understanding-v1",
      provider: createCompositeDocumentMultimodalEnrichmentProvider({
        providers: [
          createMetadataDocumentMultimodalEnrichmentProvider(),
          createUnderstandingDocumentMultimodalEnrichmentProvider({
            maxSummaryChars: positiveIntegerEnv(
              env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS,
              2_000,
              "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS",
            ),
            provider: understandingProvider,
          }),
        ],
      }),
    }),
  };
}

/**
 * Builds profile-scoped document image understanding. Model/provider identity is read from the
 * publication-bound reasoning profile; deployment variables only provide resource ceilings.
 */
export function createApiProfileMultimodalEnrichmentOptions({
  env = process.env,
  modelInputModalityResolver,
  modelRequestGate,
  objectStorage,
  runtimeSnapshots,
}: {
  readonly env?: ApiProfileMultimodalEnrichmentEnv | undefined;
  readonly modelInputModalityResolver: ModelInputModalityResolver;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
  readonly runtimeSnapshots: PublishedKnowledgeSpaceRuntimeSnapshotResolver;
}): Partial<KnowledgeGatewayOptions> {
  const client = createApiDifyModelRuntimeClient(env);
  const promptVersion = "multimodal-understanding-v1";
  const maxConcurrency = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY,
    4,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY",
  );
  const maxItems = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS,
    100,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_ITEMS",
  );
  const maxSourceTextChars = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS,
    4_000,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SOURCE_TEXT_CHARS",
  );
  const maxSummaryChars = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS,
    2_000,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_SUMMARY_CHARS",
  );
  const imageDetail = imageDetailEnv(env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL);
  const maxImageBytes = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES,
    10 * 1024 * 1024,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_IMAGE_BYTES",
  );
  const maxOutputTokens = positiveIntegerEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS,
    1_000,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_OUTPUT_TOKENS",
  );
  const temperature = nonNegativeNumberEnv(
    env.KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE,
    0,
    "KNOWLEDGE_MULTIMODAL_ENRICHMENT_TEMPERATURE",
  );
  // Unlike the per-manifest worker pool below, this gate is shared by the entire API process so
  // several documents cannot multiply the configured number of simultaneous VLM requests.
  const modelCallGate = createConcurrencyGate(maxConcurrency);
  const resolve = async (input: {
    readonly knowledgeSpaceId: string;
    readonly signal?: AbortSignal | undefined;
    readonly tenantId?: string | undefined;
  }) => {
    const tenantId = input.tenantId?.trim();
    if (!tenantId) {
      return {
        cacheModel: "profile-reasoning:tenant-unavailable",
        inputModalities: ["text"] as const,
      };
    }
    const runtime = await runtimeSnapshots.resolve({
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId,
    });
    const capability = ModelCapabilitySnapshotSchema.safeParse(
      runtime.retrievalCapabilitySnapshot.reasoning,
    );
    if (!capability.success) {
      return {
        cacheModel: "profile-reasoning:capability-invalid:text",
        inputModalities: ["text"] as const,
      };
    }
    const inputModalities = await modelInputModalityResolver.resolve({
      ...(input.signal ? { signal: input.signal } : {}),
      snapshot: capability.data,
      tenantId,
    });
    return {
      // Include the resolved modality set so a transient fail-closed legacy catalog lookup does
      // not make a text-only cache entry permanently mask later verified image capability.
      cacheModel: `profile-reasoning:${capability.data.capabilityDigest}:${inputModalities.join("+")}`,
      inputModalities,
      selection: runtime.retrievalProfile.reasoningModel,
    };
  };
  const resolvedByInput = new WeakMap<
    EnhanceDocumentMultimodalManifestInput,
    Awaited<ReturnType<typeof resolve>>
  >();

  return {
    documentMultimodalManifestEnhancer: {
      cacheIdentity: async (input) => {
        const resolved = await resolve({
          knowledgeSpaceId: input.manifest.knowledgeSpaceId,
          ...(input.signal ? { signal: input.signal } : {}),
          tenantId: input.tenantId,
        });
        resolvedByInput.set(input, resolved);
        return { model: resolved.cacheModel, promptVersion };
      },
      enhance: async (input) => {
        const resolved =
          resolvedByInput.get(input) ??
          (await resolve({
            knowledgeSpaceId: input.manifest.knowledgeSpaceId,
            ...(input.signal ? { signal: input.signal } : {}),
            tenantId: input.tenantId,
          }));
        resolvedByInput.delete(input);
        if (!resolved.selection || !resolved.inputModalities.includes("image")) {
          const manifest = DocumentMultimodalManifestSchema.parse(input.manifest);
          return DocumentMultimodalManifestSchema.parse({
            ...manifest,
            metadata: {
              ...manifest.metadata,
              enrichment: {
                attemptedItems: 0,
                enhancedItems: 0,
                failedItems: 0,
                model: resolved.cacheModel,
                promptVersion,
                skippedItems: manifest.items.length,
                skippedReason: "reasoning-model-text-only",
                source: "profile-capability",
              },
            },
          });
        }
        return createDocumentMultimodalManifestEnhancer({
          maxConcurrency,
          maxItems,
          maxSourceTextChars,
          model: resolved.cacheModel,
          promptVersion,
          provider: createCompositeDocumentMultimodalEnrichmentProvider({
            providers: [
              createMetadataDocumentMultimodalEnrichmentProvider(),
              createUnderstandingDocumentMultimodalEnrichmentProvider({
                maxSummaryChars,
                provider: concurrencyBoundUnderstandingProvider(
                  createDifyMultimodalUnderstandingProvider({
                    client,
                    imageDetail,
                    maxImageBytes,
                    maxOutputTokens,
                    modelRequestGate,
                    objectStorage,
                    pluginId: resolved.selection.pluginId,
                    provider: resolved.selection.provider,
                    temperature,
                  }),
                  modelCallGate,
                ),
              }),
            ],
          }),
          providerModel: resolved.selection.model,
        }).enhance(input);
      },
      model: "profile-reasoning",
      promptVersion,
    },
  };
}

function concurrencyBoundUnderstandingProvider(
  provider: DocumentMultimodalUnderstandingProvider,
  gate: ReturnType<typeof createConcurrencyGate>,
): DocumentMultimodalUnderstandingProvider {
  return {
    kind: provider.kind,
    understand: (input) => gate.run(() => provider.understand(input), { signal: input.signal }),
  };
}

interface DifyMultimodalUnderstandingProviderOptions {
  readonly client: ReturnType<typeof createApiDifyModelRuntimeClient>;
  readonly imageDetail: "auto" | "high" | "low";
  readonly maxImageBytes: number;
  readonly maxOutputTokens: number;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
  readonly pluginId: string;
  readonly provider: string;
  readonly temperature: number;
}

function createDifyMultimodalUnderstandingProvider({
  client,
  imageDetail,
  maxImageBytes,
  maxOutputTokens,
  modelRequestGate,
  objectStorage,
  pluginId,
  provider,
  temperature,
}: DifyMultimodalUnderstandingProviderOptions): DocumentMultimodalUnderstandingProvider {
  return {
    kind: "dify-model-runtime",
    understand: async (input) => {
      const tenantId = input.tenantId?.trim();

      if (!tenantId) {
        throw new Error("Dify model runtime multimodal enrichment requires a tenantId");
      }

      // understandingMessages produces dify PromptMessageContent parts; see the
      // content-part serialization note in multimodal-answer-options.ts.
      const messages = await understandingMessages({
        imageDetail,
        input,
        maxImageBytes,
        objectStorage,
      });
      const request = () =>
        difyLlmCompletion({
          client,
          maxOutputTokens,
          model: input.model,
          pluginId,
          promptMessages: messages,
          provider,
          ...(input.signal ? { signal: input.signal } : {}),
          temperature,
          tenantId,
        });
      const result = modelRequestGate
        ? await modelRequestGate.run(request, { signal: input.signal })
        : await request();

      return parseUnderstandingResult(result.text);
    },
  };
}

// Content parts follow dify's PromptMessageContent entities: text = `{type:"text", data}`;
// image = `{type:"image", format, base64_data, mime_type, detail:"low"|"high"}` ("auto" → "low",
// dify's default). See the serialization note in multimodal-answer-options.ts.
async function understandingMessages({
  imageDetail,
  input,
  maxImageBytes,
  objectStorage,
}: {
  readonly imageDetail: "auto" | "high" | "low";
  readonly input: DocumentMultimodalUnderstandingProviderInput;
  readonly maxImageBytes: number;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
}) {
  const image = await objectBackedImageSource({ input, maxImageBytes, objectStorage });

  return [
    {
      content: [
        "You enrich document multimodal inventory items.",
        "Return strict JSON only with optional fields: title, caption, summary, ocrText, tableStructureStatus.",
        "tableStructureStatus may be provided, missing, unsupported, or pending.",
      ].join("\n"),
      role: "system",
    },
    {
      content: [
        {
          data: [
            `Task: ${input.task}`,
            `Modality: ${input.item.modality}`,
            `Existing title: ${input.item.title ?? ""}`,
            `Existing caption: ${input.item.caption ?? ""}`,
            `Existing OCR: ${input.item.ocrText ?? ""}`,
            `Source text: ${input.sourceText ?? ""}`,
          ].join("\n"),
          type: "text",
        },
        ...(image
          ? [
              {
                base64_data: image.base64Data,
                detail: imageDetail === "high" ? "high" : "low",
                format: image.mimeType.split("/")[1] ?? "png",
                mime_type: image.mimeType,
                type: "image",
              },
            ]
          : []),
      ],
      role: "user",
    },
  ];
}

async function objectBackedImageSource({
  input,
  maxImageBytes,
  objectStorage,
}: {
  readonly input: DocumentMultimodalUnderstandingProviderInput;
  readonly maxImageBytes: number;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
}): Promise<{ base64Data: string; mimeType: string } | undefined> {
  const assetRef = input.item.assetRef;
  const thumbnail = assetRef?.variants?.thumbnail;
  const candidate = thumbnail?.objectKey ? thumbnail : assetRef;
  const objectKey = candidate?.objectKey;
  const contentType = candidate?.contentType;

  if (!objectKey || !contentType?.startsWith("image/")) {
    return undefined;
  }

  input.signal?.throwIfAborted();
  const stream = await objectStorage.getObjectStream(objectKey);
  input.signal?.throwIfAborted();
  if (!stream) {
    return undefined;
  }
  const body = await readBoundedEnrichmentImageStream(stream, maxImageBytes, input.signal);
  if (!body) return undefined;

  return { base64Data: Buffer.from(body).toString("base64"), mimeType: contentType };
}

async function readBoundedEnrichmentImageStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let closed = false;
  let totalBytes = 0;
  const cancel = async (reason?: unknown): Promise<void> => {
    if (closed) return;
    closed = true;
    await reader.cancel(reason).catch(() => undefined);
  };
  const onAbort = () => void cancel(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        closed = true;
        break;
      }
      if (value.byteLength > maxBytes - totalBytes) {
        await cancel(new Error(`Multimodal enrichment image exceeds maxImageBytes=${maxBytes}`));
        return undefined;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await cancel(signal?.aborted ? signal.reason : undefined);
    reader.releaseLock();
  }

  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseUnderstandingResult(text: string): DocumentMultimodalUnderstandingProviderResult {
  const parsed = tryParseJsonObject(text);

  return {
    ...(stringField(parsed, "caption") ? { caption: stringField(parsed, "caption") } : {}),
    ...(stringField(parsed, "ocrText") ? { ocrText: stringField(parsed, "ocrText") } : {}),
    ...(stringField(parsed, "summary") ? { summary: stringField(parsed, "summary") } : {}),
    ...(tableStructureStatus(parsed) ? { tableStructureStatus: tableStructureStatus(parsed) } : {}),
    ...(stringField(parsed, "title") ? { title: stringField(parsed, "title") } : {}),
  };
}

function tryParseJsonObject(text: string): Record<string, unknown> {
  const trimmedText = text.trim();

  try {
    const parsed = JSON.parse(trimmedText);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    const start = trimmedText.indexOf("{");
    const end = trimmedText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmedText.slice(start, end + 1));
      if (isRecord(parsed)) {
        return parsed;
      }
    }
  }

  throw new Error("OpenAI multimodal enrichment provider returned invalid JSON");
}

function tableStructureStatus(
  value: Record<string, unknown>,
): DocumentMultimodalUnderstandingProviderResult["tableStructureStatus"] | undefined {
  const status = stringField(value, "tableStructureStatus");
  return status === "provided" ||
    status === "missing" ||
    status === "pending" ||
    status === "unsupported"
    ? status
    : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function enrichmentEnabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "dify-model-runtime") {
    return true;
  }

  throw new Error("KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER must be dify-model-runtime or off");
}

function imageDetailEnv(value: string | undefined): "auto" | "high" | "low" {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return "auto";
  }

  if (normalized === "auto" || normalized === "high" || normalized === "low") {
    return normalized;
  }

  throw new Error("KNOWLEDGE_MULTIMODAL_ENRICHMENT_IMAGE_DETAIL must be auto, high, or low");
}

function positiveIntegerEnv(value: string | undefined, fallback: number, name: string): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function nonNegativeNumberEnv(value: string | undefined, fallback: number, name: string): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be non-negative`);
  }

  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
