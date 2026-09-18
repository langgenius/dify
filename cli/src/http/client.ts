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
import { isVerbose } from '@/framework/context'
import { userAgent as defaultUserAgent } from '@/version/info'
import { buildBody } from './body.js'
import { classifyResponse } from './error-mapper.js'
import { classifyTransport, logRequest, logResponse, setBearer, setUserAgent } from './hooks.js'
import { proxyDispatcher } from './proxy.js'
import {
  classifyRateLimit,
  MAX_HONORED_WAIT_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  rateLimitDelayMs,
} from './rate-limit.js'
import { backoffDelay, isIdempotentRetryMethod, shouldRetry } from './retry.js'
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
  readonly insecure: boolean
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
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
  if (opts.bearer !== undefined && opts.bearer !== '') onRequest.push(setBearer(opts.bearer))
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
    dispatcher: proxyDispatcher({ insecure: opts.insecure }),
    insecure: opts.insecure ?? false,
  }
}

async function runHooks(hooks: readonly Hook[], ctx: FetchContext): Promise<void> {
  for (const hook of hooks) await hook(ctx)
}

// Merge a fresh per-attempt timeout signal with the persistent user/oRPC signal.
// Called once per attempt inside execute() so every retry gets its own timeout budget.
function mergeSignal(
  userSignal: AbortSignal | undefined,
  effectiveTimeoutMs: number | undefined,
): AbortSignal | undefined {
  const timeoutSignal =
    effectiveTimeoutMs !== undefined && effectiveTimeoutMs > 0
      ? AbortSignal.timeout(effectiveTimeoutMs)
      : undefined

  if (timeoutSignal === undefined) return userSignal
  if (userSignal === undefined) return timeoutSignal
  return AbortSignal.any([timeoutSignal, userSignal])
}

function mergeHeaders(input: HeadersInit | undefined, contentType: string | undefined): Headers {
  const headers = new Headers(input ?? {})
  if (contentType !== undefined && !headers.has('content-type'))
    headers.set('content-type', contentType)
  return headers
}

type BuiltRequest = {
  readonly request: Request
  readonly resolved: ResolvedOptions
  readonly effectiveTimeoutMs: number | undefined
  readonly userSignal: AbortSignal | undefined
}

// Path-keyed constructor: turns (path, opts) into a Request. The Request is built
// WITHOUT a signal — execute() supplies a fresh per-attempt signal via fetch's
// init.signal (which overrides any signal carried on the Request).
function buildRequest(
  state: ClientState,
  path: string,
  opts: RequestOptions,
  throwOnErrorDefault: boolean,
): BuiltRequest {
  const method: HttpMethod = opts.method ?? 'GET'
  const effectiveTimeoutMs =
    opts.timeoutMs !== undefined
      ? opts.timeoutMs > 0
        ? opts.timeoutMs
        : undefined
      : state.defaultTimeoutMs
  const effectiveRetryAttempts = opts.retryAttempts ?? state.defaultRetryAttempts
  const throwOnError = opts.throwOnError ?? throwOnErrorDefault

  const { body, contentType } = buildBody({ json: opts.json, body: opts.body, method })
  const headers = mergeHeaders(opts.headers, contentType)
  const url = appendSearchParams(joinURL(state.baseURL, path), opts.searchParams)

  const request = new Request(url, { method, headers, body })
  const resolved: ResolvedOptions = {
    method,
    headers,
    body,
    timeoutMs: effectiveTimeoutMs,
    retryAttempts: effectiveRetryAttempts,
    throwOnError,
    retryOnRateLimit: opts.retryOnRateLimit ?? false,
  }
  return { request, resolved, effectiveTimeoutMs, userSignal: opts.signal }
}

// The shared transport engine: hooks -> fetch -> retry -> error-map. Accepts an
// already-built Request, so both the path entrypoints (via buildRequest) and the
// low-level `request` entrypoint (oRPC's pre-built Request) share one retry/timeout
// /error policy.
async function execute(
  state: ClientState,
  request: Request,
  resolved: ResolvedOptions,
  effectiveTimeoutMs: number | undefined,
  userSignal: AbortSignal | undefined,
): Promise<Response> {
  const { method, retryAttempts: effectiveRetryAttempts, throwOnError } = resolved

  for (let attempt = 0; ; attempt++) {
    // Fresh timeout budget per attempt, merged with the persistent user/oRPC signal.
    // Mirrors the old recursion that re-ran buildSignal() on every retry. Keep this
    // INSIDE the loop — hoisting it would leak attempt 0's timeout into later attempts.
    const signal = mergeSignal(userSignal, effectiveTimeoutMs)

    // clone-on-retry: the first fetch consumes the Request body, so any attempt that
    // may still be retried sends a clone and keeps `request` as the pristine replay copy.
    const sendable = attempt < effectiveRetryAttempts ? request.clone() : request

    const ctx: FetchContext = {
      request: sendable,
      options: resolved,
      attempt,
      meta: new Map(),
    }

    await runHooks(state.hooks.onRequest, ctx)

    // Two runtimes, two options: Node's fetch reads undici's `dispatcher` (used
    // below for TLS-skip + proxy routing); Bun's native fetch — what the compiled
    // difyctl binary actually runs on — ignores `dispatcher` entirely and instead
    // needs its own `tls` option. Set both; each runtime ignores the one it
    // doesn't understand.
    const init: RequestInit & {
      dispatcher?: unknown
      tls?: { rejectUnauthorized: boolean }
      verbose?: boolean
    } = { signal }
    if (state.dispatcher !== undefined) init.dispatcher = state.dispatcher
    if (state.insecure) init.tls = { rejectUnauthorized: false }
    if (isVerbose()) init.verbose = true

    try {
      ctx.response = await fetch(ctx.request, init)
    } catch (err) {
      ctx.error = err
      // Snapshot the abort cause before onRequestError hooks rewrite ctx.error into BaseError.
      const userAborted = userSignal?.aborted === true
      await runHooks(state.hooks.onRequestError, ctx)

      // User aborts (ctrl+C) must never retry. Timeouts and other transport errors fall
      // through to shouldRetry, which enforces the method allowlist.
      if (!userAborted && attempt < effectiveRetryAttempts && shouldRetry(ctx.error, ctx)) {
        state.logger?.({
          phase: 'retry',
          method,
          url: redactBearer(ctx.request.url),
          attempt: attempt + 1,
        })
        const delay = backoffDelay(attempt + 1)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      const finalErr = ctx.error
      if (finalErr instanceof Error && typeof Error.captureStackTrace === 'function')
        Error.captureStackTrace(finalErr, execute)
      throw finalErr
    }

    await runHooks(state.hooks.onResponse, ctx)

    const res = ctx.response
    if (!res.ok) {
      // 429 has its own policy. The server self-describes via the ErrorBody `code`: a
      // "too_many_requests" throttle waits-and-retries on idempotent methods (or opted-in POSTs)
      // honoring Retry-After; quota / unrecognized 429s surface immediately rather than burning
      // retries. Surfacing reuses the shared classifyResponse so the body parses to ErrorBody.
      if (res.status === 429) {
        const decision = await classifyRateLimit(res.clone())
        const canRetry =
          decision.retryable &&
          attempt < effectiveRetryAttempts &&
          (decision.retryAfterMs === undefined || decision.retryAfterMs <= MAX_HONORED_WAIT_MS) &&
          (isIdempotentRetryMethod(method) || (method === 'POST' && resolved.retryOnRateLimit))
        if (canRetry) {
          const delay = rateLimitDelayMs(decision, attempt + 1)
          state.logger?.({
            phase: 'retry',
            method,
            url: redactBearer(ctx.request.url),
            status: 429,
            attempt: attempt + 1,
            delayMs: delay,
          })
          await res.body?.cancel().catch(() => {})
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }

        ctx.error = await classifyResponse(ctx.request, res)
        await runHooks(state.hooks.onResponseError, ctx)
        if (throwOnError) {
          const finalErr = ctx.error
          if (finalErr instanceof Error && typeof Error.captureStackTrace === 'function')
            Error.captureStackTrace(finalErr, execute)
          throw finalErr
        }
        return res
      }

      if (attempt < effectiveRetryAttempts && shouldRetry(res, ctx)) {
        state.logger?.({
          phase: 'retry',
          method,
          url: redactBearer(ctx.request.url),
          attempt: attempt + 1,
        })
        // Drain the discarded error body so undici can release the socket back to its
        // pool instead of holding the connection open until keep-alive timeout / GC.
        await res.body?.cancel().catch(() => {})
        const delay = backoffDelay(attempt + 1)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      ctx.error = await classifyResponse(ctx.request, res)
      await runHooks(state.hooks.onResponseError, ctx)

      if (throwOnError) {
        const finalErr = ctx.error
        if (finalErr instanceof Error && typeof Error.captureStackTrace === 'function')
          Error.captureStackTrace(finalErr, execute)
        throw finalErr
      }
    }

    return res
  }
}

// 204/205 and empty 2xx bodies carry no JSON. Resolve to `undefined` instead of
// letting `res.json()` throw an unclassified SyntaxError, so void-returning callers
// (revoke, stopTask, …) stay safe when a server replies with No Content.
async function parseJsonBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T
  const text = await res.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
}

export function createHttpClient(opts: ClientOptions): HttpClient {
  const state = compileState(opts)

  const typedCall = async <T>(
    method: HttpMethod,
    path: string,
    callOpts?: RequestOptions,
  ): Promise<T> => {
    const finalOpts: RequestOptions = { ...callOpts, method }
    const built = buildRequest(state, path, finalOpts, true)
    const res = await execute(
      state,
      built.request,
      built.resolved,
      built.effectiveTimeoutMs,
      built.userSignal,
    )
    return parseJsonBody<T>(res)
  }

  const rawFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    const finalOpts: RequestOptions = { ...callOpts, method: callOpts?.method ?? 'GET' }
    const built = buildRequest(state, path, finalOpts, false)
    return execute(state, built.request, built.resolved, built.effectiveTimeoutMs, built.userSignal)
  }

  const streamFetch = (path: string, callOpts?: RequestOptions): Promise<Response> => {
    // SSE bodies must not be aborted by a request-level timeout — `0` is the buildRequest
    // sentinel for "no timeout" and also overrides the client default.
    //
    // A stream normally never retries (a mid-stream replay would double-send). When the caller
    // opts into 429 retry, allow a bounded budget: the 429 admission rejection arrives as a plain
    // body before the stream opens, and execute()'s 429 branch is the only path that fires for a
    // POST — shouldRetry still rejects POST for transport / 5xx, so nothing else replays.
    const retryAttempts =
      callOpts?.retryOnRateLimit === true ? (callOpts.retryAttempts ?? RATE_LIMIT_MAX_ATTEMPTS) : 0
    const finalOpts: RequestOptions = {
      ...callOpts,
      method: callOpts?.method ?? 'GET',
      retryAttempts,
      timeoutMs: 0,
    }
    const built = buildRequest(state, path, finalOpts, false)
    return execute(state, built.request, built.resolved, built.effectiveTimeoutMs, built.userSignal)
  }

  // Low-level entrypoint for oRPC's OpenAPILink: executes an already-built, absolute-URL
  // Request through the same transport (UA+bearer hooks, retry, timeout, error-map) while
  // skipping joinURL. Policy comes from the client instance defaults — there is no per-call
  // override, so this stays a drop-in for OpenAPILink's `(req, init) => Promise<Response>`.
  // Returns the raw Response for every status; the oRPC fetch wrapper (orpc.ts) inspects the
  // status and raises classifyResponse for non-2xx, so error mapping stays in one place.
  const requestFetch = (req: Request, init?: RequestInit): Promise<Response> => {
    const method = req.method.toUpperCase() as HttpMethod
    const resolved: ResolvedOptions = {
      method,
      headers: req.headers,
      body: undefined,
      timeoutMs: state.defaultTimeoutMs,
      retryAttempts: state.defaultRetryAttempts,
      throwOnError: false,
      retryOnRateLimit: false,
    }
    const userSignal = init?.signal ?? req.signal
    return execute(state, req, resolved, state.defaultTimeoutMs, userSignal)
  }

  const extend = (overrides: Partial<ClientOptions>): HttpClient =>
    createHttpClient({ ...state.originalOptions, ...overrides })

  return {
    baseURL: state.baseURL,
    get: <T>(p: string, o?: RequestOptions) => typedCall<T>('GET', p, o),
    post: <T>(p: string, o?: RequestOptions) => typedCall<T>('POST', p, o),
    put: <T>(p: string, o?: RequestOptions) => typedCall<T>('PUT', p, o),
    patch: <T>(p: string, o?: RequestOptions) => typedCall<T>('PATCH', p, o),
    delete: <T>(p: string, o?: RequestOptions) => typedCall<T>('DELETE', p, o),
    fetch: rawFetch,
    stream: streamFetch,
    request: requestFetch,
    extend,
  }
}
