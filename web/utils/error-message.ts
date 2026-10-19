export function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message || undefined : undefined
}
