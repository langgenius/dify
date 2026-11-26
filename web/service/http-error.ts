import { ORPCError } from '@orpc/client'

export function getHttpErrorStatus(error: unknown): number | undefined {
  return error instanceof ORPCError ? error.status : undefined
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

export function getHttpErrorBodyMessage(body: unknown): string | undefined {
  const data = asRecord(body)
  return nonEmptyString(data?.message) ?? nonEmptyString(data?.error)
}

/**
 * The server's message for a failed request, for an owner that presents the failure itself and
 * falls back to its own text. Client-side errors such as "Failed to fetch" yield nothing.
 */
export function getRequestErrorMessage(error: unknown): string | undefined {
  return error instanceof ORPCError ? getHttpErrorBodyMessage(error.data) : undefined
}

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
      getHttpErrorBodyMessage(data) ??
      nonEmptyString(response.statusText) ??
      `HTTP ${response.status}`,
    data,
    cause: { headers: new Headers(response.headers) },
  })
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
