import {
  type PluginDaemonDatasourceClient,
  createPluginDaemonClient,
} from "@knowledge/plugin-daemon-client";

export interface PluginDaemonClientEnv {
  readonly PLUGIN_DAEMON_KEY?: string | undefined;
  readonly PLUGIN_DAEMON_MAX_RESPONSE_BYTES?: string | undefined;
  readonly PLUGIN_DAEMON_MAX_RETRIES?: string | undefined;
  readonly PLUGIN_DAEMON_RETRY_DELAY_MS?: string | undefined;
  readonly PLUGIN_DAEMON_URL?: string | undefined;
}

const DEFAULT_PLUGIN_DAEMON_URL = "http://localhost:5002";
const DEFAULT_PLUGIN_DAEMON_KEY = "plugin-api-key";

/** Builds the shared plugin-daemon transport client from environment configuration. */
export function createApiPluginDaemonDatasourceClient(
  env: PluginDaemonClientEnv,
): PluginDaemonDatasourceClient {
  const maxResponseBytes = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_MAX_RESPONSE_BYTES,
    "PLUGIN_DAEMON_MAX_RESPONSE_BYTES",
    1,
  );
  const maxRetries = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_MAX_RETRIES,
    "PLUGIN_DAEMON_MAX_RETRIES",
  );
  const retryDelayMs = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_RETRY_DELAY_MS,
    "PLUGIN_DAEMON_RETRY_DELAY_MS",
  );

  const client = createPluginDaemonClient({
    apiKey: pluginDaemonTrimmed(env.PLUGIN_DAEMON_KEY) ?? DEFAULT_PLUGIN_DAEMON_KEY,
    baseUrl: pluginDaemonTrimmed(env.PLUGIN_DAEMON_URL) ?? DEFAULT_PLUGIN_DAEMON_URL,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
  });
  return {
    dispatchDatasourceStream: (input) => client.dispatchDatasourceStream(input),
  };
}

export function pluginDaemonTrimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}

function optionalNonNegativeInt(
  value: string | undefined,
  name: string,
  min = 0,
): number | undefined {
  const raw = pluginDaemonTrimmed(value);

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }

  return parsed;
}
