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
 * Teardown to register with `onTestFinished`, which also exposes the handlers as spies:
 * `fake.console.<contract path>` and `fake.route(method, base, path)` record every request input,
 * and `fake.use(...)` overrides or adds handlers mid-test.
 */
export type FakeApiHandle<T extends FakeApi> = (() => void) & {
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
  console: new URL(API_PREFIX),
  public: new URL(PUBLIC_API_PREFIX),
  marketplace: new URL(MARKETPLACE_API_PREFIX),
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
function restoreIndexedArrays(request: Request) {
  const url = new URL(request.url)
  const routePath = url.pathname.slice(prefixPath('console').length)
  const rule = repeatedQueryArrayRules.find(({ path }) => path.test(routePath))
  if (!rule) return request
  for (const field of rule.fields) {
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
    ).handler(({ input }: { input: unknown }) => handler(hasInput ? input : sentParts(input)))
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

function createContractHandler(router: Record<string, unknown>, report: (problem: string) => void) {
  return new OpenAPIHandler(router as never, {
    // Query strings and path params arrive as text; the Python API coerces them by schema.
    plugins: [new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] })],
    clientInterceptors: [
      async ({ next, input, procedure, context, ...options }) => {
        try {
          return await next({
            ...options,
            context,
            input: restoreHeaderCase(procedure, input),
            procedure,
          })
        } catch (error) {
          // oRPC would turn this into a 500; flag it so the dispatcher rejects like an offline fetch.
          if (error instanceof FakeNetworkFailure) (context as RequestContext).networkFailed = true
          throw error
        }
      },
    ],
    interceptors: [
      async ({ next, request }) => {
        try {
          return await next()
        } catch (error) {
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

function errorResponse(error: unknown) {
  if (error instanceof ORPCError)
    return Response.json(backendErrorBody(error), { status: error.status })
  throw error
}

type Dispatch = (request: Request) => Promise<Response>
type RequestContext = { networkFailed?: boolean }

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
      this.readyState = 4
      this.#emit(this as never, 'abort', new Event('abort'))
    }

    send(body?: XMLHttpRequestBodyInit | null) {
      const request = new Request(this.#url, {
        method: this.#method,
        headers: this.#headers,
        body: this.#method === 'GET' || this.#method === 'HEAD' ? undefined : body,
      })
      void dispatch(request).then(
        async (response) => {
          if (this.#aborted) return
          const text = await response.text()
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
          this.response = this.responseType === 'json' ? (text ? JSON.parse(text) : null) : text
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

async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const type = request.headers.get('content-type') ?? ''
  const copy = request.clone()
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded'))
    return copy.formData()
  const text = await copy.text()
  if (!text) return undefined
  if (type.includes('json')) return JSON.parse(text)
  try {
    return JSON.parse(text)
  } catch {
    return text
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
      const spy = vi.fn(handler)
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
    routes = [...added.map((entry) => ({ ...entry, spy: vi.fn(entry.handler) })), ...routes]
  }
  addRoutes(api.routes)

  const nativeFetch = globalThis.fetch
  const dispatch: Dispatch = async (request) => {
    const url = new URL(request.url)
    // `data:` and `blob:` URLs are local resources (image previews, downloads), never the network.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return nativeFetch(request)
    const base = baseOf(url)
    if (!base) {
      report(`unexpected network request: ${request.method} ${url.href}`)
      throw new TypeError('Failed to fetch')
    }
    if (base === 'console' && leavesOf('console').length) {
      const context: RequestContext = {}
      const { matched, response } = await (
        await getConsoleHandler()
      ).handle(splitRequestCustomMethods(restoreIndexedArrays(request.clone())), {
        prefix: prefixPath('console'),
        context,
      })
      if (context.networkFailed) throw networkError()
      if (matched) return response!
    }
    if (base === 'marketplace' && leavesOf('marketplace').length) {
      const context: RequestContext = {}
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
      try {
        const result = await candidate.spy({ request, url, params, body: await readBody(request) })
        return result instanceof Response ? result : Response.json(result ?? null)
      } catch (error) {
        return errorResponse(error)
      }
    }
    report(`unhandled ${base} request: ${request.method} ${path}${url.search}`)
    return Response.json({ code: 'not_implemented', message: 'Not implemented' }, { status: 501 })
  }

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => dispatch(new Request(input, init))),
  )
  vi.stubGlobal('XMLHttpRequest', createFakeXMLHttpRequest(dispatch))

  const teardown = () => {
    vi.unstubAllGlobals()
    if (problems.length) throw new Error(`Fake API problems:\n${problems.join('\n')}`)
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
    onTestFinished(() => {
      current = undefined
      handle()
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
  type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown }
  let outcome: Outcome | undefined
  let settle: ((result: Outcome) => void) | undefined
  let arrive!: (input: SpyInput<F>) => void
  const arrived = new Promise<SpyInput<F>>((resolve) => {
    arrive = resolve
  })
  const finish = (result: Outcome) => {
    if (outcome) throw new Error('Fake API: a held request can only be settled once')
    outcome = result
    settle?.(result)
  }
  spy.mockImplementationOnce(((input: SpyInput<F>) => {
    arrive(input)
    return new Promise((resolve, reject) => {
      settle = (result) => (result.ok ? resolve(result.value) : reject(result.error))
      if (outcome) settle(outcome)
    })
  }) as never)
  return {
    arrived,
    resolve: (value) => finish({ ok: true, value }),
    reject: (error) => finish({ ok: false, error }),
    release: () => {
      const regular = spy.getMockImplementation()
      if (!regular) throw new Error('Fake API: release needs a spy with an implementation')
      void arrived
        .then((input) => (regular as AnyFunction)(input as never))
        .then(
          (value) => finish({ ok: true, value }),
          (error: unknown) => finish({ ok: false, error }),
        )
    },
  }
}
