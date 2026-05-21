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
import { buildBody } from './body.js'
import { classifyResponse } from './error-mapper.js'
import { classifyTransport, logRequest, logResponse, setBearer, setUserAgent } from './hooks.js'
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

  if (opts.userAgent !== undefined)
    onRequest.push(setUserAgent(opts.userAgent))
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
  }
}

async function runHooks(hooks: readonly Hook[], ctx: FetchContext): Promise<void> {
  for (const hook of hooks)
    await hook(ctx)
}

function buildSignal(opts: RequestOptions, effectiveTimeoutMs: number | undefined): { signal: AbortSignal | undefined, timeoutSignal: AbortSignal | undefined } {
  const timeoutSignal = effectiveTimeoutMs !== undefined && effectiveTimeoutMs > 0
    ? AbortSignal.timeout(effectiveTimeoutMs)
    : undefined
  const userSignal = opts.signal

  if (timeoutSignal === undefined && userSignal === undefined)
    return { signal: undefined, timeoutSignal: undefined }
  if (timeoutSignal === undefined)
    return { signal: userSignal, timeoutSignal: undefined }
  if (userSignal === undefined)
    return { signal: timeoutSignal, timeoutSignal }
  return { signal: AbortSignal.any([timeoutSignal, userSignal]), timeoutSignal }
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

  const { signal, timeoutSignal } = buildSignal(opts, effectiveTimeoutMs)

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

  try {
    ctx.response = await fetch(ctx.request, { signal })
  }
  catch (err) {
    ctx.error = err
    await runHooks(state.hooks.onRequestError, ctx)

    const causedByTimeout = timeoutSignal?.aborted === true
    if (attempt < effectiveRetryAttempts && (causedByTimeout || shouldRetry(ctx.error, ctx))) {
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

export function createHttpClient(opts: ClientOptions): HttpClient {
  const state = compileState(opts)

  const typedCall = <T>(method: HttpMethod, path: string, callOpts?: RequestOptions): Promise<T> => {
    const finalOpts: RequestOptions = { ...callOpts, method }
    return dispatch(state, path, finalOpts, 0, true).then(res => res.json() as Promise<T>)
  }

  const rawFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    const finalOpts: RequestOptions = { ...callOpts, method: callOpts?.method ?? 'GET' }
    return dispatch(state, path, finalOpts, 0, false)
  }

  const streamFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    const finalOpts: RequestOptions = {
      ...callOpts,
      method: callOpts?.method ?? 'GET',
      retryAttempts: 0,
      timeoutMs: undefined,
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
