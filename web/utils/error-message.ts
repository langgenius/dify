import { ORPCError } from '@orpc/client'

export function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message || undefined : undefined
}

/** Backend feedback formerly supplied by HTTP; auth and transport errors have separate owners. */
export function getServerErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ORPCError) || error.status < 400 || error.status === 401) return undefined
  return [error.data?.message, error.data?.error].find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  )
}
