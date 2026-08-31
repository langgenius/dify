export function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}
