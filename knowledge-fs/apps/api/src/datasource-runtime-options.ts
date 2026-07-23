import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";
import { createDifyDatasourceInvocationClient } from "./dify-datasource-invocation-client";
import {
  type DifyDatasourceRuntimeClientEnv,
  createApiDifyDatasourceRuntimeClient,
} from "./dify-datasource-runtime-options";

export interface ApiDatasourceRuntimeEnv extends DifyDatasourceRuntimeClientEnv {}

/** Routes datasource calls through Dify, which owns plugin credentials and invocation. */
export function createApiDatasourceInvocationClient(
  env: ApiDatasourceRuntimeEnv = process.env,
): ApiDatasourceInvocationClient {
  return createDifyDatasourceInvocationClient({
    client: createApiDifyDatasourceRuntimeClient(env),
  });
}
