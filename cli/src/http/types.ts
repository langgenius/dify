export type HttpLogPhase = 'request' | 'response' | 'retry'

export type HttpLogEvent = {
  readonly phase: HttpLogPhase
  readonly method: string
  readonly url: string
  readonly status?: number
  readonly attempt?: number
  readonly durationMs?: number
  // Set on a 429 retry decision so --verbose can explain how long we waited.
  readonly delayMs?: number
}

export type HttpLogger = (event: HttpLogEvent) => void

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type SearchParamValue = string | number | boolean | undefined

// Local equivalents of the DOM-named union types — globals exist (Request, Response, Headers, Blob, …)
// but the union aliases BodyInit / HeadersInit are not exposed by @types/node. Matching the shapes
// the global Request/Response constructors accept; ArrayBufferView is omitted because @types/node's
// RequestInit is stricter and only accepts DataView, which `Uint8Array` covers for our byte-buffer
// callers.
export type HeadersInit = Headers | [string, string][] | Record<string, string>
export type BodyInit = string | Blob | ArrayBuffer | FormData | URLSearchParams | ReadableStream<Uint8Array> | Uint8Array

export type FetchContext = {
  request: Request
  readonly options: ResolvedOptions
  response?: Response
  error?: unknown
  attempt: number
  readonly meta: Map<string | symbol, unknown>
}

export type Hook = (ctx: FetchContext) => void | Promise<void>

export type Hooks = {
  readonly onRequest?: Hook | Hook[]
  readonly onResponse?: Hook | Hook[]
  readonly onRequestError?: Hook | Hook[]
  readonly onResponseError?: Hook | Hook[]
}

export type RequestOptions = {
  readonly method?: HttpMethod
  readonly headers?: HeadersInit
  readonly json?: unknown
  readonly body?: BodyInit
  readonly searchParams?: Record<string, SearchParamValue>
  readonly timeoutMs?: number
  readonly retryAttempts?: number
  readonly signal?: AbortSignal
  readonly throwOnError?: boolean
  // Opt a non-idempotent POST into bounded wait-and-retry on a 429 throttle.
  readonly retryOnRateLimit?: boolean
}

export type ResolvedOptions = {
  readonly method: HttpMethod
  readonly headers: Headers
  readonly body: BodyInit | undefined
  readonly timeoutMs: number | undefined
  readonly retryAttempts: number
  readonly throwOnError: boolean
  readonly retryOnRateLimit: boolean
}

export type ClientOptions = {
  readonly baseURL: string
  readonly bearer?: string
  readonly userAgent?: string
  readonly timeoutMs?: number
  readonly retryAttempts?: number
  readonly logger?: HttpLogger
  readonly hooks?: Hooks
  // Skip TLS certificate verification (local-dev only, self-signed hosts).
  readonly insecure?: boolean
}

export type HttpClient = {
  // The resolved base URL this client was created with (e.g. openAPIBase(host)). Exposed so
  // callers can build a contract/oRPC facade over the same transport without re-deriving it.
  readonly baseURL: string
  readonly get: <T>(path: string, opts?: RequestOptions) => Promise<T>
  readonly post: <T>(path: string, opts?: RequestOptions) => Promise<T>
  readonly put: <T>(path: string, opts?: RequestOptions) => Promise<T>
  readonly patch: <T>(path: string, opts?: RequestOptions) => Promise<T>
  readonly delete: <T>(path: string, opts?: RequestOptions) => Promise<T>
  readonly fetch: (path: string, opts?: RequestOptions) => Promise<Response>
  readonly stream: (path: string, opts?: RequestOptions) => Promise<Response>
  // Low-level entrypoint for oRPC's OpenAPILink: runs a pre-built, absolute-URL Request
  // through the transport (UA+bearer, retry, timeout, error-map) without re-joining baseURL.
  readonly request: (req: Request, init?: RequestInit) => Promise<Response>
  readonly extend: (overrides: Partial<ClientOptions>) => HttpClient
}
