import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { HttpClient } from './types.js'
import { contract } from '@dify/contracts/api/openapi/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { isBaseError, unknownError } from '@/errors/base'
import { classifyResponse } from './error-mapper.js'

// The contract-typed oRPC client for the public OpenAPI surface. JsonifiedClient mirrors
// what survives JSON transport (Date -> string, etc.) so call-site types match the wire.
export type OpenApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>

// Build an oRPC client that routes through the CLI's HttpClient. OpenAPILink constructs a
// standard, absolute-URL Request from the contract and hands it to `fetch`; we point that at
// `http.request`, so every oRPC call reuses the one transport policy (UA+bearer, retry,
// timeout, error-map) instead of a bare fetch. The link's `url` is the same openAPIBase(host)
// the HttpClient was built with — OpenAPILink strips its trailing slash before appending the
// route path, yielding e.g. `<host>/openapi/v1/workspaces`.
export function createOpenApiClient(http: HttpClient): OpenApiClient {
  const link = new OpenAPILink(contract, {
    url: http.baseURL,
    // Map non-2xx through the SAME classifier the path-based transport uses, so a migrated
    // endpoint raises the identical HttpClientError — method/url, raw body, and Dify's
    // message/hint all preserved (full parity with the `this.http.*` path). oRPC therefore
    // only ever sees a 2xx Response and decodes it into the contract-typed result.
    fetch: async (req, init) => {
      const res = await http.request(req, init)
      if (!res.ok)
        throw await classifyResponse(req, res)
      return res
    },
  })
  return createORPCClient(link)
}

// Run an oRPC call and translate any thrown error into the CLI's error model, so wrapper
// methods stay one-liners: `return unwrap(this.orpc.x.y(input))`. mapOrpcError returns `never`,
// so the rejection handler re-throws and the resolved Promise<T> type is preserved.
export function unwrap<T>(call: Promise<T>): Promise<T> {
  return call.catch(mapOrpcError)
}

// Translate an error thrown by an oRPC call back into the CLI's error model. Non-2xx responses
// already arrive as a classified BaseError (the fetch wrapper above raised classifyResponse),
// and transport failures (timeout / network) are BaseErrors from execute() — both re-throw
// unchanged. The only residual is a 2xx whose body oRPC could not deserialize into the contract
// shape, which surfaces as an unknown error.
export function mapOrpcError(err: unknown): never {
  if (isBaseError(err))
    throw err
  throw unknownError(err instanceof Error ? err.message : String(err), err)
}
