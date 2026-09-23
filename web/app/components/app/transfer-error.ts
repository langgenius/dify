export async function getAppTransferErrorMessage(error: unknown): Promise<string | undefined> {
  if (error instanceof Response) {
    try {
      const body: unknown = await error.clone().json()
      if (body && typeof body === 'object') {
        if ('message' in body && typeof body.message === 'string') return body.message || undefined
        if ('error' in body && typeof body.error === 'string') return body.error || undefined
      }
    } catch {
      return undefined
    }
  }

  return error instanceof Error ? error.message || undefined : undefined
}
