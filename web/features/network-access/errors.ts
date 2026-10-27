export function getNetworkAccessErrorStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') return error.status
    if (
      'response' in error &&
      typeof error.response === 'object' &&
      error.response !== null &&
      'status' in error.response &&
      typeof error.response.status === 'number'
    )
      return error.response.status
  }
}
