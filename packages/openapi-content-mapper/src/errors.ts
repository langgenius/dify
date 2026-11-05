import type { ErrorMap } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { validateORPCError } from '@orpc/contract'
import { ApiError } from './client.js'

/** Imported only by operations that opt into a documented error map. */
export function createErrorHandler(errors: () => Promise<ErrorMap>) {
  return async (error: unknown): Promise<unknown> => {
    if (error instanceof ApiError && error.data && typeof error.data === 'object') {
      const data = error.data as Record<string, unknown>
      if (typeof data.code === 'string')
        error = new ORPCError(data.code, {
          status: error.response.status,
          message: typeof data.message === 'string' ? data.message : error.message,
          data,
          cause: error,
        })
    }
    if (!(error instanceof ORPCError)) return error
    let map: ErrorMap
    try {
      map = await errors()
    } catch {
      return error
    } // A missing error chunk must not replace the original HTTP failure.
    return validateORPCError(map, error)
  }
}
