import { ORPCError } from '@orpc/client'

export function getHttpErrorStatus(error: unknown): number | undefined {
  return error instanceof ORPCError ? error.status : undefined
}

export function isNotFoundError(error: unknown): boolean {
  return getHttpErrorStatus(error) === 404
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

export async function httpErrorFromResponse(response: Response) {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    // Empty, malformed JSON and proxy HTML errors still carry an HTTP status.
  }
  return createHttpError(response, body)
}
