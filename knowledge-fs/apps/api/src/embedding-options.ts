import type { EmbeddingProvider } from "@knowledge/embeddings";
import {
  createDifyModelRuntimeEmbeddingProvider,
  createStaticEmbeddingProvider,
} from "@knowledge/embeddings";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
} from "./dify-model-runtime-options";

export interface ApiEmbeddingEnv extends DifyModelRuntimeClientEnv {
  /** Required only by the test-only static provider; Dify responses are authoritative. */
  readonly KNOWLEDGE_EMBEDDING_DIMENSION?: string | undefined;
  readonly KNOWLEDGE_EMBEDDING_MODEL?: string | undefined;
  readonly KNOWLEDGE_EMBEDDING_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_EMBEDDING_PROVIDER?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface ApiEmbeddingOptions {
  /** True only for an explicitly configured legacy deployment default. */
  readonly legacyDefaultConfigured: boolean;
  /** Present only for an explicitly configured legacy deployment default. */
  readonly denseEmbeddingSelection?: ApiEmbeddingSelection | undefined;
  readonly denseEmbeddingModel: string;
  /** Provider used to build dense-vector projections during ingestion. */
  readonly denseEmbeddingProvider: EmbeddingProvider;
  /** Provider used by upload/query compatibility paths. Kept as an explicit alias. */
  readonly embeddingProvider: EmbeddingProvider;
  /** Builds a provider for the routing fields persisted on a knowledge space. */
  readonly knowledgeSpaceEmbeddingProviderFactory: (
    selection: ApiEmbeddingSelection,
  ) => EmbeddingProvider;
}

export interface ApiEmbeddingSelection {
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

const DEFAULT_DIFY_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_STATIC_EMBEDDING_MODEL = "static-embedding";

/**
 * Resolves the embedding provider. knowledge-fs runs as a Dify subproject, so model calls route
 * through Dify by default; `static` exists only for tests and `off` disables embeddings.
 */
export function createApiEmbeddingOptions(
  env: ApiEmbeddingEnv = process.env,
): ApiEmbeddingOptions | Record<string, never> {
  const providerName = normalizedProvider(env.KNOWLEDGE_EMBEDDING_PROVIDER);

  if (providerName === "off") {
    return {};
  }

  if (providerName === "static") {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("Static embedding provider is forbidden in production");
    }
    const model = trimmed(env.KNOWLEDGE_EMBEDDING_MODEL) ?? DEFAULT_STATIC_EMBEDDING_MODEL;
    const dimension = requiredPositiveIntegerEnv(
      env.KNOWLEDGE_EMBEDDING_DIMENSION,
      "KNOWLEDGE_EMBEDDING_DIMENSION",
    );
    const selection = { model, pluginId: "static", provider: "static" } as const;
    const providerFactory = (requested: ApiEmbeddingSelection) => {
      if (requested.pluginId !== "static" || requested.provider !== "static") {
        throw new Error(
          "Static embedding runtime only supports pluginId=static and provider=static",
        );
      }

      return createStaticEmbeddingProvider({ dimension, model: requested.model });
    };
    const provider = providerFactory(selection);

    return {
      denseEmbeddingSelection: selection,
      denseEmbeddingModel: model,
      denseEmbeddingProvider: provider,
      embeddingProvider: provider,
      knowledgeSpaceEmbeddingProviderFactory: providerFactory,
      legacyDefaultConfigured: true,
    };
  }

  const model = trimmed(env.KNOWLEDGE_EMBEDDING_MODEL) ?? DEFAULT_DIFY_EMBEDDING_MODEL;
  const pluginId = trimmed(env.KNOWLEDGE_EMBEDDING_PLUGIN_ID);
  const pluginProvider = trimmed(env.KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER);
  if (Boolean(pluginId) !== Boolean(pluginProvider)) {
    throw new Error(
      "KNOWLEDGE_EMBEDDING_PLUGIN_ID and KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER must be configured together",
    );
  }
  const legacyDefaultConfigured = Boolean(pluginId && pluginProvider);
  const selection =
    pluginId && pluginProvider ? { model, pluginId, provider: pluginProvider } : undefined;
  const client = createApiDifyModelRuntimeClient(env);
  const providerFactory = (requested: ApiEmbeddingSelection) =>
    createDifyModelRuntimeEmbeddingProvider({
      client,
      model: requested.model,
      pluginId: requested.pluginId,
      provider: requested.provider,
    });
  const provider = selection
    ? createDifyModelRuntimeEmbeddingProvider({
        client,
        model: selection.model,
        pluginId: selection.pluginId,
        provider: selection.provider,
      })
    : profileOnlyEmbeddingProvider();

  return {
    ...(selection ? { denseEmbeddingSelection: selection } : {}),
    denseEmbeddingModel: model,
    denseEmbeddingProvider: provider,
    embeddingProvider: provider,
    knowledgeSpaceEmbeddingProviderFactory: providerFactory,
    legacyDefaultConfigured,
  };
}

/**
 * Health checks still consume a provider-shaped source. This sentinel represents an available
 * profile-scoped Dify model factory without inventing a deployment-wide model selection.
 */
function profileOnlyEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: async () => {
      throw new Error("No deployment-default embedding model is configured");
    },
    kind: "dify-model-runtime",
    models: async () => [],
  };
}

function normalizedProvider(
  value: string | undefined,
): "dify-model-runtime" | "off" | "static" | undefined {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }

  if (normalized === "dify-model-runtime" || normalized === "plugin-daemon") {
    return "dify-model-runtime";
  }
  if (normalized === "static") {
    return "static";
  }

  throw new Error(
    "KNOWLEDGE_EMBEDDING_PROVIDER must be dify-model-runtime, plugin-daemon, static, or off",
  );
}

function optionalPositiveIntegerEnv(value: string | undefined, name: string): number | undefined {
  const raw = trimmed(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function requiredPositiveIntegerEnv(value: string | undefined, name: string): number {
  const dimension = optionalPositiveIntegerEnv(value, name);

  if (dimension === undefined) {
    throw new Error(`${name} is required when using the static embedding provider`);
  }

  return dimension;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}

function isProduction(value: string | undefined): boolean {
  return trimmed(value)?.toLowerCase() === "production";
}
