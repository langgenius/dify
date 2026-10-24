function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if ('name' in error && error.name === 'AbortError') return true
  return 'cause' in error && isAbortError(error.cause)
}

export function reportClientError(error: unknown) {
  if (!isAbortError(error)) console.error(error)
}
