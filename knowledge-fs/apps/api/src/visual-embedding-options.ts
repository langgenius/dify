import {
  type EmbedVisualAssetsResult,
  type ImageBytesVisualEmbeddingProvider,
  type KnowledgeGatewayOptions,
  createObjectStorageVisualEmbeddingProvider,
} from "@knowledge/api";
import { type EmbeddingProvider, createPluginDaemonEmbeddingProvider } from "@knowledge/embeddings";

import {
  type PluginDaemonClientEnv,
  createApiPluginDaemonClient,
  parsePluginDaemonCredentials,
  pluginDaemonRequired,
} from "./plugin-daemon-options";

export interface ApiVisualEmbeddingEnv extends PluginDaemonClientEnv {
  /** @deprecated Plugin-daemon vector dimensions are inferred from each response. */
  readonly KNOWLEDGE_VISUAL_EMBEDDING_DIMENSION?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MODEL?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_CREDENTIALS_JSON?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PREFERRED_VARIANT?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODEL?: string | undefined;
}

export interface ApiVisualEmbeddingOptions {
  readonly model: string;
  readonly provider: NonNullable<KnowledgeGatewayOptions["visualEmbeddingProvider"]>;
  readonly queryEmbeddingModel?: string | undefined;
  readonly queryEmbeddingProvider?: EmbeddingProvider | undefined;
  readonly queryMode: "fallback" | "off" | "primary";
}

/**
 * Resolves the image-byte visual embedding provider. Opt-in: returns `undefined` unless
 * `KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER=plugin-daemon`.
 *
 * Mirrors dify's multimodal RAG split exactly:
 * - image bytes route through the daemon `multimodal_embedding` op
 *   (`documents: [{content: <base64>, content_type: "image", file_id}]`, dify vector_factory);
 * - text queries into the same visual space route through the daemon `text_embedding` op on the
 *   same multimodal model (dify retrieval uses plain `embed_query` for multimodal datasets).
 */
export function createApiVisualEmbeddingOptions({
  env = process.env,
  objectStorage,
}: {
  readonly env?: ApiVisualEmbeddingEnv | undefined;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
}): ApiVisualEmbeddingOptions | undefined {
  if (!visualEmbeddingEnabled(env.KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER)) {
    return undefined;
  }

  const client = createApiPluginDaemonClient(env);
  const credentials = parsePluginDaemonCredentials(
    env.KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_CREDENTIALS_JSON,
    "KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_CREDENTIALS_JSON",
  );
  const model = pluginDaemonRequired(
    env.KNOWLEDGE_VISUAL_EMBEDDING_MODEL,
    "KNOWLEDGE_VISUAL_EMBEDDING_MODEL",
    "visual embeddings",
  );
  const pluginId = pluginDaemonRequired(
    env.KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID,
    "KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID",
    "visual embeddings",
  );
  const pluginProvider = pluginDaemonRequired(
    env.KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_PROVIDER,
    "KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_PROVIDER",
    "visual embeddings",
  );

  const queryMode = normalizedQueryMode(env.KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE);
  const queryModel = trimmed(env.KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODEL) ?? model;

  return {
    model,
    provider: createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: positiveIntegerEnv(
        env.KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES,
        20 * 1024 * 1024,
        "KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES",
      ),
      objectStorage,
      ...(trimmed(env.KNOWLEDGE_VISUAL_EMBEDDING_PREFERRED_VARIANT)
        ? { preferredVariant: trimmed(env.KNOWLEDGE_VISUAL_EMBEDDING_PREFERRED_VARIANT) }
        : { preferredVariant: "thumbnail" }),
      provider: createPluginDaemonImageBytesVisualEmbeddingProvider({
        client,
        ...(credentials ? { credentials } : {}),
        pluginId,
        provider: pluginProvider,
      }),
    }),
    ...(queryMode === "off"
      ? {}
      : {
          queryEmbeddingModel: queryModel,
          queryEmbeddingProvider: createPluginDaemonEmbeddingProvider({
            client,
            ...(credentials ? { credentials } : {}),
            model: queryModel,
            pluginId,
            provider: pluginProvider,
          }),
        }),
    queryMode,
  };
}

interface PluginDaemonImageBytesVisualEmbeddingProviderOptions {
  readonly client: ReturnType<typeof createApiPluginDaemonClient>;
  readonly credentials?: Record<string, unknown> | undefined;
  readonly pluginId: string;
  readonly provider: string;
}

/**
 * ImageBytesVisualEmbeddingProvider backed by dify's plugin-daemon `multimodal_embedding`
 * dispatch. Documents follow dify vector_factory's shape:
 * `{content: <base64>, content_type: "image", file_id}` with `input_type: "document"`, and the
 * daemon replies with an EmbeddingResult (`{model, embeddings, usage:{tokens,total_tokens}}`).
 */
function createPluginDaemonImageBytesVisualEmbeddingProvider({
  client,
  credentials,
  pluginId,
  provider,
}: PluginDaemonImageBytesVisualEmbeddingProviderOptions): ImageBytesVisualEmbeddingProvider {
  return {
    embedImages: async (input) => {
      const tenantId = input.tenantId?.trim();

      if (!tenantId) {
        throw new Error("Plugin daemon visual embedding requires a tenantId");
      }

      if (input.images.length === 0) {
        throw new Error("Plugin daemon visual embedding requires at least one image");
      }

      const data = await client.dispatchUnary({
        data: {
          credentials: credentials ?? {},
          documents: input.images.map((image) => ({
            content: Buffer.from(image.body).toString("base64"),
            content_type: "image",
            file_id: image.objectKey,
          })),
          input_type: "document",
          model: input.model,
          model_type: "text-embedding",
          provider,
        },
        op: "multimodal_embedding",
        pluginId,
        tenantId,
      });

      const parsed = parseMultimodalEmbeddingResult(data, input.images.length);
      const model = parsed.model ?? input.model;

      return {
        dense: parsed.embeddings,
        metadata: {
          model,
          provider: "plugin-daemon",
        },
        model,
      } satisfies EmbedVisualAssetsResult;
    },
    kind: "plugin-daemon",
  };
}

function parseMultimodalEmbeddingResult(
  data: unknown,
  expectedCount: number,
): { readonly embeddings: (readonly number[])[]; readonly model?: string | undefined } {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  const embeddings = Array.isArray(record?.embeddings) ? record.embeddings : undefined;

  if (!embeddings || embeddings.length !== expectedCount) {
    throw new Error("Plugin daemon visual embedding returned invalid embedding count");
  }

  return {
    embeddings: embeddings.map(parseVector),
    ...(typeof record?.model === "string" ? { model: record.model } : {}),
  };
}

function parseVector(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error("Plugin daemon visual embedding returned an invalid vector");
  }

  const vector = value.map((item) =>
    typeof item === "number" && Number.isFinite(item) ? item : Number.NaN,
  );
  if (vector.length === 0 || vector.some((item) => Number.isNaN(item))) {
    throw new Error("Plugin daemon visual embedding returned an invalid vector");
  }

  return vector;
}

function visualEmbeddingEnabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "plugin-daemon") {
    return true;
  }

  throw new Error("KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER must be plugin-daemon or off");
}

function normalizedQueryMode(value: string | undefined): "fallback" | "off" | "primary" {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return "fallback";
  }

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }

  if (normalized === "fallback" || normalized === "primary") {
    return normalized;
  }

  throw new Error("KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE must be primary, fallback, or off");
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

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
