import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { HttpClient } from './types.js'
import { contract } from '@dify/contracts/api/openapi/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { ContractProcedure, getContractRouter } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { z } from 'zod'
import { isBaseError, unknownError } from '@/errors/base'
import { catalogOperations } from './catalog-routes.js'
import { callCatalogOperation } from './catalog.js'
import { classifyResponse } from './error-mapper.js'

// Contract-typed oRPC client for the public OpenAPI surface. `JsonifiedClient` reshapes the
// contract types to what survives JSON transport (e.g. Date -> string), matching the wire.
export type OpenApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>

// Keep the generated client API for callers, but build guarded requests from stable catalog
// operations. Public metadata and OAuth discovery still use the generated REST link.
export function createOpenApiClient(http: HttpClient): OpenApiClient {
  const link = new OpenAPILink(contract, {
    url: http.baseURL,
    fetch: async (req, init) => {
      const res = await http.request(req, init)
      if (!res.ok) throw await classifyResponse(req, res)
      return res
    },
  })
  return createORPCClient<OpenApiClient>({
    call: async (path, input, options) => {
      try {
        const procedure = getContractRouter(contract, path)
        if (!(procedure instanceof ContractProcedure)) throw new Error('Unknown API operation')
        const route = procedure['~orpc'].route
        if (route.path?.startsWith('/_') || route.path?.startsWith('/oauth/'))
          return await link.call(path, input, options)
        const operation = catalogOperations[`${route.method} ${route.path}`]
        if (!operation) throw new Error(`No catalog operation for ${route.method} ${route.path}`)
        const parts = z
          .object({
            params: z.record(z.string(), z.unknown()).optional(),
            query: z.record(z.string(), z.unknown()).optional(),
            body: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(input ?? {})
        return await callCatalogOperation(
          http,
          operation,
          { ...parts.params, ...parts.query, ...parts.body },
          { signal: options.signal },
        )
      } catch (error) {
        return mapOrpcError(error)
      }
    },
  })
}

// Non-2xx and transport failures already arrive as BaseError (from the fetch wrapper / transport)
// and re-throw unchanged; the only residual is a 2xx body oRPC failed to decode.
function mapOrpcError(err: unknown): never {
  if (isBaseError(err)) throw err
  throw unknownError(err instanceof Error ? err.message : String(err), err)
}
