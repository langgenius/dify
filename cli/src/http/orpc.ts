import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { HttpClient } from './types.js'
import { contract } from '@dify/contracts/api/openapi/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { isBaseError, unknownError } from '@/errors/base'
import { classifyResponse } from './error-mapper.js'

// Contract-typed oRPC client for the public OpenAPI surface. `JsonifiedClient` reshapes the
// contract types to what survives JSON transport (e.g. Date -> string), matching the wire.
export type OpenApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>

// An oRPC client routed through the CLI's HttpClient, so every call reuses the one transport
// policy (UA+bearer, retry, timeout). Errors become the CLI's model at the two transport seams,
// so call sites stay plain `this.orpc.x.y(input)` with no per-method try/catch:
//   - fetch wrapper: non-2xx -> classifyResponse (identical to the `this.http.*` path), leaving
//     oRPC to decode only 2xx responses;
//   - link wrapper: the one residual throw (a 2xx body oRPC can't decode) -> mapOrpcError.
export function createOpenApiClient(http: HttpClient): OpenApiClient {
  const link = new OpenAPILink(contract, {
    url: http.baseURL,
    fetch: async (req, init) => {
      const res = await http.request(req, init)
      if (!res.ok)
        throw await classifyResponse(req, res)
      return res
    },
  })
  return createORPCClient<OpenApiClient>({
    call: (path, input, options) => link.call(path, input, options).catch(mapOrpcError),
  })
}

// Non-2xx and transport failures already arrive as BaseError (from the fetch wrapper / transport)
// and re-throw unchanged; the only residual is a 2xx body oRPC failed to decode.
function mapOrpcError(err: unknown): never {
  if (isBaseError(err))
    throw err
  throw unknownError(err instanceof Error ? err.message : String(err), err)
}
