import {
  type RerankerProvider,
  createDifyModelRuntimeRerankerProvider,
  createStaticRerankerProvider,
} from "@knowledge/embeddings";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
} from "./dify-model-runtime-options";

export interface ApiRerankerEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_RERANK_MODEL?: string | undefined;
  readonly KNOWLEDGE_RERANK_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_RERANK_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_RERANK_PROVIDER?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface ApiRerankerOptions {
  /**
   * False when this runtime only exposes the dynamic knowledge-space factory.
   * Omitted remains equivalent to true for callers constructing the legacy
   * `{ model, provider }` shape directly.
   */
  readonly legacyDefaultConfigured?: boolean | undefined;
  readonly model: string;
  readonly provider: RerankerProvider;
  readonly providerFactory?: ((selection: ApiRerankerSelection) => RerankerProvider) | undefined;
}

export interface ApiRerankerSelection {
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

const DEFAULT_DIFY_RERANK_MODEL = "rerank-v3.5";
const DEFAULT_STATIC_RERANK_MODEL = "static-rerank";

/**
 * Resolves the reranker provider. Defaults to Dify; `static` exists only for tests and
 * `off` disables reranking.
 */
export function createApiRerankerOptions(
  env: ApiRerankerEnv = process.env,
): ApiRerankerOptions | undefined {
  const providerName = normalizedProvider(env.KNOWLEDGE_RERANK_PROVIDER);

  if (providerName === "off") {
    return undefined;
  }

  if (providerName === "static") {
    if (trimmed(env.NODE_ENV)?.toLowerCase() === "production") {
      throw new Error("Static rerank provider is forbidden in production");
    }
    const model = trimmed(env.KNOWLEDGE_RERANK_MODEL) ?? DEFAULT_STATIC_RERANK_MODEL;
    const providerFactory = (selection: ApiRerankerSelection) => {
      if (selection.pluginId !== "static" || selection.provider !== "static") {
        throw new Error("Static rerank runtime only supports pluginId=static and provider=static");
      }

      return createStaticRerankerProvider({ model: selection.model });
    };

    return {
      legacyDefaultConfigured: true,
      model,
      provider: providerFactory({ model, pluginId: "static", provider: "static" }),
      providerFactory,
    };
  }

  const model = trimmed(env.KNOWLEDGE_RERANK_MODEL) ?? DEFAULT_DIFY_RERANK_MODEL;

  const pluginId = trimmed(env.KNOWLEDGE_RERANK_PLUGIN_ID);
  const pluginProvider = trimmed(env.KNOWLEDGE_RERANK_PLUGIN_PROVIDER);
  if (Boolean(pluginId) !== Boolean(pluginProvider)) {
    throw new Error(
      "KNOWLEDGE_RERANK_PLUGIN_ID and KNOWLEDGE_RERANK_PLUGIN_PROVIDER must be configured together",
    );
  }

  const legacyDefaultConfigured = Boolean(pluginId && pluginProvider);
  const client = createApiDifyModelRuntimeClient(env);
  const providerFactory = (selection: ApiRerankerSelection) =>
    createDifyModelRuntimeRerankerProvider({
      client,
      model: selection.model,
      pluginId: selection.pluginId,
      provider: selection.provider,
    });

  return {
    legacyDefaultConfigured,
    model,
    provider:
      pluginId && pluginProvider
        ? createDifyModelRuntimeRerankerProvider({
            client,
            model,
            pluginId,
            provider: pluginProvider,
          })
        : profileOnlyRerankerProvider(),
    providerFactory,
  };
}

/**
 * `componentHealth` still expects a provider-shaped source. This sentinel
 * represents a healthy dynamic factory without inventing a deployment-default
 * model selection; retrieval never invokes it when
 * `legacyDefaultConfigured` is false.
 */
function profileOnlyRerankerProvider(): RerankerProvider {
  return {
    kind: "dify-model-runtime",
    models: async () => [],
    rerank: async () => {
      throw new Error("No deployment-default reranker is configured");
    },
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
    "KNOWLEDGE_RERANK_PROVIDER must be dify-model-runtime, plugin-daemon, static, or off",
  );
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
