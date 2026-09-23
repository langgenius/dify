import type { HttpClient, RequestOptions, SearchParamValue } from './types.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { classifyResponse } from './error-mapper.js'
import { appendSearchParams, joinURL } from './url.js'

const HEADER = 'X-Dify-Catalog'
const catalogSchema = z.object({
  ops: z.record(
    z.string(),
    z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().startsWith('/openapi/v1/'),
      input: z.object({ required: z.array(z.string()).default([]) }).catchall(z.unknown()),
      bind: z.record(z.string(), z.enum(['path', 'query', 'body', 'file'])),
    }),
  ),
})
type Catalog = { document: z.infer<typeof catalogSchema>; fingerprint: string }

const catalogs = new WeakMap<HttpClient, Promise<Catalog>>()

function incompatible(message: string): BaseError {
  return new BaseError({ code: ErrorCode.VersionSkew, message })
}

function loadCatalog(http: HttpClient): Promise<Catalog> {
  const cached = catalogs.get(http)
  if (cached) return cached
  const pending = (async () => {
    const response = await http.fetch('_catalog')
    if (!response.ok)
      throw await classifyResponse(new Request(joinURL(http.baseURL, '_catalog')), response)
    const raw = await response.text()
    const fingerprint = createHash('sha256').update(raw).digest('hex')
    if (response.headers.get(HEADER) !== fingerprint)
      throw incompatible('The server catalog fingerprint does not match its contents.')
    const document = catalogSchema.parse(JSON.parse(raw))
    return { document, fingerprint }
  })()
  catalogs.set(http, pending)
  void pending.catch(() => {
    if (catalogs.get(http) === pending) catalogs.delete(http)
  })
  return pending
}

function waitForCatalog(pending: Promise<Catalog>, signal?: AbortSignal): Promise<Catalog> {
  signal?.throwIfAborted()
  if (!signal) return pending
  // Cancel this caller's wait without aborting the download shared by other callers.
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (catalog) => {
        signal.removeEventListener('abort', onAbort)
        resolve(catalog)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** Build JSON operations from the current server catalog; never bless a stale hardcoded route. */
export async function requestCatalogOperation(
  http: HttpClient,
  operation: string,
  input: Record<string, unknown>,
  options: RequestOptions & { stream?: boolean } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted()
    const pending = loadCatalog(http)
    const catalog = await waitForCatalog(pending, options.signal)
    const op = catalog.document.ops[operation]
    if (!op) throw incompatible(`The server catalog does not support ${operation}.`)
    const values = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    )
    if (op.input.required.some((key) => !(key in values)))
      throw incompatible(`Missing required input for ${operation}.`)
    // Reject unknown fields as well as missing/changed input constraints after a refresh.
    const properties = z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .parse(op.input.properties)
    for (const [key, binding] of Object.entries(op.bind)) {
      if (binding === 'file') properties[key] = {}
    }
    const validation = z
      .fromJSONSchema({ ...op.input, properties, additionalProperties: false })
      .safeParse(values)
    if (!validation.success)
      throw incompatible(
        `Input for ${operation} is incompatible with the server catalog: ${validation.error.message}`,
      )
    let path = op.path
    const query: Record<string, SearchParamValue> = {}
    const body: Record<string, unknown> = {}
    const form = new FormData()
    let multipart = false
    for (const [key, value] of Object.entries(values)) {
      switch (op.bind[key]) {
        case 'path':
          path = path.replace(`{${key}}`, encodeURIComponent(String(value)))
          break
        case 'query':
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
            throw incompatible(`Unsupported query value for ${operation}.${key}.`)
          query[key] = value
          break
        case 'file':
          if (!(value instanceof Blob))
            throw incompatible(`Unsupported file input for ${operation}.${key}.`)
          form.append(key, value)
          multipart = true
          break
        case 'body':
          body[key] = value
          break
        default:
          throw incompatible(`Unsupported parameter binding for ${operation}.${key}.`)
      }
    }
    if (/[{}?#]/.test(path) || path.includes('/../') || path.includes('/./'))
      throw incompatible(`Invalid catalog path for ${operation}.`)
    const relativePath = path.slice('/openapi/v1/'.length)
    if (multipart) {
      for (const [key, value] of Object.entries(body))
        form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    const headers = new Headers(options.headers)
    headers.set(HEADER, catalog.fingerprint)
    const response = await (options.stream ? http.stream : http.fetch)(relativePath, {
      ...options,
      throwOnError: false,
      method: op.method,
      headers,
      searchParams: query,
      ...(multipart ? { body: form } : Object.keys(body).length ? { json: body } : {}),
    })
    if (response.ok) return response
    const request = new Request(appendSearchParams(joinURL(http.baseURL, relativePath), query), {
      method: op.method,
    })
    const error = await classifyResponse(request, response)
    if (response.status === 412 && error.serverError?.code === 'catalog_stale') {
      // This rejection occurs before the handler, so even POST can be rebuilt once safely.
      if (catalogs.get(http) === pending) catalogs.delete(http)
      if (attempt === 0) continue
    }
    throw error
  }
}

export async function callCatalogOperation<T>(
  http: HttpClient,
  operation: string,
  input: Record<string, unknown>,
  options?: RequestOptions,
): Promise<T> {
  const response = await requestCatalogOperation(http, operation, input, options)
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
