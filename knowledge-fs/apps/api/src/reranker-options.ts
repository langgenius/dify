import {
  type RerankerProvider,
  createPluginDaemonRerankerProvider,
  createStaticRerankerProvider,
} from "@knowledge/embeddings";

import {
  type PluginDaemonClientEnv,
  createApiPluginDaemonClient,
  parsePluginDaemonCredentials,
} from "./plugin-daemon-options";

export interface ApiRerankerEnv extends PluginDaemonClientEnv {
  readonly KNOWLEDGE_RERANK_MODEL?: string | undefined;
  readonly KNOWLEDGE_RERANK_PLUGIN_CREDENTIALS_JSON?: string | undefined;
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

const DEFAULT_PLUGIN_DAEMON_RERANK_MODEL = "rerank-v3.5";
const DEFAULT_STATIC_RERANK_MODEL = "static-rerank";

/**
 * Resolves the reranker provider. Defaults to the plugin-daemon; `static` exists only for tests and
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

  // Default (unset or "plugin-daemon"): route through the plugin-daemon.
  const model = trimmed(env.KNOWLEDGE_RERANK_MODEL) ?? DEFAULT_PLUGIN_DAEMON_RERANK_MODEL;
  const credentials = parsePluginDaemonCredentials(
    env.KNOWLEDGE_RERANK_PLUGIN_CREDENTIALS_JSON,
    "KNOWLEDGE_RERANK_PLUGIN_CREDENTIALS_JSON",
  );

  const pluginId = trimmed(env.KNOWLEDGE_RERANK_PLUGIN_ID);
  const pluginProvider = trimmed(env.KNOWLEDGE_RERANK_PLUGIN_PROVIDER);
  if (Boolean(pluginId) !== Boolean(pluginProvider)) {
    throw new Error(
      "KNOWLEDGE_RERANK_PLUGIN_ID and KNOWLEDGE_RERANK_PLUGIN_PROVIDER must be configured together",
    );
  }

  const legacyDefaultConfigured = Boolean(pluginId && pluginProvider);
  const client = createApiPluginDaemonClient(env);
  // Per-space rerank calls are tenant-scoped and let plugin-daemon resolve credentials. The
  // optional deployment credentials below belong exclusively to the explicit legacy provider.
  const providerFactory = (selection: ApiRerankerSelection) =>
    createPluginDaemonRerankerProvider({
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
        ? createPluginDaemonRerankerProvider({
            client,
            ...(credentials ? { credentials } : {}),
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
 * plugin/model selection; retrieval never invokes it when
 * `legacyDefaultConfigured` is false.
 */
function profileOnlyRerankerProvider(): RerankerProvider {
  return {
    kind: "plugin-daemon",
    models: async () => [],
    rerank: async () => {
      throw new Error("No deployment-default reranker is configured");
    },
  };
}

function normalizedProvider(
  value: string | undefined,
): "off" | "plugin-daemon" | "static" | undefined {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }

  if (normalized === "plugin-daemon" || normalized === "static") {
    return normalized;
  }

  throw new Error("KNOWLEDGE_RERANK_PROVIDER must be plugin-daemon, static, or off");
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
