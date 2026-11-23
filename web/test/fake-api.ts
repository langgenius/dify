import type { consoleRouterContract } from '@dify/contracts/console'
import type { AnyContractProcedure, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { Mock } from 'vite-plus/test'
import { marketplaceRouterContract } from '@dify/contracts/marketplace'
import { ContractProcedure, ValidationError } from '@orpc/contract'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { implement, ORPCError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { beforeEach, onTestFinished, vi } from 'vite-plus/test'
import { API_PREFIX, PUBLIC_API_PREFIX } from '@/config'
import { MARKETPLACE_API_PREFIX } from '@/features/marketplace/api'
import { loadConsoleContractForSegment } from '@/service/console/contract-loader'
import { repeatedQueryArrayRules } from '@/service/console/openapi-url'

type HandlerResult<T> = T | Promise<T>

/**
 * Handlers mirror a contract tree. Each leaf receives the decoded, validated request input
 * (`params`, `query`, `body`, `headers`) and returns a response that must satisfy the
 * contract's output schema. Throw `apiError(...)` to answer with an error status.
 */
type ContractHandlers<T> = T extends AnyContractProcedure
  ? (
      input: InferSchemaOutput<T['~orpc']['inputSchema']>,
    ) => HandlerResult<InferSchemaInput<T['~orpc']['outputSchema']>>
  : { [K in keyof T]?: ContractHandlers<T[K]> }

type FakeConsoleHandlers = ContractHandlers<typeof consoleRouterContract>
type FakeMarketplaceHandlers = ContractHandlers<typeof marketplaceRouterContract>

type ApiBase = 'console' | 'public' | 'marketplace' | 'origin'
type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type RouteContext = {
  request: Request
  url: URL
  params: Record<string, string>
  /**
   * The request body, read once so handlers and spy assertions never consume the stream: parsed
   * JSON, `FormData` for multipart or urlencoded forms, text otherwise, or `undefined` if empty.
   */
  body: unknown
}

/** A REST endpoint without a generated contract, such as legacy `@/service/base` calls. */
export type FakeRoute = {
  method: RouteMethod
  base: ApiBase
  path: string
  handler: (context: RouteContext) => unknown
}

export type FakeApi = {
  console?: FakeConsoleHandlers
  marketplace?: FakeMarketplaceHandlers
  routes?: FakeRoute[]
}

type AnyFunction = (...args: never[]) => unknown

/**
 * The handlers a test passed, each wrapped in a `vi.fn` spy at the same path. Spies take the
 * contract's handler signature (not the literal handler's), so a test can later return a deferred
 * promise or different data from `mockReturnValueOnce` / `mockImplementation`.
 */
type Spies<T, Contract> = T extends AnyFunction
  ? Mock<Contract extends AnyFunction ? Contract : T>
  : T extends object
    ? {
        [K in keyof T]-?: Spies<
          NonNullable<T[K]>,
          K extends keyof NonNullable<Contract> ? NonNullable<NonNullable<Contract>[K]> : unknown
        >
      }
    : never

/**
 * Async teardown to register with `onTestFinished`, which also exposes the handlers as spies:
 * `fake.console.<contract path>` and `fake.route(method, base, path)` record every request input,
 * and `fake.use(...)` overrides or adds handlers mid-test.
 */
export type FakeApiHandle<T extends FakeApi> = (() => Promise<void>) & {
  console: Spies<NonNullable<T['console']>, FakeConsoleHandlers>
  marketplace: Spies<NonNullable<T['marketplace']>, FakeMarketplaceHandlers>
  route: (method: RouteMethod, base: ApiBase, path: string) => Mock<FakeRoute['handler']>
  /** Override or add handlers; returns typed spies for the handlers it was given. */
  use: <const U extends FakeApi>(overrides: U) => Pick<FakeApiHandle<U>, 'console' | 'marketplace'>
}

/** The spies and controls of a fake API handle, without its teardown. */
type FakeApiSpies<T extends FakeApi> = Pick<
  FakeApiHandle<T>,
  'console' | 'marketplace' | 'route' | 'use'
>

/**
 * Declare a REST endpoint relative to an API prefix. `:name` segments become `params`. Return a
 * `Response` (for example from `sseResponse`) or any JSON value, which is sent with status 200.
 */
export function route(
  method: RouteMethod,
  base: ApiBase,
  path: string,
  handler: FakeRoute['handler'],
): FakeRoute {
  return { method, base, path, handler }
}

type ApiErrorInit = {
  status: number
  message: string
  /** The backend error code; tests rarely depend on it. */
  code?: string
  /** Extra fields of the backend error body, such as `details` or `error`. */
  details?: Record<string, unknown>
}

/**
 * Build an error for a handler to throw, or for a deferred response to reject with. It is sent in
 * the Python API's shape, `{ code, message, status, ...details }`, which the Web transport parses.
 */
export function apiError({ status, message, code = 'api_error', details }: ApiErrorInit) {
  return new ORPCError(code, { status, message, data: details })
}

class FakeNetworkFailure extends TypeError {
  constructor() {
    super('Failed to fetch')
  }
}

/**
 * Build a network failure for a handler to throw, or for a deferred response to reject with:
 * the request then fails the way an offline `fetch` or `XMLHttpRequest` does, with no response.
 */
export function networkError() {
  return new FakeNetworkFailure()
}

function backendErrorBody(error: ORPCError<string, unknown>) {
  const details = error.data && typeof error.data === 'object' ? error.data : {}
  return { code: error.code, message: error.message, status: error.status, ...details }
}

/** Stream server-sent events in the `data: <json>` framing the chat clients parse. */
export function sseResponse(events: Iterable<unknown> | AsyncIterable<unknown>) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const event of events as AsyncIterable<unknown>)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

const prefixes: Record<ApiBase, URL> = {
  // Same-origin deployments configure relative prefixes such as `/console/api`; resolve them
  // against the page like the app's clients do.
  console: new URL(API_PREFIX, window.location.origin),
  public: new URL(PUBLIC_API_PREFIX, window.location.origin),
  marketplace: new URL(MARKETPLACE_API_PREFIX, window.location.origin),
  // Relative endpoints on the page's own origin, such as the device-flow `/openapi/v1/...` calls.
  origin: new URL('/', window.location.origin),
}

function baseOf(url: URL): ApiBase | undefined {
  // Longest prefix first, so `/console/api` is never mistaken for `/api` on the same origin.
  return (Object.keys(prefixes) as ApiBase[])
    .sort((a, b) => prefixes[b].pathname.length - prefixes[a].pathname.length)
    .find((base) => {
      const prefix = prefixes[base]
      const path = prefix.pathname.replace(/\/$/, '')
      return url.origin === prefix.origin && `${url.pathname}/`.startsWith(`${path}/`)
    })
}

function prefixPath(base: ApiBase) {
  return prefixes[base].pathname.replace(/\/$/, '') as `/${string}`
}

function matchRoute(pattern: string, path: string) {
  const expected = pattern.split('/').filter(Boolean)
  const actual = path.split('/').filter(Boolean)
  if (expected.length !== actual.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, segment] of expected.entries()) {
    const value = actual[index]!
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value)
    else if (segment !== value) return undefined
  }
  return params
}

// The browser client rewrites some arrays to repeated keys for the Python backend;
// oRPC's OpenAPI decoder expects the indexed form, so restore it before decoding.
function restoreIndexedArrays(request: Request, report: (problem: string) => void) {
  const url = new URL(request.url)
  const routePath = url.pathname.slice(prefixPath('console').length)
  const rule = repeatedQueryArrayRules.find(({ path }) => path.test(routePath))
  if (!rule) return request
  for (const field of rule.fields) {
    // The Python API reads these fields with `getlist(field)`, which ignores `field[0]=…` keys.
    const indexed = [...url.searchParams.keys()].find((key) => key.startsWith(`${field}[`))
    if (indexed) {
      report(
        `${request.method} ${url.pathname}: query \`${indexed}\` is ignored by the Python API, which reads repeated \`${field}\` keys`,
      )
    }
    const values = url.searchParams.getAll(field)
    if (!values.length) continue
    url.searchParams.delete(field)
    values.forEach((value, index) => url.searchParams.append(`${field}[${index}]`, value))
  }
  return new Request(url, request)
}

// Fetch lowercases header names, while contracts declare them as documented (`Idempotency-Key`);
// the Python API matches them case-insensitively, so restore the declared casing before validation.
function restoreHeaderCase(procedure: unknown, input: unknown) {
  const headers = (input as { headers?: Record<string, unknown> } | undefined)?.headers
  if (!headers) return input
  type Shape = { shape?: Record<string, unknown>; unwrap?: () => unknown } | undefined
  const schema = (procedure as { '~orpc': { inputSchema?: unknown } })['~orpc'].inputSchema as Shape
  let headersSchema = schema?.shape?.headers as Shape
  while (headersSchema && !headersSchema.shape && headersSchema.unwrap)
    headersSchema = headersSchema.unwrap() as Shape
  const declared = Object.keys(headersSchema?.shape ?? {})
  if (!declared.length) return input
  const restored = { ...headers }
  for (const key of declared) {
    const lower = key.toLowerCase()
    if (key !== lower && restored[key] === undefined && restored[lower] !== undefined) {
      restored[key] = restored[lower]
      delete restored[lower]
    }
  }
  return { ...(input as object), headers: restored }
}

type AnyHandler = (input: unknown) => unknown
type HandlerTree = { [key: string]: HandlerTree | AnyHandler }

function collectLeaves(tree: HandlerTree, path: string[] = []): Array<[string[], AnyHandler]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'function'
      ? [[[...path, key], value] as [string[], AnyHandler]]
      : collectLeaves(value, [...path, key]),
  )
}

// Custom-method paths such as `/workflows/{workflow_id}:precheck` put a parameter and a literal in
// one segment, which oRPC's router cannot match. Move the `:method` suffix into its own segment on
// both the contract and the request; real IDs never contain a colon.
const customMethodSegment = /:([\w-]+)$/

function splitCustomMethods(path: string) {
  return path
    .split('/')
    .map((segment) => segment.replace(customMethodSegment, '/~$1'))
    .join('/')
}

function withSplitCustomMethods(procedure: AnyContractProcedure): AnyContractProcedure {
  const def = procedure['~orpc']
  const path = def.route.path
  if (!path || !path.split('/').some((segment) => customMethodSegment.test(segment)))
    return procedure
  return new ContractProcedure({
    ...def,
    route: { ...def.route, path: splitCustomMethods(path) as `/${string}` },
  })
}

function sentParts(input: unknown) {
  const parts = { ...(input as Record<string, unknown> | undefined) }
  delete parts.headers
  for (const [key, value] of Object.entries(parts)) {
    const empty =
      typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype &&
      !Object.keys(value).length
    if (value === undefined || empty) delete parts[key]
  }
  return parts
}

function implementLeaves(
  contracts: Record<string, unknown>,
  leaves: Array<[string[], AnyHandler]>,
) {
  const router: Record<string, unknown> = {}
  for (const [path, handler] of leaves) {
    // `handler` resolves the current spy at request time, so `use()` overrides take effect.
    const procedure = path.reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      contracts,
    )
    if (!(procedure instanceof Object) || !('~orpc' in procedure))
      throw new Error(`Fake API: no contract procedure at ${path.join('.')}`)
    let node = router
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
    // Without an input schema oRPC passes the raw decoded request (transport headers, empty
    // parts); record only what the client actually sent so spies can be asserted exactly.
    const hasInput = Boolean((procedure as AnyContractProcedure)['~orpc'].inputSchema)
    node[path.at(-1)!] = implement(
      withSplitCustomMethods(procedure as AnyContractProcedure),
    ).handler(({ input, context }: { input: unknown; context: unknown }) => {
      const result = handler(hasInput ? input : sentParts(input))
      noteHeld((context as RequestContext).flight, result)
      return result
    })
  }
  return router
}

async function buildConsoleRouter(leaves: Array<[string[], AnyHandler]>) {
  const segments = [...new Set(leaves.map(([path]) => path[0]!))]
  // Load segments exactly as the app's client does, including the merged enterprise contract.
  const contracts = Object.assign(
    {},
    ...(await Promise.all(segments.map((segment) => loadConsoleContractForSegment(segment)))),
  ) as Record<string, unknown>
  return implementLeaves(contracts, leaves)
}

// Flask's `request.is_json`: the API reads a body as JSON only under these media types, and
// `get_json(silent=True)` treats any other body as absent.
const isJsonMediaType = (contentType: string | undefined) => {
  const mediaType = contentType?.split(';')[0]!.trim().toLowerCase() ?? ''
  return (
    mediaType === 'application/json' ||
    (mediaType.startsWith('application/') && mediaType.endsWith('+json'))
  )
}

const isFormBody = (contentType: string | undefined) =>
  Boolean(
    contentType &&
    (contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')),
  )

// The API reads form bodies only for uploads: the generated contracts give those bodies a
// `z.custom<Blob | File>` field, and the oRPC client sends `FormData` only for bodies that
// contain one. Read the schema's kind rather than probing it with a Blob: `unknown`, `any`,
// records and objects accept a Blob too, but the API reads those bodies from JSON.
type ZodNode = {
  _zod?: {
    def: {
      type: string
      shape?: Record<string, ZodNode>
      options?: ZodNode[]
      left?: ZodNode
      right?: ZodNode
      innerType?: ZodNode
      element?: ZodNode
      valueType?: ZodNode
      in?: ZodNode
    }
  }
  safeParse?: (value: unknown) => { success: boolean }
}
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'readonly',
  'nonoptional',
])

function isFileSchema(schema: ZodNode | undefined): boolean {
  const def = schema?._zod?.def
  if (!def) return false
  if (WRAPPERS.has(def.type)) return isFileSchema(def.innerType)
  if (def.type === 'pipe') return isFileSchema(def.in)
  if (def.type === 'array') return isFileSchema(def.element)
  // Named uploads, such as `files: { [name]: File | File[] }`.
  if (def.type === 'record') return isFileSchema(def.valueType)
  if (def.type === 'union') return Boolean(def.options?.length) && def.options!.every(isFileSchema)
  if (def.type === 'file') return true
  // A file check accepts a Blob and nothing shaped like JSON.
  return (
    def.type === 'custom' &&
    Boolean(schema!.safeParse?.(new Blob()).success) &&
    !schema!.safeParse?.({}).success
  )
}

function hasFileField(schema: ZodNode | undefined): boolean {
  const def = schema?._zod?.def
  if (!def) return false
  if (WRAPPERS.has(def.type)) return hasFileField(def.innerType)
  if (def.type === 'pipe') return hasFileField(def.in)
  if (def.type === 'union') return (def.options ?? []).some(hasFileField)
  if (def.type === 'intersection') return hasFileField(def.left) || hasFileField(def.right)
  if (def.type === 'object') return Object.values(def.shape ?? {}).some(isFileSchema)
  return isFileSchema(schema)
}

function acceptsFormBody(procedure: unknown) {
  const input = (procedure as { '~orpc': { inputSchema?: ZodNode } })['~orpc'].inputSchema
  const def = input?._zod?.def
  const shape = def?.type === 'object' ? def.shape : undefined
  return hasFileField(shape?.body)
}

function createContractHandler(router: Record<string, unknown>, report: (problem: string) => void) {
  return new OpenAPIHandler(router as never, {
    // Query strings and path params arrive as text; the Python API coerces them by schema.
    plugins: [new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] })],
    clientInterceptors: [
      async ({ next, input, procedure, context, ...options }) => {
        const requestContext = context as RequestContext
        requestContext.decoded = true
        if (isFormBody(requestContext.contentType) && !acceptsFormBody(procedure)) {
          report(
            `${options.path.join('.')}: sent a ${requestContext.contentType?.split(';')[0]} body, but the API reads this body as JSON`,
          )
          throw new ORPCError('UNSUPPORTED_MEDIA_TYPE', {
            status: 415,
            message: 'The API reads this request body as JSON',
          })
        }
        if (
          requestContext.bodySent &&
          !isFormBody(requestContext.contentType) &&
          !isJsonMediaType(requestContext.contentType)
        ) {
          const sentAs = requestContext.contentType
            ? `as ${requestContext.contentType.split(';')[0]}`
            : 'without a Content-Type'
          report(
            `${options.path.join('.')}: sent a body ${sentAs}; the API reads only application/json (or application/*+json) bodies and would ignore it`,
          )
          throw new ORPCError('UNSUPPORTED_MEDIA_TYPE', {
            status: 415,
            message: 'The API reads this request body as JSON',
          })
        }
        // Coercion is for text in the URL and headers; the Python API validates JSON bodies as sent.
        const sent = requestContext.jsonBody
          ? { ...(input as object), body: requestContext.jsonBody.value }
          : input
        try {
          return await next({
            ...options,
            context,
            input: restoreHeaderCase(procedure, sent),
            procedure,
          })
        } catch (error) {
          // oRPC would turn this into a 500; flag it so the dispatcher rejects like an offline fetch.
          if (error instanceof FakeNetworkFailure) (context as RequestContext).networkFailed = true
          // Only apiError() and networkError() simulate failures; anything else is a broken handler.
          else if (!(error instanceof ORPCError))
            reportUnexpected(report, options.path.join('.'), error)
          throw error
        }
      },
    ],
    interceptors: [
      async ({ next, request, context }) => {
        try {
          return await next()
        } catch (error) {
          // Decoding fails before any procedure runs; a handler's own 400 always gets past it.
          if (!(context as RequestContext).decoded) {
            report(
              `${request.method} ${request.url.pathname}: request could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
            )
            throw error
          }
          if (!(error instanceof ORPCError)) throw error
          if (error.cause instanceof ValidationError) {
            report(
              `${request.method} ${request.url.pathname}: ${error.message} ${JSON.stringify(error.cause.issues)}`,
            )
            throw error
          }
          // Answer handler errors the way the Python API does, not in oRPC's error envelope.
          return {
            matched: true,
            response: {
              status: error.status,
              headers: { 'content-type': 'application/json' },
              body: backendErrorBody(error),
            },
          }
        }
      },
    ],
  })
}

function reportUnexpected(report: (problem: string) => void, where: string, error: unknown) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  report(
    `${where}: handler threw unexpectedly (${detail}); throw apiError() or networkError() to simulate a failure`,
  )
}

type Dispatch = (request: Request) => Promise<Response>

/** A request the fake is still answering; teardown waits for it before checking for problems. */
type Flight = {
  label: string
  /** Resolves once the request failed, or its response body ended or was cancelled. */
  done: Promise<void>
  finished: boolean
  /** The handler answered; the body may still be streaming. */
  responded: boolean
  /** The client started reading the body, so teardown waits for it to end. */
  bodyReading: boolean
  /** The response a test is holding open with `hold()` or `pendingResponse()`, if any. */
  heldBy?: Promise<unknown>
  /** The client cancelled it, so it already failed with an `AbortError` and needs no response. */
  aborted?: boolean
}

// The regular (non-once) implementation of each spy the fake creates, kept in sync with
// `mockImplementation()`, `mockReset()` and `mockRestore()`. Vitest's `getMockImplementation()`
// returns the next queued `mockImplementationOnce`, so `hold().release()` cannot rely on it.
const regularImplementations = new WeakMap<object, AnyFunction>()
function trackRegularImplementation<T extends Mock<AnyFunction>>(spy: T, original: AnyFunction) {
  regularImplementations.set(spy, original)
  const setImplementation = spy.mockImplementation.bind(spy)
  const reset = spy.mockReset.bind(spy)
  const restore = spy.mockRestore.bind(spy)
  spy.mockImplementation = ((implementation: AnyFunction) => {
    regularImplementations.set(spy, implementation)
    return setImplementation(implementation as never)
  }) as never
  spy.mockReset = () => {
    regularImplementations.set(spy, original)
    return reset()
  }
  spy.mockRestore = () => {
    regularImplementations.set(spy, original)
    return restore()
  }
  return spy
}

// Responses created by `hold()`, and whether the test has settled them yet.
const heldResponses = new WeakMap<Promise<unknown>, { settled: boolean }>()
const isHeld = (flight: Flight) =>
  flight.heldBy !== undefined && heldResponses.get(flight.heldBy)?.settled === false
function noteHeld(flight: Flight | undefined, result: unknown) {
  if (flight && result instanceof Promise && heldResponses.has(result)) flight.heldBy = result
}
// Captured before any test fakes timers, so teardown can always wait in real time.
const realSetTimeout = globalThis.setTimeout
const realNow = Date.now.bind(Date)
const PENDING_REQUEST_GRACE_MS = 2_000
type RequestContext = {
  networkFailed?: boolean
  /** Set once oRPC has decoded the request and is calling the procedure. */
  decoded?: boolean
  /** The JSON body exactly as sent, so schema coercion never changes its types. */
  jsonBody?: { value: unknown }
  /** Whether the request carried a body at all, whatever its media type. */
  bodySent?: boolean
  /** The request's `Content-Type`, checked against what the procedure's body accepts. */
  contentType?: string
  flight?: Flight
}

function createFakeXMLHttpRequest(dispatch: Dispatch) {
  type Listener = (event: Event) => void
  return class FakeXMLHttpRequest extends EventTarget {
    static readonly UNSENT = 0
    static readonly OPENED = 1
    static readonly HEADERS_RECEIVED = 2
    static readonly LOADING = 3
    static readonly DONE = 4
    readyState = 0
    status = 0
    statusText = ''
    response: unknown = null
    responseText = ''
    responseType: XMLHttpRequestResponseType = ''
    withCredentials = false
    timeout = 0
    onreadystatechange: Listener | null = null
    onload: Listener | null = null
    onloadend: Listener | null = null
    onerror: Listener | null = null
    onabort: Listener | null = null
    ontimeout: Listener | null = null
    upload = Object.assign(new EventTarget(), { onprogress: null as Listener | null })
    #method = 'GET'
    #url = ''
    #headers = new Headers()
    #responseHeaders = new Headers()
    #aborted = false
    #controller = new AbortController()

    #emit(target: EventTarget & Record<string, unknown>, type: string, event: Event) {
      const handler = target[`on${type}`]
      if (typeof handler === 'function') handler.call(target, event)
      target.dispatchEvent(event)
    }

    open(method: string, url: string | URL) {
      this.#method = method.toUpperCase()
      this.#url = new URL(url, window.location.href).href
      this.readyState = 1
    }

    setRequestHeader(name: string, value: string) {
      this.#headers.set(name, value)
    }

    getResponseHeader(name: string) {
      return this.#responseHeaders.get(name)
    }

    getAllResponseHeaders() {
      return [...this.#responseHeaders].map(([name, value]) => `${name}: ${value}`).join('\r\n')
    }

    abort() {
      this.#aborted = true
      // The same signal reaches the tracked request, so teardown treats it as cancelled.
      this.#controller.abort()
      this.readyState = 4
      this.#emit(this as never, 'abort', new Event('abort'))
    }

    send(body?: XMLHttpRequestBodyInit | null) {
      const request = new Request(this.#url, {
        method: this.#method,
        headers: this.#headers,
        body: this.#method === 'GET' || this.#method === 'HEAD' ? undefined : body,
        signal: this.#controller.signal,
      })
      void dispatch(request).then(
        async (response) => {
          if (this.#aborted) return
          let text: string
          try {
            text = await response.text()
          } catch {
            return
          }
          if (this.#aborted) return
          const size = new Blob([text]).size
          const progress = new ProgressEvent('progress', {
            lengthComputable: true,
            loaded: size,
            total: size,
          })
          this.#emit(this.upload as never, 'progress', progress)
          this.status = response.status
          this.statusText = response.statusText
          this.#responseHeaders = response.headers
          this.responseText = text
          this.response = this.responseType === 'json' ? parseJsonOrNull(text) : text
          this.readyState = 4
          this.#emit(this as never, 'readystatechange', new Event('readystatechange'))
          this.#emit(this as never, 'load', new ProgressEvent('load'))
          this.#emit(this as never, 'loadend', new ProgressEvent('loadend'))
        },
        () => {
          if (this.#aborted) return
          this.readyState = 4
          this.#emit(this as never, 'readystatechange', new Event('readystatechange'))
          this.#emit(this as never, 'error', new ProgressEvent('error'))
        },
      )
    }
  }
}

function splitRequestCustomMethods(request: Request) {
  const url = new URL(request.url)
  const pathname = splitCustomMethods(url.pathname)
  if (pathname === url.pathname) return request
  url.pathname = pathname
  return new Request(url, request)
}

// Like native XHR with `responseType = 'json'`: a body that is not JSON yields `null`.
function parseJsonOrNull(text: string) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

// Re-stream a response body so the request stays tracked until the body ends or is cancelled,
// and so aborting the request errors a body still being read, as native fetch does.
function observeBody(response: Response, signal: AbortSignal, flight: Flight, end: () => void) {
  if (!response.body) {
    end()
    return response
  }
  const reader = response.body.getReader()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let ended = false
  const finish = () => {
    ended = true
    end()
  }
  const onAbort = () => {
    // A body that already ended has nothing left to cancel.
    if (ended) return
    try {
      controller.error(abortReason(signal))
    } catch {}
    void reader.cancel(abortReason(signal)).catch(() => undefined)
    finish()
  }
  const body = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController
      },
      async pull(streamController) {
        flight.bodyReading = true
        try {
          const { done, value } = await reader.read()
          if (done) {
            streamController.close()
            finish()
          } else {
            streamController.enqueue(value)
          }
        } catch (error) {
          try {
            streamController.error(error)
          } catch {}
          finish()
        }
      },
      cancel(reason) {
        finish()
        return reader.cancel(reason)
      },
    },
    // Pull only when the client reads, so an unread body does not count as being read.
    { highWaterMark: 0 },
  )
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

// Native fetch rejects with the signal's reason when aborted before or while awaiting a response.
function abortable(request: Request, dispatch: Dispatch) {
  const { signal } = request
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    dispatch(request)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function readJsonBody(
  request: Request,
): Promise<Pick<RequestContext, 'jsonBody' | 'bodySent'>> {
  if (request.method === 'GET' || request.method === 'HEAD') return { bodySent: false }
  const text = await request.clone().text()
  if (!text) return { bodySent: false }
  if (!isJsonMediaType(request.headers.get('content-type') ?? undefined)) return { bodySent: true }
  try {
    return { bodySent: true, jsonBody: { value: JSON.parse(text) } }
  } catch {
    // oRPC reports the undecodable body; leave its decoding untouched.
    return { bodySent: true }
  }
}

type DecodedBody = { ok: true; value: unknown } | { ok: false; problem: string }

// Decode by Content-Type, as the backend does: JSON and forms must parse; anything else is text.
async function readBody(request: Request): Promise<DecodedBody> {
  if (request.method === 'GET' || request.method === 'HEAD') return { ok: true, value: undefined }
  const type = request.headers.get('content-type') ?? ''
  const copy = request.clone()
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    try {
      return { ok: true, value: await copy.formData() }
    } catch (error) {
      return { ok: false, problem: `form body: ${error instanceof Error ? error.message : error}` }
    }
  }
  const text = await copy.text()
  if (!text) return { ok: true, value: undefined }
  if (!isJsonMediaType(type)) return { ok: true, value: text }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, problem: `JSON body: ${error instanceof Error ? error.message : error}` }
  }
}

function setAt(tree: Record<string, unknown>, path: string[], value: unknown) {
  let node = tree
  for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
  node[path.at(-1)!] = value
}

/**
 * Serve API requests from contract-validated handlers and REST routes through the real clients,
 * transports and TanStack Query, for both `fetch` and `XMLHttpRequest`. Call during test setup
 * and register the returned handle with `onTestFinished`; it fails the test on contract
 * violations, requests no handler answers, and requests outside the known API prefixes, and logs
 * each problem when it happens.
 */
export function installFakeApi<const T extends FakeApi>(api: T): FakeApiHandle<T> {
  const problems: string[] = []
  const report = (problem: string) => {
    problems.push(problem)
    console.error(`[fake-api] ${problem}`)
  }

  // Every handler becomes a spy, looked up by path at request time.
  const spies = new Map<string, Mock<AnyHandler>>()
  const spyTrees: Record<'console' | 'marketplace', Record<string, unknown>> = {
    console: {},
    marketplace: {},
  }
  const leavesOf = (contract: 'console' | 'marketplace') =>
    [...spies.keys()]
      .filter((key) => key.startsWith(`${contract}:`))
      .map((key): [string[], AnyHandler] => {
        const path = key.slice(contract.length + 1).split('.')
        return [path, (input) => spies.get(key)!(input as never)]
      })
  let consoleHandler: Promise<OpenAPIHandler<Record<never, never>>> | undefined
  let marketplaceHandler: OpenAPIHandler<Record<never, never>> | undefined
  const addHandlers = (contract: 'console' | 'marketplace', tree: unknown) => {
    for (const [path, handler] of collectLeaves((tree ?? {}) as HandlerTree)) {
      const key = `${contract}:${path.join('.')}`
      const existing = spies.get(key)
      if (existing) {
        existing.mockImplementation(handler as never)
        continue
      }
      const spy = trackRegularImplementation(vi.fn(handler), handler)
      spies.set(key, spy)
      setAt(spyTrees[contract], path, spy)
      // A new procedure needs a new router; existing ones keep resolving their spy.
      if (contract === 'console') consoleHandler = undefined
      else marketplaceHandler = undefined
    }
  }
  addHandlers('console', api.console)
  addHandlers('marketplace', api.marketplace)
  const getConsoleHandler = () =>
    (consoleHandler ??= buildConsoleRouter(leavesOf('console')).then((router) =>
      createContractHandler(router, report),
    ))
  const getMarketplaceHandler = () =>
    (marketplaceHandler ??= createContractHandler(
      implementLeaves(
        marketplaceRouterContract as unknown as Record<string, unknown>,
        leavesOf('marketplace'),
      ),
      report,
    ))

  type SpiedRoute = FakeRoute & { spy: Mock<FakeRoute['handler']> }
  let routes: SpiedRoute[] = []
  const addRoutes = (added: FakeRoute[] = []) => {
    // Later routes take precedence, so `use()` can override an endpoint.
    routes = [
      ...added.map((entry) => ({
        ...entry,
        spy: trackRegularImplementation(vi.fn(entry.handler), entry.handler),
      })),
      ...routes,
    ]
  }
  addRoutes(api.routes)

  const nativeFetch = globalThis.fetch
  const dispatch = async (request: Request, flight: Flight): Promise<Response> => {
    const url = new URL(request.url)
    // `data:` and `blob:` URLs are local resources (image previews, downloads), never the network.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return nativeFetch(request)
    const base = baseOf(url)
    if (!base) {
      report(`unexpected network request: ${request.method} ${url.href}`)
      throw new TypeError('Failed to fetch')
    }
    // oRPC and the route matcher ignore a trailing slash, but Flask returns 404 for routes
    // declared without one, and no contract path declares one.
    const apiPath = url.pathname.slice(prefixPath(base).length)
    if (base !== 'origin' && apiPath.length > 1 && apiPath.endsWith('/')) {
      report(
        `${request.method} ${url.pathname}: trailing slash; the API declares this route without one`,
      )
    }
    const tilde = url.pathname.split('/').find((segment) => segment.startsWith('~'))
    if (tilde) {
      report(
        `${request.method} ${url.pathname}: segment \`${tilde}\` is not a contract path; custom methods are sent as \`:${tilde.slice(1)}\``,
      )
    }
    if (base === 'console' && leavesOf('console').length) {
      const context: RequestContext = {
        ...(await readJsonBody(request)),
        contentType: request.headers.get('content-type') ?? undefined,
        flight,
      }
      const { matched, response } = await (
        await getConsoleHandler()
      ).handle(splitRequestCustomMethods(restoreIndexedArrays(request.clone(), report)), {
        prefix: prefixPath('console'),
        context,
      })
      if (context.networkFailed) throw networkError()
      if (matched) return response!
    }
    if (base === 'marketplace' && leavesOf('marketplace').length) {
      const context: RequestContext = {
        ...(await readJsonBody(request)),
        contentType: request.headers.get('content-type') ?? undefined,
        flight,
      }
      const { matched, response } = await getMarketplaceHandler().handle(
        splitRequestCustomMethods(request.clone()),
        {
          prefix: prefixPath('marketplace'),
          context,
        },
      )
      if (context.networkFailed) throw networkError()
      if (matched) return response!
    }
    const path = url.pathname.slice(prefixPath(base).length) || '/'
    for (const candidate of routes) {
      if (candidate.base !== base || candidate.method !== request.method) continue
      const params = matchRoute(candidate.path, path)
      if (!params) continue
      const body = await readBody(request)
      if (!body.ok) {
        report(`${request.method} ${url.pathname}: request could not be decoded: ${body.problem}`)
        return Response.json({ code: 'bad_request', message: body.problem }, { status: 400 })
      }
      try {
        const pending = candidate.spy({ request, url, params, body: body.value })
        noteHeld(flight, pending)
        const result = await pending
        return result instanceof Response ? result : Response.json(result ?? null)
      } catch (error) {
        if (error instanceof ORPCError)
          return Response.json(backendErrorBody(error), { status: error.status })
        if (error instanceof FakeNetworkFailure) throw error
        reportUnexpected(report, `${request.method} ${url.pathname}`, error)
        return Response.json({ code: 'internal_error', message: 'Handler failed' }, { status: 500 })
      }
    }
    report(`unhandled ${base} request: ${request.method} ${path}${url.search}`)
    return Response.json({ code: 'not_implemented', message: 'Not implemented' }, { status: 501 })
  }

  const flights = new Set<Flight>()
  const tracked: Dispatch = (request) => {
    let resolveDone!: () => void
    const flight: Flight = {
      label: `${request.method} ${new URL(request.url).pathname}`,
      done: new Promise<void>((resolve) => {
        resolveDone = resolve
      }),
      finished: false,
      responded: false,
      bodyReading: false,
    }
    const end = () => {
      if (flight.finished) return
      flight.finished = true
      flights.delete(flight)
      resolveDone()
    }
    flights.add(flight)
    if (request.signal.aborted) flight.aborted = true
    else request.signal.addEventListener('abort', () => (flight.aborted = true), { once: true })
    return dispatch(request, flight).then(
      (response) => {
        flight.responded = true
        return observeBody(response, request.signal, flight, end)
      },
      (error: unknown) => {
        end()
        throw error
      },
    )
  }

  const fakeFetch = vi.fn<typeof fetch>((input, init) =>
    abortable(new Request(input, init), tracked),
  )
  const FakeXMLHttpRequest = createFakeXMLHttpRequest(tracked)

  const stubTransports = () => {
    vi.stubGlobal('fetch', fakeFetch)
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  }
  stubTransports()

  const teardown = async () => {
    // Keep serving (and checking) requests while in-flight responses finish, even if an
    // `afterEach` already restored the globals; restore the real transports only at the end.
    stubTransports()
    try {
      // Responses still being produced are validated after the test body ends; wait for them,
      // including requests they trigger, except ones the test holds open or the client aborted.
      // Still owed a response, or a body the client is reading; unread bodies do not block.
      const settling = (flight: Flight) =>
        !flight.finished &&
        !flight.aborted &&
        !isHeld(flight) &&
        (!flight.responded || flight.bodyReading)
      const sleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms))
      const deadline = realNow() + PENDING_REQUEST_GRACE_MS
      let waiting = [...flights].filter(settling)
      // Re-check after each wave: finishing one response can start the next request.
      for (let quiet = 0; quiet < 2 && realNow() < deadline;) {
        if (waiting.length) {
          quiet = 0
          await Promise.race([
            Promise.all(waiting.map((flight) => flight.done)),
            sleep(Math.min(25, deadline - realNow())),
          ])
        } else {
          quiet += 1
          await sleep(0)
        }
        waiting = [...flights].filter(settling)
      }
      for (const flight of waiting) {
        report(
          `${flight.label}: still pending when the test finished; settle it, or hold it with hold() or pendingResponse()`,
        )
      }
      if (problems.length) throw new Error(`Fake API problems:\n${problems.join('\n')}`)
    } finally {
      vi.unstubAllGlobals()
    }
  }
  return Object.assign(teardown, {
    console: spyTrees.console,
    marketplace: spyTrees.marketplace,
    route: (method: RouteMethod, base: ApiBase, path: string) => {
      const found = routes.find(
        (entry) => entry.method === method && entry.base === base && entry.path === path,
      )
      if (!found) throw new Error(`Fake API: no route ${method} ${base} ${path}`)
      return found.spy
    },
    use: (overrides: FakeApi) => {
      addHandlers('console', overrides.console)
      addHandlers('marketplace', overrides.marketplace)
      addRoutes(overrides.routes)
      const pick = (contract: 'console' | 'marketplace', tree: unknown) => {
        const picked: Record<string, unknown> = {}
        for (const [path] of collectLeaves((tree ?? {}) as HandlerTree))
          setAt(picked, path, spies.get(`${contract}:${path.join('.')}`))
        return picked
      }
      return {
        console: pick('console', overrides.console),
        marketplace: pick('marketplace', overrides.marketplace),
      }
    },
  }) as FakeApiHandle<T>
}

/**
 * Install the fake API before every test in the file and tear it down after each one. The
 * returned handle always points at the current test's fake. Pass a factory when handlers need
 * fresh per-test values; handlers can also close over module state reset in `beforeEach`.
 */
export function setupFakeApi<const T extends FakeApi>(api: T | (() => T)) {
  let current: FakeApiHandle<T> | undefined
  beforeEach(() => {
    const handle = installFakeApi(typeof api === 'function' ? api() : api)
    current = handle
    onTestFinished(async () => {
      current = undefined
      await handle()
    })
  })
  const active = () => {
    if (!current) throw new Error('Fake API: use the setupFakeApi handle inside a test or hook')
    return current
  }
  const handle: FakeApiSpies<T> = {
    get console() {
      return active().console
    },
    get marketplace() {
      return active().marketplace
    },
    route: (...args) => active().route(...args),
    use: (overrides) => active().use(overrides),
  }
  return handle
}

/**
 * A response that never arrives, for loading states a test leaves pending. Return it directly from
 * a handler (not from an `async` one, which would wrap it); teardown treats it as deliberately held.
 */
export function pendingResponse(): Promise<never> {
  const response = new Promise<never>(() => {})
  heldResponses.set(response, { settled: false })
  return response
}

type SpyInput<F> = F extends (input: infer I, ...args: never[]) => unknown ? I : never
type SpyOutput<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never

/** The next request a spy answers, held open until the test settles it. */
export type HeldRequest<F> = {
  /** Resolves with the request input once the request reaches the fake. */
  arrived: Promise<SpyInput<F>>
  resolve: (value: SpyOutput<F>) => void
  reject: (error: unknown) => void
  /** Answer the held request with the spy's regular implementation, as if it was never held. */
  release: () => void
}

/**
 * Hold the next request a handler or route spy answers until the test resolves or rejects it.
 * Settling before the request arrives is safe: the outcome is applied when it does, so a rejected
 * hold never surfaces as an unhandled rejection.
 */
export function hold<F extends AnyFunction>(spy: Mock<F>): HeldRequest<F> {
  type Outcome =
    | { kind: 'value'; value: unknown }
    | { kind: 'error'; error: unknown }
    | { kind: 'release' }
  let outcome: Outcome | undefined
  let settle: ((result: Outcome) => void) | undefined
  let arrive!: (input: SpyInput<F>) => void
  const arrived = new Promise<SpyInput<F>>((resolve) => {
    arrive = resolve
  })
  const state = { settled: false }
  const finish = (result: Outcome) => {
    if (outcome) throw new Error('Fake API: a held request can only be settled once')
    outcome = result
    // From now on teardown waits for this request instead of treating it as deliberately held.
    state.settled = true
    settle?.(result)
  }
  spy.mockImplementationOnce(((input: SpyInput<F>) => {
    arrive(input)
    const response = new Promise((resolve, reject) => {
      settle = (result) => {
        if (result.kind === 'value') return resolve(result.value)
        if (result.kind === 'error') return reject(result.error)
        const regular = regularImplementations.get(spy)
        if (!regular) return reject(new Error('Fake API: release() needs a fake API spy'))
        try {
          resolve(regular(input as never))
        } catch (error) {
          reject(error)
        }
      }
      if (outcome) settle(outcome)
    })
    heldResponses.set(response, state)
    return response
  }) as never)
  return {
    arrived,
    resolve: (value) => finish({ kind: 'value', value }),
    reject: (error) => finish({ kind: 'error', error }),
    release: () => {
      if (!regularImplementations.has(spy))
        throw new Error('Fake API: release() needs a fake API spy')
      finish({ kind: 'release' })
    },
  }
}
