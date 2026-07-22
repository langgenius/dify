import {
  type DifyDatasourceRuntimeClient,
  createDifyDatasourceRuntimeClient,
} from "@knowledge/dify-datasource-runtime-client";

export interface DifyDatasourceRuntimeClientEnv {
  readonly DIFY_DATASOURCE_RUNTIME_MAX_RESPONSE_BYTES?: string | undefined;
  readonly DIFY_DATASOURCE_RUNTIME_REQUEST_TIMEOUT_MS?: string | undefined;
  readonly DIFY_INNER_API_KEY?: string | undefined;
  readonly DIFY_INNER_API_URL?: string | undefined;
}

const DEFAULT_DIFY_INNER_API_URL = "http://localhost:5001";
const DEFAULT_DIFY_INNER_API_KEY = "QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1";

/** Calls Dify, where DatasourceManager and DatasourceProviderService own runtime binding. */
export function createApiDifyDatasourceRuntimeClient(
  env: DifyDatasourceRuntimeClientEnv,
): DifyDatasourceRuntimeClient {
  const maxResponseBytes = optionalPositiveInteger(
    env.DIFY_DATASOURCE_RUNTIME_MAX_RESPONSE_BYTES,
    "DIFY_DATASOURCE_RUNTIME_MAX_RESPONSE_BYTES",
  );
  const requestTimeoutMs = optionalPositiveInteger(
    env.DIFY_DATASOURCE_RUNTIME_REQUEST_TIMEOUT_MS,
    "DIFY_DATASOURCE_RUNTIME_REQUEST_TIMEOUT_MS",
  );
  return createDifyDatasourceRuntimeClient({
    apiKey: trimmed(env.DIFY_INNER_API_KEY) ?? DEFAULT_DIFY_INNER_API_KEY,
    baseUrl: trimmed(env.DIFY_INNER_API_URL) ?? DEFAULT_DIFY_INNER_API_URL,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  const raw = trimmed(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}
