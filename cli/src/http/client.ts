import type {
  ClientOptions,
  FetchContext,
  HeadersInit,
  Hook,
  HttpClient,
  HttpLogger,
  HttpMethod,
  RequestOptions,
  ResolvedOptions,
} from './types.js'
import { userAgent as defaultUserAgent } from '@/version/info'
import { buildBody } from './body.js'
import { classifyResponse } from './error-mapper.js'
import { classifyTransport, logRequest, logResponse, setBearer, setUserAgent } from './hooks.js'
import { proxyDispatcher } from './proxy.js'
import { backoffDelay, shouldRetry } from './retry.js'
import { redactBearer } from './sanitize.js'
import { appendSearchParams, joinURL } from './url.js'

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_RETRY_ATTEMPTS = 3

type ResolvedHooks = {
  readonly onRequest: Hook[]
  readonly onResponse: Hook[]
  readonly onRequestError: Hook[]
  readonly onResponseError: Hook[]
}

type ClientState = {
  readonly baseURL: string
  readonly defaultTimeoutMs: number | undefined
  readonly defaultRetryAttempts: number
  readonly hooks: ResolvedHooks
  readonly logger: HttpLogger | undefined
  readonly originalOptions: ClientOptions
  readonly dispatcher: ReturnType<typeof proxyDispatcher>
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined)
    return []
  return Array.isArray(value) ? value : [value]
}

function compileState(opts: ClientOptions): ClientState {
  const onRequest: Hook[] = []
  const onResponse: Hook[] = []
  const onRequestError: Hook[] = [classifyTransport]
  const onResponseError: Hook[] = []

  // Always pin a difyctl-shaped UA so server logs / WAF rules see the CLI's
  // version + platform. Callers can override by passing `userAgent` explicitly.
  onRequest.push(setUserAgent(opts.userAgent ?? defaultUserAgent()))
  if (opts.bearer !== undefined && opts.bearer !== '')
    onRequest.push(setBearer(opts.bearer))
  if (opts.logger !== undefined) {
    onRequest.push(logRequest(opts.logger))
    onResponse.push(logResponse(opts.logger))
  }

  onRequest.push(...toArray(opts.hooks?.onRequest))
  onResponse.push(...toArray(opts.hooks?.onResponse))
  onRequestError.push(...toArray(opts.hooks?.onRequestError))
  onResponseError.push(...toArray(opts.hooks?.onResponseError))

  return {
    baseURL: opts.baseURL,
    defaultTimeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    defaultRetryAttempts: opts.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS,
    hooks: { onRequest, onResponse, onRequestError, onResponseError },
    logger: opts.logger,
    originalOptions: opts,
    dispatcher: proxyDispatcher(),
  }
}

async function runHooks(hooks: readonly Hook[], ctx: FetchContext): Promise<void> {
  for (const hook of hooks)
    await hook(ctx)
}

function buildSignal(opts: RequestOptions, effectiveTimeoutMs: number | undefined): AbortSignal | undefined {
  const timeoutSignal = effectiveTimeoutMs !== undefined && effectiveTimeoutMs > 0
    ? AbortSignal.timeout(effectiveTimeoutMs)
    : undefined
  const userSignal = opts.signal

  if (timeoutSignal === undefined)
    return userSignal
  if (userSignal === undefined)
    return timeoutSignal
  return AbortSignal.any([timeoutSignal, userSignal])
}

function mergeHeaders(input: HeadersInit | undefined, contentType: string | undefined): Headers {
  const headers = new Headers(input ?? {})
  if (contentType !== undefined && !headers.has('content-type'))
    headers.set('content-type', contentType)
  return headers
}

async function dispatch(state: ClientState, path: string, opts: RequestOptions, attempt: number, throwOnErrorDefault: boolean): Promise<Response> {
  const method: HttpMethod = opts.method ?? 'GET'
  const effectiveTimeoutMs = opts.timeoutMs !== undefined
    ? (opts.timeoutMs > 0 ? opts.timeoutMs : undefined)
    : state.defaultTimeoutMs
  const effectiveRetryAttempts = opts.retryAttempts ?? state.defaultRetryAttempts
  const throwOnError = opts.throwOnError ?? throwOnErrorDefault

  const { body, contentType } = buildBody({ json: opts.json, body: opts.body, method })
  const headers = mergeHeaders(opts.headers, contentType)
  const url = appendSearchParams(joinURL(state.baseURL, path), opts.searchParams)

  const signal = buildSignal(opts, effectiveTimeoutMs)

  const request = new Request(url, { method, headers, body, signal })
  const resolved: ResolvedOptions = {
    method,
    headers,
    body,
    timeoutMs: effectiveTimeoutMs,
    retryAttempts: effectiveRetryAttempts,
    throwOnError,
  }
  const ctx: FetchContext = {
    request,
    options: resolved,
    attempt,
    meta: new Map(),
  }

  await runHooks(state.hooks.onRequest, ctx)

  // `dispatcher` is an undici extension to RequestInit, not in @types/node's fetch
  // signature — hence the local type. Carries proxy routing when a proxy env var is set.
  const init: RequestInit & { dispatcher?: unknown } = { signal }
  if (state.dispatcher !== undefined)
    init.dispatcher = state.dispatcher

  try {
    ctx.response = await fetch(ctx.request, init)
  }
  catch (err) {
    ctx.error = err
    // Snapshot the abort cause before onRequestError hooks rewrite ctx.error into BaseError.
    const userAborted = opts.signal?.aborted === true
    await runHooks(state.hooks.onRequestError, ctx)

    // User aborts (ctrl+C) must never retry. Timeouts and other transport errors fall
    // through to shouldRetry, which enforces the method allowlist.
    if (!userAborted && attempt < effectiveRetryAttempts && shouldRetry(ctx.error, ctx)) {
      state.logger?.({ phase: 'retry', method, url: redactBearer(request.url), attempt: attempt + 1 })
      const delay = backoffDelay(attempt + 1)
      if (delay > 0)
        await new Promise(resolve => setTimeout(resolve, delay))
      return dispatch(state, path, opts, attempt + 1, throwOnErrorDefault)
    }

    const finalErr = ctx.error
    if (finalErr instanceof Error && typeof Error.captureStackTrace === 'function')
      Error.captureStackTrace(finalErr, dispatch)
    throw finalErr
  }

  await runHooks(state.hooks.onResponse, ctx)

  const res = ctx.response
  if (!res.ok) {
    if (attempt < effectiveRetryAttempts && shouldRetry(res, ctx)) {
      state.logger?.({ phase: 'retry', method, url: redactBearer(request.url), attempt: attempt + 1 })
      // Drain the discarded error body so undici can release the socket back to its
      // pool instead of holding the connection open until keep-alive timeout / GC.
      await res.body?.cancel().catch(() => {})
      const delay = backoffDelay(attempt + 1)
      if (delay > 0)
        await new Promise(resolve => setTimeout(resolve, delay))
      return dispatch(state, path, opts, attempt + 1, throwOnErrorDefault)
    }

    ctx.error = await classifyResponse(request, res)
    await runHooks(state.hooks.onResponseError, ctx)

    if (throwOnError) {
      const finalErr = ctx.error
      if (finalErr instanceof Error && typeof Error.captureStackTrace === 'function')
        Error.captureStackTrace(finalErr, dispatch)
      throw finalErr
    }
  }

  return res
}

// 204/205 and empty 2xx bodies carry no JSON. Resolve to `undefined` instead of
// letting `res.json()` throw an unclassified SyntaxError, so void-returning callers
// (revoke, stopTask, …) stay safe when a server replies with No Content.
async function parseJsonBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205)
    return undefined as T
  const text = await res.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
}

export function createHttpClient(opts: ClientOptions): HttpClient {
  const state = compileState(opts)

  const typedCall = async <T>(method: HttpMethod, path: string, callOpts?: RequestOptions): Promise<T> => {
    const finalOpts: RequestOptions = { ...callOpts, method }
    const res = await dispatch(state, path, finalOpts, 0, true)
    return parseJsonBody<T>(res)
  }

  const rawFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    const finalOpts: RequestOptions = { ...callOpts, method: callOpts?.method ?? 'GET' }
    return dispatch(state, path, finalOpts, 0, false)
  }

  const streamFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    // SSE bodies must not be aborted by a request-level timeout — `0` is the dispatch
    // sentinel for "no timeout" and also overrides the client default.
    const finalOpts: RequestOptions = {
      ...callOpts,
      method: callOpts?.method ?? 'GET',
      retryAttempts: 0,
      timeoutMs: 0,
    }
    return dispatch(state, path, finalOpts, 0, false)
  }

  const extend = (overrides: Partial<ClientOptions>): HttpClient => createHttpClient({ ...state.originalOptions, ...overrides })

  return {
    get: <T>(p: string, o?: RequestOptions) => typedCall<T>('GET', p, o),
    post: <T>(p: string, o?: RequestOptions) => typedCall<T>('POST', p, o),
    put: <T>(p: string, o?: RequestOptions) => typedCall<T>('PUT', p, o),
    patch: <T>(p: string, o?: RequestOptions) => typedCall<T>('PATCH', p, o),
    delete: <T>(p: string, o?: RequestOptions) => typedCall<T>('DELETE', p, o),
    fetch: rawFetch,
    stream: streamFetch,
    extend,
  }
}
