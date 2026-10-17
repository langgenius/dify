import type {
  ClientContext,
  ORPCErrorOptions,
  StandardBody,
  StandardLazyResponse,
} from '@orpc/client'
import type { StandardLinkTransportInterceptorOptions } from '@orpc/client/standard'
import { ORPCError } from '@orpc/client'

/**
 * A non-2xx backend response as an oRPC error. oRPC v2 errors carry no HTTP status, so the
 * status lives on this subclass; contract reconciliation clones errors with their own props.
 */
export class HttpError<TCode extends string = string> extends ORPCError<
  TCode,
  Record<string, unknown> | undefined
> {
  readonly status: number

  constructor(
    code: TCode,
    {
      status,
      ...options
    }: ORPCErrorOptions<Record<string, unknown> | undefined> & { status: number },
  ) {
    super(code, options)
    this.status = status
  }
}

/**
 * Checks the `status` field instead of `instanceof HttpError`: RSC and SSR module graphs load
 * separate copies of this class, while `ORPCError` matches across them.
 */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof ORPCError && 'status' in error && typeof error.status === 'number'
}

export function getHttpErrorStatus(error: unknown): number | undefined {
  return isHttpError(error) ? error.status : undefined
}

export function isUnauthorizedError(error: unknown): boolean {
  return getHttpErrorStatus(error) === 401
}

export function isNotFoundError(error: unknown): boolean {
  return getHttpErrorStatus(error) === 404
}

/** 3xx responses are not failures, and ORPCError rejects statuses in 200-399. */
export function isHttpErrorStatus(status: number): boolean {
  return status < 200 || status >= 400
}

/** Rate limits and server outages are worth retrying instead of treating as a final answer. */
export function isTransientHttpError(error: unknown): boolean {
  const status = getHttpErrorStatus(error)
  return status === 408 || status === 429 || (status !== undefined && status >= 500)
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

/** Decode the backend envelope without declaring it as a validated contract error. */
export function createHttpError(
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  body?: unknown,
) {
  const data = asRecord(body)
  return new HttpError(nonEmptyString(data?.code) ?? 'HTTP_ERROR', {
    // The HTTP status is authoritative even when the response body disagrees.
    status: response.status,
    message:
      nonEmptyString(data?.message) ??
      nonEmptyString(data?.error) ??
      nonEmptyString(response.statusText) ??
      `HTTP ${response.status}`,
    data,
    cause: { headers: new Headers(response.headers) },
  })
}

/** `customErrorResponseBodyDecoder` for OpenAPI links whose backend answers with its own error body. */
export function httpErrorFromStandardResponse(
  body: unknown,
  response: { status: number; headers: Record<string, string | string[] | undefined> },
) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      headers.append(key, item)
  }
  return createHttpError({ status: response.status, statusText: '', headers }, body)
}

export function httpErrorFromXhr(xhr: XMLHttpRequest) {
  const headers = new Headers()
  for (const line of xhr
    .getAllResponseHeaders()
    .trim()
    .split(/[\r\n]+/)) {
    const separator = line.indexOf(':')
    if (separator > 0) headers.append(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  return createHttpError({ status: xhr.status, statusText: xhr.statusText, headers }, xhr.response)
}

/**
 * Link transport interceptor that reads non-2xx bodies as JSON whatever their content type, like
 * `httpErrorFromResponse`, so `httpErrorFromStandardResponse` decodes the backend envelope.
 * Empty, malformed JSON and proxy HTML errors decode to no body and still carry an HTTP status.
 */
export async function resolveHttpErrorBody<TContext extends ClientContext>({
  next,
}: StandardLinkTransportInterceptorOptions<TContext> & {
  next: () => Promise<StandardLazyResponse>
}): Promise<StandardLazyResponse> {
  const response = await next()
  if (!isHttpErrorStatus(response.status)) return response

  let body: Promise<StandardBody> | undefined
  return {
    status: response.status,
    headers: response.headers,
    resolveBody: () => {
      body ??= response.resolveBody('json').catch((error: unknown) => {
        // Body read failures, including cancellation, must keep their original identity.
        if (!(error instanceof SyntaxError)) throw error
        return undefined
      })
      return body
    },
  }
}

export async function httpErrorFromResponse(response: Response) {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch (error) {
    // Empty, malformed JSON and proxy HTML errors still carry an HTTP status.
    // Body read failures, including cancellation, must keep their original identity.
    if (!(error instanceof SyntaxError)) throw error
  }
  return createHttpError(response, body)
}
