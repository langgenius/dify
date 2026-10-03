// Failed console requests reject with the fetch Response for HTTP errors and
// with an Error when the request never completed.
export const describeRequestError = (error: unknown): string | undefined => {
  if (error instanceof Response)
    return `HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ''}`
  if (error instanceof Error && error.message) return error.message
  return undefined
}
