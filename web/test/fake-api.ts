import type { consoleRouterContract } from '@dify/contracts/console'
import type { AnyContractProcedure, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { Mock } from 'vite-plus/test'
import { marketplaceRouterContract } from '@dify/contracts/marketplace'
import { ValidationError } from '@orpc/contract'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { implement, ORPCError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { vi } from 'vite-plus/test'
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
    node[path.at(-1)!] = implement(procedure as AnyContractProcedure).handler(
      ({ input }: { input: unknown }) => handler(input),
    )
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
      ).handle(restoreIndexedArrays(request.clone()), { prefix: prefixPath('console'), context })
      if (context.networkFailed) throw networkError()
      if (matched) return response!
    }
    if (base === 'marketplace' && leavesOf('marketplace').length) {
      const context: RequestContext = {}
      const { matched, response } = await getMarketplaceHandler().handle(request.clone(), {
        prefix: prefixPath('marketplace'),
        context,
      })
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
