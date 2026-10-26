import type { OperationDescriptor } from './operation.js'
import type { CallOptions } from './types.js'
import { getFilenameFromContentDisposition } from '@orpc/standard-server'

export type ClientOptions = {
  baseUrl?: string
  headers?: HeadersInit
  fetch?: typeof globalThis.fetch
}

export class ApiError extends Error {
  readonly response: globalThis.Response
  readonly data: unknown
  constructor(response: globalThis.Response, data: unknown) {
    super(`HTTP ${response.status} ${response.statusText}`)
    this.name = 'ApiError'
    this.response = response
    this.data = data
  }
}

export type RuntimeOptions = {
  client?: HttpClient
  path?: Record<string, unknown>
  query?: Record<string, unknown>
  header?: Record<string, unknown>
  cookie?: Record<string, unknown>
  body?: unknown
  contentType?: string
  headers?: HeadersInit
  signal?: AbortSignal
  credentials?: RequestCredentials
  context?: object
}

/** Bound per document at build time; never wraps or enumerates the router. */
export type RuntimeConfig<Context extends object = object> = {
  createClient?: (options: CallOptions<Context>) => HttpClient
  queryKeyPrefix?: readonly string[]
  onError?: (error: unknown) => void
}

function scalar(value: unknown): string {
  if (!['string', 'number', 'boolean'].includes(typeof value))
    throw new Error('Parameter values must be strings, numbers, booleans, or flat arrays/objects')
  return String(value)
}

function simple(value: unknown, explode: boolean, encode: (s: string) => string): string {
  if (Array.isArray(value)) return value.map((item) => encode(scalar(item))).join(',')
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${encode(key)}${explode ? '=' : ','}${encode(scalar(item))}`)
      .join(',')
  }
  return encode(scalar(value))
}

function queryValues(
  search: URLSearchParams,
  name: string,
  value: unknown,
  style: string,
  explode: boolean,
) {
  if (style === 'deepObject') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !explode)
      throw new Error('deepObject requires a flat object and explode: true')
    for (const [key, item] of Object.entries(value)) search.append(`${name}[${key}]`, scalar(item))
  } else if (style === 'form') {
    if (Array.isArray(value) && explode) value.forEach((item) => search.append(name, scalar(item)))
    else if (value && typeof value === 'object' && !Array.isArray(value) && explode)
      Object.entries(value).forEach(([key, item]) => search.append(key, scalar(item)))
    else
      search.append(
        name,
        simple(value, false, (s) => s),
      )
  } else {
    throw new Error(`Unsupported query serialization style: ${style}`)
  }
}

export type HttpClient = {
  getConfig: () => ClientOptions
  setConfig: (config: Partial<ClientOptions>) => void
  request: (operation: OperationDescriptor, options?: RuntimeOptions) => Promise<unknown>
}

export function createClient(initial: ClientOptions = {}): HttpClient {
  let config = { ...initial }
  async function request(
    operation: OperationDescriptor,
    options: RuntimeOptions = {},
  ): Promise<unknown> {
    const { method, path: template, parameters = [] } = operation
    const fetcher = config.fetch ?? globalThis.fetch
    let path = template
    const search = new URLSearchParams()
    const headers = new Headers(config.headers)
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    for (const parameter of parameters) {
      const location = String(parameter.in)
      const name = String(parameter.name)
      const group = options[location as 'path' | 'query' | 'header' | 'cookie']
      const value = group && Object.hasOwn(group, name) ? group[name] : undefined
      if (value === undefined) {
        if (parameter.required === true || location === 'path')
          throw new Error(`Missing required ${location} parameter: ${name}`)
        continue
      }
      const style = String(
        parameter.style ?? (location === 'query' || location === 'cookie' ? 'form' : 'simple'),
      )
      const explode =
        parameter.explode === undefined ? style === 'form' : parameter.explode === true
      switch (location) {
        case 'path':
          if (style !== 'simple') throw new Error(`Unsupported path style: ${style}`)
          path = path.replaceAll(`{${name}}`, simple(value, explode, encodeURIComponent))
          break
        case 'query':
          queryValues(search, name, value, style, explode)
          break
        case 'header':
          if (style !== 'simple') throw new Error(`Unsupported header style: ${style}`)
          headers.set(
            name,
            simple(value, explode, (s) => s),
          )
          break
        case 'cookie':
          // Fetch forbids manually setting Cookie in browsers; usable in Node.
          if (style !== 'form' || typeof value === 'object')
            throw new Error('Only primitive form-style cookies are supported')
          headers.set(
            'Cookie',
            [
              headers.get('Cookie'),
              `${encodeURIComponent(name)}=${encodeURIComponent(scalar(value))}`,
            ]
              .filter(Boolean)
              .join('; '),
          )
          break
        default:
          throw new Error(`Unsupported parameter location: ${location}`)
      }
    }
    if (/\{[^}]+\}/.test(path)) throw new Error(`Unresolved path template: ${path}`)
    const base = config.baseUrl ?? operation.baseUrl
    if (!base || /\{[^}]+\}/.test(base))
      throw new Error('Provide baseUrl, or a server URL without template variables')
    const url = new URL(
      `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
      globalThis.location?.origin,
    )
    search.forEach((value, key) => url.searchParams.append(key, value))
    if (operation.bodyRequired && options.body === undefined)
      throw new Error('Missing required request body')
    let body: BodyInit | undefined
    if (options.body !== undefined) {
      const mediaType = options.contentType ?? operation.contentType
      if (!mediaType || !(operation.contentTypes ?? [operation.contentType]).includes(mediaType))
        throw new Error('Request content type must be declared by the operation')
      if (mediaType === 'multipart/form-data') {
        const form = new FormData()
        if (!options.body || typeof options.body !== 'object' || Array.isArray(options.body))
          throw new Error('Multipart body must be an object')
        for (const [key, value] of Object.entries(options.body)) {
          if (value === undefined) continue
          if (operation.multipartJson?.includes(key)) {
            form.append(key, new Blob([JSON.stringify(value)], { type: 'application/json' }))
          } else {
            for (const item of Array.isArray(value) ? value : [value])
              form.append(key, item instanceof Blob ? item : scalar(item))
          }
        }
        // Fetch supplies the boundary, including when a shared client has JSON headers.
        headers.delete('Content-Type')
        body = form
      } else if (mediaType === 'application/octet-stream') {
        if (!(options.body instanceof Blob)) throw new Error('Binary body must be a Blob or File')
        headers.set('Content-Type', mediaType)
        body = options.body
      } else {
        headers.set('Content-Type', mediaType)
        body = JSON.stringify(options.body)
      }
    }
    const response = await fetcher(url, {
      method: method.toUpperCase(),
      headers,
      body,
      signal: options.signal,
      credentials: options.credentials,
    })
    let contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (response.ok) {
      const media =
        operation.responseContentTypes?.[response.status] ?? operation.responseContentTypes?.['2XX']
      // Match the most specific declaration. A binary wildcard remains a Blob
      // even when the server chooses JSON, text, or SSE as its concrete media type.
      if (media && !media.includes(contentType)) {
        const range = `${contentType.split('/')[0]}/*`
        if (media.includes(range)) contentType = range
        else if (media.includes('*/*')) contentType = '*/*'
      }
    }
    let data: unknown
    if (response.status !== 204 && response.status !== 205 && method !== 'head') {
      const disposition = response.headers.get('content-disposition')
      if (response.ok && disposition !== null) {
        const blob = await response.blob()
        data = new File([blob], getFilenameFromContentDisposition(disposition) ?? 'blob', {
          type: blob.type,
        })
      } else if (response.ok && contentType === 'text/event-stream') data = response.body
      else if (contentType === 'application/json' || contentType.endsWith('+json'))
        data = await response.json()
      else if (contentType.startsWith('text/')) data = await response.text()
      else data = await response.blob()
    }
    if (!response.ok) throw new ApiError(response, data)
    return data
  }

  return {
    request,
    getConfig: () => ({ ...config, headers: new Headers(config.headers) }),
    setConfig: (update) => {
      config = { ...config, ...update }
    },
  }
}

export const client = /* @__PURE__ */ createClient()

export async function invokeRpcOperation(
  operation: OperationDescriptor,
  input: Omit<RuntimeOptions, 'path' | 'header' | 'headers'> & {
    params?: Record<string, unknown>
    headers?: Record<string, unknown>
  } = {},
  options: CallOptions = {},
  runtime?: RuntimeConfig,
  validateError?: (error: unknown) => Promise<unknown>,
): Promise<unknown> {
  const { params, headers, ...request } = input
  const call = { ...request, path: params, ...options, header: headers }
  try {
    const transport = call.client ?? runtime?.createClient?.(call) ?? client
    return await transport.request(operation, call)
  } catch (error) {
    const failure = validateError ? await validateError(error) : error
    runtime?.onError?.(failure)
    throw failure
  }
}
