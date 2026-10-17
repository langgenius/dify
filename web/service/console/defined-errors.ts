import type { ClientContext } from '@orpc/client'
import type { StandardLinkInterceptorOptions } from '@orpc/client/standard'
import type { RouterContract } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { getRouterContract, ProcedureContract, reconcileORPCError } from '@orpc/contract'

/**
 * Link interceptor that marks a backend error as a defined oRPC error when the procedure's
 * contract documents its `code` and its body matches the documented schema (which pins the
 * HTTP `status`), so callers can narrow it with `isDefinedError`. Undocumented errors stay
 * undefined.
 *
 * A defined error's `data` is the zod-parsed body, so keys outside the documented error body
 * (`code`, `message`, `status`, `params`, `details`) are dropped; read extra legacy keys from
 * an undefined error or document them on the backend error class.
 */
export function validateDefinedErrors<TContext extends ClientContext>(contract: RouterContract) {
  return async ({
    next,
    path,
  }: StandardLinkInterceptorOptions<TContext> & {
    next: () => Promise<unknown>
  }): Promise<unknown> => {
    try {
      return await next()
    } catch (error) {
      if (!(error instanceof ORPCError)) throw error
      const procedure = getRouterContract(contract, path)
      if (!(procedure instanceof ProcedureContract)) throw error
      throw await reconcileORPCError(procedure['~orpc'].errorMap, error)
    }
  }
}
