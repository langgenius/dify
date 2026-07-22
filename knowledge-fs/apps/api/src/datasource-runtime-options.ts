import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";
import { createDifyDatasourceInvocationClient } from "./dify-datasource-invocation-client";
import {
  type DifyDatasourceRuntimeClientEnv,
  createApiDifyDatasourceRuntimeClient,
} from "./dify-datasource-runtime-options";
import {
  type PluginDaemonClientEnv,
  createApiPluginDaemonDatasourceClient,
} from "./plugin-daemon-options";
import { createStandaloneDatasourceInvocationClient } from "./standalone-datasource-invocation-client";

export interface ApiDatasourceRuntimeEnv
  extends DifyDatasourceRuntimeClientEnv,
    PluginDaemonClientEnv {
  readonly KNOWLEDGE_INTEGRATED_MODE_ENABLED?: string | undefined;
}

/** Selects exactly one credential owner for datasource calls at deployment assembly time. */
export function createApiDatasourceInvocationClient(
  env: ApiDatasourceRuntimeEnv = process.env,
): ApiDatasourceInvocationClient {
  if (env.KNOWLEDGE_INTEGRATED_MODE_ENABLED?.trim().toLowerCase() === "true") {
    return createDifyDatasourceInvocationClient({
      client: createApiDifyDatasourceRuntimeClient(env),
    });
  }
  return createStandaloneDatasourceInvocationClient({
    client: createApiPluginDaemonDatasourceClient(env),
  });
}
