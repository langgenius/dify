import { ORPCError } from '@orpc/client'

export function getHttpErrorStatus(error: unknown): number | undefined {
  return error instanceof ORPCError ? error.status : undefined
}

/**
 * Literal `code` values an operation documents across its error statuses, from a generated
 * `*Errors` type. Open error bodies (`code: string`) contribute nothing, so only codes the
 * backend actually documents for that operation are accepted.
 */
export type DocumentedErrorCode<TErrors> = {
  [Status in keyof TErrors]: TErrors[Status] extends { code: infer Code extends string }
    ? string extends Code
      ? never
      : Code
    : never
}[keyof TErrors]

/**
 * Whether `error` is the backend error `code` for the operation whose generated `*Errors` type is
 * `TErrors`. A code the operation does not document fails to type-check.
 */
export function isApiErrorCode<TErrors>(
  error: unknown,
  code: DocumentedErrorCode<TErrors>,
): error is ORPCError<DocumentedErrorCode<TErrors>, unknown> {
  return error instanceof ORPCError && error.code === code
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
  return new ORPCError(nonEmptyString(data?.code) ?? 'HTTP_ERROR', {
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
