import type { ServerErrorBody } from '@/errors/base'
import type { ErrorCodeValue } from '@/errors/codes'
import type { CatalogService } from '@/plugins/catalog'
import { BaseError, HttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { definePlugin } from '@/kernel/plugin'
import { buildFetchInit } from '@/net/fetch-init'
import { proxyDispatcher } from '@/net/proxy'
import { catalog, CATALOG_HEADER, CATALOG_PATH } from '@/plugins/catalog'
import { config } from '@/plugins/config'
import { env } from '@/plugins/env'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { userAgent } from '@/version/info'

export type HttpRequest = Readonly<{
  method: string
  path: string
  query?: Readonly<Record<string, string | readonly string[]>>
  json?: unknown
  form?: FormData
  headers?: Readonly<Record<string, string>>
  signal?: AbortSignal
  auth?: boolean
}>
export type RequestBuilder = (catalog: CatalogService) => HttpRequest | Promise<HttpRequest>
export type HttpService = {
  readonly request: (build: RequestBuilder) => Promise<Response>
  readonly fetchCatalog: () => Promise<Uint8Array>
}

const HttpStatus = {
  Unauthorized: 401,
  Forbidden: 403,
  TooManyRequests: 429,
  PreconditionFailed: 412,
} as const

const RETRY_AFTER_HEADER = 'retry-after'
const CATALOG_STALE_CODE = 'catalog_stale'
const LOGIN_HINT = 'run difyctl login'
const CATALOG_UNAVAILABLE_PREFIX = 'failed to fetch the catalog: '
const CATALOG_UNAVAILABLE_HINT = 'check the server URL or run difyctl cache refresh'

// The catalog fetch is the CLI's first request, so its failure has to name itself:
// a rejected status for the catalog route, or whatever the network said.
function catalogFailure(cause: unknown): string {
  if (cause instanceof HttpClientError && cause.httpStatus !== undefined)
    return `HTTP ${cause.httpStatus} from ${CATALOG_PATH}`
  return errorMessage(cause)
}

type StatusMapping = Readonly<{ code: ErrorCodeValue; hint: (res: Response) => string | undefined }>

// Retry-After is either a whole number of seconds or an HTTP-date; only the first
// form can be turned into a wait, so anything else yields no hint at all.
function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get(RETRY_AFTER_HEADER)
  if (raw === null) return undefined
  const seconds = Number(raw.trim())
  return Number.isInteger(seconds) ? seconds : undefined
}

const STATUS_MAPPINGS: Readonly<Record<number, StatusMapping>> = {
  [HttpStatus.Unauthorized]: { code: ErrorCode.AuthExpired, hint: () => LOGIN_HINT },
  [HttpStatus.Forbidden]: { code: ErrorCode.AccessDenied, hint: () => LOGIN_HINT },
  [HttpStatus.TooManyRequests]: {
    code: ErrorCode.RateLimited,
    hint: (res) => {
      const seconds = retryAfterSeconds(res)
      return seconds === undefined ? undefined : `retry after ${seconds} seconds`
    },
  },
}

function classifyStatus(res: Response): { code: ErrorCodeValue; hint?: string } {
  const mapping = STATUS_MAPPINGS[res.status]
  return mapping === undefined
    ? { code: ErrorCode.ServerError }
    : { code: mapping.code, hint: mapping.hint(res) }
}

function parseServerErrorBody(raw: string): ServerErrorBody | undefined {
  if (raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const { code, message } = parsed as Record<string, unknown>
  if (typeof code !== 'string' || typeof message !== 'string') return undefined
  return parsed as ServerErrorBody
}

function appendQuery(url: URL, query: HttpRequest['query']): void {
  if (query === undefined) return
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v)
  }
}

function bodyAndContentType(req: HttpRequest): {
  body?: RequestInit['body']
  contentType?: string
} {
  if (req.form !== undefined) return { body: req.form }
  if (req.json !== undefined)
    return { body: JSON.stringify(req.json), contentType: 'application/json' }
  return {}
}

function isCatalogStale(err: unknown): err is HttpClientError {
  return (
    err instanceof HttpClientError &&
    err.httpStatus === HttpStatus.PreconditionFailed &&
    err.serverError?.code === CATALOG_STALE_CODE
  )
}

// Resolves the request to send for a not-yet-loaded catalog: `build` runs once to see
// whether the caller needs auth at all (auth:false skips the catalog fetch entirely).
// A builder that resolves an op id against the empty catalog raises UnknownOp on that
// first run; that is expected here, so the catalog is fetched and `build` runs again.
async function resolveRequest(
  build: RequestBuilder,
  catalogService: CatalogService,
  fetchCatalog: () => Promise<Uint8Array>,
): Promise<HttpRequest> {
  if (catalogService.loaded) return build(catalogService)
  try {
    const first = await build(catalogService)
    if (first.auth === false) return first
  } catch (err) {
    if (!(err instanceof BaseError) || err.code !== ErrorCode.UnknownOp) throw err
  }
  await catalogService.replace(await fetchCatalog())
  return build(catalogService)
}

export const http = definePlugin({
  name: 'http',
  needs: [env, config, session, token, catalog],
  build: async (ctx): Promise<HttpService> => {
    const configService = await ctx.get(config)
    const sessionService = await ctx.get(session)
    const tokenService = await ctx.get(token)
    const catalogService = await ctx.get(catalog)

    const login = await sessionService.require()
    const dispatcher = login.insecure ? proxyDispatcher({ insecure: true }) : proxyDispatcher()
    if (dispatcher !== undefined) ctx.defer(() => dispatcher.close())

    async function send(req: HttpRequest): Promise<Response> {
      const url = new URL(req.path, login.server)
      appendQuery(url, req.query)

      const headers = new Headers(req.headers)
      headers.set('User-Agent', userAgent())
      headers.set('Accept', 'application/json')
      if (req.auth !== false) {
        headers.set('Authorization', `Bearer ${await tokenService.get()}`)
        headers.set(CATALOG_HEADER, catalogService.fingerprint)
      }
      const { body, contentType } = bodyAndContentType(req)
      if (contentType !== undefined) headers.set('Content-Type', contentType)

      // http.timeout is a deadline for the response headers, not for the whole
      // exchange: an SSE run streams for as long as the server keeps it open, so the
      // timer is cleared the moment `fetch` resolves and only `req.signal` still
      // governs the body read.
      const timeoutMs = (await configService.doc()).http.timeout
      const deadline = new AbortController()
      let deadlineExpired = false
      const timer = setTimeout(() => {
        deadlineExpired = true
        deadline.abort()
      }, timeoutMs)
      const signal = AbortSignal.any(
        req.signal === undefined ? [deadline.signal] : [deadline.signal, req.signal],
      )

      const init = buildFetchInit(
        { method: req.method, headers, body, signal },
        { insecure: login.insecure, dispatcher },
      )

      let res: Response
      try {
        res = await fetch(url, init)
      } catch (cause) {
        throw new BaseError({
          code: ErrorCode.NetworkConnection,
          message: deadlineExpired
            ? `${req.method} ${url} timed out after ${timeoutMs}ms`
            : `network error calling ${req.method} ${url}`,
          cause,
        })
      } finally {
        clearTimeout(timer)
      }
      if (res.ok) return res

      const rawResponse = await res.text()
      const serverError = parseServerErrorBody(rawResponse)
      const { code, hint } = classifyStatus(res)
      throw new HttpClientError({
        code,
        message: serverError?.message ?? `HTTP ${res.status}`,
        hint,
        httpStatus: res.status,
        method: req.method,
        url: url.toString(),
        rawResponse,
        serverError,
      })
    }

    const fetchCatalog: HttpService['fetchCatalog'] = async () => {
      try {
        const res = await send({ method: 'GET', path: CATALOG_PATH, auth: false })
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length === 0) throw new Error('catalog response was empty')
        return bytes
      } catch (cause) {
        throw new BaseError({
          code: ErrorCode.CatalogUnavailable,
          message: `${CATALOG_UNAVAILABLE_PREFIX}${catalogFailure(cause)}`,
          hint: CATALOG_UNAVAILABLE_HINT,
          cause,
        })
      }
    }

    const request: HttpService['request'] = async (build) => {
      const req = await resolveRequest(build, catalogService, fetchCatalog)
      try {
        return await send(req)
      } catch (err) {
        if (!isCatalogStale(err)) throw err
        await catalogService.replace(await fetchCatalog())
        return await send(await build(catalogService))
      }
    }

    return { request, fetchCatalog }
  },
})
