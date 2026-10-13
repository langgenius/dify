export function getAppTransferErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message || undefined : undefined
}
