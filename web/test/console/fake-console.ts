import type { consoleRouterContract } from '@dify/contracts/console'
import type {
  AnyContractProcedure,
  AnyContractRouter,
  InferSchemaInput,
  InferSchemaOutput,
} from '@orpc/contract'
import { contractLoaders } from '@dify/contracts/api/console/orpc.gen'
import { ValidationError } from '@orpc/contract'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { implement, ORPCError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { vi } from 'vite-plus/test'
import { API_PREFIX } from '@/config'
import { repeatedQueryArrayRules } from '@/service/console/openapi-url'

type HandlerResult<T> = T | Promise<T>

/**
 * Handlers mirror the console contract tree. Each leaf receives the decoded, validated
 * request input (`params`, `query`, `body`) and returns a response that must satisfy the
 * contract's output schema. Throw an `ORPCError` to answer with an error status.
 */
export type FakeConsoleHandlers<T = typeof consoleRouterContract> = T extends AnyContractProcedure
  ? (
      input: InferSchemaOutput<T['~orpc']['inputSchema']>,
    ) => HandlerResult<InferSchemaInput<T['~orpc']['outputSchema']>>
  : { [K in keyof T]?: FakeConsoleHandlers<T[K]> }

type AnyHandler = (input: unknown) => unknown
type HandlerTree = { [key: string]: HandlerTree | AnyHandler }

/** Build an error response for a handler to throw or a deferred response to reject with. */
export function consoleError(code: string, status: number, message: string) {
  return new ORPCError(code, { status, message })
}

const consolePrefix = new URL(API_PREFIX).pathname as `/${string}`

function isConsoleRequest(url: URL) {
  const api = new URL(API_PREFIX)
  return url.origin === api.origin && url.pathname.startsWith(`${api.pathname}/`)
}

// The browser client rewrites some arrays to repeated keys for the Python backend;
// oRPC's OpenAPI decoder expects the indexed form, so restore it before decoding.
function restoreIndexedArrays(request: Request) {
  const url = new URL(request.url)
  const route = url.pathname.slice(consolePrefix.length)
  const rule = repeatedQueryArrayRules.find(({ path }) => path.test(route))
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
  const schema = (procedure as { '~orpc': { inputSchema?: unknown } })['~orpc'].inputSchema as
    | { shape?: Record<string, unknown>; unwrap?: () => unknown }
    | undefined
  let headersSchema = schema?.shape?.headers as typeof schema
  while (headersSchema && !headersSchema.shape && headersSchema.unwrap)
    headersSchema = headersSchema.unwrap() as typeof schema
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

function collectLeaves(tree: HandlerTree, path: string[] = []): Array<[string[], AnyHandler]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'function'
      ? [[[...path, key], value] as [string[], AnyHandler]]
      : collectLeaves(value, [...path, key]),
  )
}

async function buildRouter(tree: HandlerTree) {
  const leaves = collectLeaves(tree)
  const loaders = contractLoaders as unknown as Record<string, () => Promise<AnyContractRouter>>
  const segments = [...new Set(leaves.map(([path]) => path[0]!))]
  const contracts = Object.assign(
    {},
    ...(await Promise.all(
      segments.map((segment) => {
        const load = loaders[segment]
        if (!load) throw new Error(`Fake console: unknown contract segment "${segment}"`)
        return load()
      }),
    )),
  ) as Record<string, unknown>

  const router: Record<string, unknown> = {}
  for (const [path, handler] of leaves) {
    const procedure = path.reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      contracts,
    )
    if (!(procedure instanceof Object) || !('~orpc' in procedure))
      throw new Error(`Fake console: no contract procedure at ${path.join('.')}`)
    let node = router
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
    node[path.at(-1)!] = implement(procedure as AnyContractProcedure).handler(
      ({ input }: { input: unknown }) => handler(input),
    )
  }
  return router
}

/**
 * Serve console API requests from contract-validated handlers through the real client,
 * transport and TanStack Query. Call during test setup and register the returned teardown
 * with `onTestFinished`; it fails the test on unhandled requests or contract violations.
 */
export function installFakeConsole(handlers: FakeConsoleHandlers) {
  const problems: string[] = []
  let handlerPromise: Promise<OpenAPIHandler<Record<never, never>>> | undefined
  const getHandler = () =>
    (handlerPromise ??= buildRouter(handlers as HandlerTree).then(
      (router) =>
        new OpenAPIHandler(router as never, {
          // Query strings and path params arrive as text; the Python API coerces them by schema.
          plugins: [
            new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] }),
          ],
          clientInterceptors: [
            ({ next, input, procedure, ...options }) =>
              next({ ...options, input: restoreHeaderCase(procedure, input), procedure }),
          ],
          interceptors: [
            async ({ next, request }) => {
              try {
                return await next()
              } catch (error) {
                if (error instanceof ORPCError && error.cause instanceof ValidationError) {
                  problems.push(
                    `${request.method} ${request.url.pathname}: ${error.message} ${JSON.stringify(error.cause.issues)}`,
                  )
                }
                throw error
              }
            },
          ],
        }),
    ))

  const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!isConsoleRequest(url)) {
      problems.push(`unexpected network request: ${request.method} ${url.href}`)
      throw new Error(`Unexpected network request: ${request.method} ${url.href}`)
    }
    const { matched, response } = await (
      await getHandler()
    ).handle(restoreIndexedArrays(request), {
      prefix: consolePrefix,
      context: {},
    })
    if (matched) return response!
    problems.push(`unhandled console request: ${request.method} ${url.pathname}${url.search}`)
    return Response.json({ code: 'not_implemented' }, { status: 501 })
  })
  vi.stubGlobal('fetch', fakeFetch)

  return () => {
    vi.unstubAllGlobals()
    if (problems.length) throw new Error(`Fake console problems:\n${problems.join('\n')}`)
  }
}
