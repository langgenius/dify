import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { HttpClient } from './types.js'
import { contract } from '@dify/contracts/api/openapi/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { HttpClientError, isBaseError, newError, unknownError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

// The contract-typed oRPC client for the public OpenAPI surface. JsonifiedClient mirrors
// what survives JSON transport (Date -> string, etc.) so call-site types match the wire.
export type OpenApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>

// Build an oRPC client that routes through the CLI's HttpClient. OpenAPILink constructs a
// standard, absolute-URL Request from the contract and hands it to `fetch`; we point that at
// `http.request`, so every oRPC call reuses the one transport policy (UA+bearer, retry,
// timeout, error-map) instead of a bare fetch. `baseURL` is the same openAPIBase(host) the
// HttpClient was created with — OpenAPILink strips its trailing slash before appending the
// route path, yielding e.g. `<host>/openapi/v1/workspaces`.
export function createOpenApiClient(http: HttpClient, baseURL: string): OpenApiClient {
  const link = new OpenAPILink(contract, {
    url: baseURL,
    fetch: (req, init) => http.request(req, init),
  })
  return createORPCClient(link)
}

// Run an oRPC call and translate any thrown error into the CLI's error model, so wrapper
// methods stay one-liners: `return unwrap(this.orpc.x.y(input))`. mapOrpcError returns `never`,
// so the rejection handler re-throws and the resolved Promise<T> type is preserved.
export function unwrap<T>(call: Promise<T>): Promise<T> {
  return call.catch(mapOrpcError)
}

// Translate an error thrown by an oRPC call back into the CLI's error model so the command
// layer (formatErrorForCli + exit codes) keeps working unchanged. oRPC owns error
// construction for non-2xx responses — it reads the body and throws an ORPCError carrying the
// HTTP status — so the transport's own classifyResponse never reaches the caller here.
export function mapOrpcError(err: unknown): never {
  // Network / transport failures are already classified BaseErrors thrown by our client
  // (execute() throws on fetch rejection regardless of throwOnError).
  if (isBaseError(err))
    throw err
  // 4xx/5xx: oRPC's ORPCError carries the numeric HTTP status, and (for a non-oRPC error body)
  // stashes the parsed server JSON at `err.data.body`. Recover Dify's message/hint from there so
  // migrated endpoints surface the same rich errors as the transport path (error-mapper.ts).
  if (isOrpcError(err)) {
    const wire = difyWireFrom(err.data)
    throw classifyOrpcStatus(err.status, wire.message, wire.hint)
  }
  throw unknownError(err instanceof Error ? err.message : String(err), err)
}

function isOrpcError(err: unknown): err is { readonly status: number, readonly data?: unknown } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === 'number'
}

type DifyWire = { message?: string, hint?: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Dify's error envelope lives at `err.data.body` and nests its fields either at the top level
// or under `error` — mirror error-mapper.ts's `parsed?.error ?? parsed ?? {}` resolution.
function difyWireFrom(data: unknown): DifyWire {
  const body = isObject(data) ? data.body : undefined
  if (!isObject(body))
    return {}
  const wire = isObject(body.error) ? body.error : body
  return {
    message: typeof wire.message === 'string' ? wire.message : undefined,
    hint: typeof wire.hint === 'string' ? wire.hint : undefined,
  }
}

function classifyOrpcStatus(status: number, message: string | undefined, hint: string | undefined): HttpClientError {
  if (status === 401) {
    return HttpClientError.from(newError(ErrorCode.AuthExpired, message || 'session expired or revoked'))
      .withHint(hint ?? 'run \'difyctl auth login\' to sign in again')
      .withHttpStatus(status)
  }
  if (status >= 500) {
    return HttpClientError.from(newError(ErrorCode.Server5xx, message || `server error (HTTP ${status})`))
      .withHttpStatus(status)
  }
  const err = HttpClientError.from(newError(ErrorCode.Server4xxOther, message || `request failed (HTTP ${status})`))
    .withHttpStatus(status)
  return hint !== undefined ? err.withHint(hint) : err
}
