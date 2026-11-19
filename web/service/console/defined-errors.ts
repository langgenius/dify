import type { ClientContext } from '@orpc/client'
import type { StandardLinkInterceptorOptions } from '@orpc/client/standard'
import type { AnyContractProcedure, AnyContractRouter } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { isContractProcedure, validateORPCError } from '@orpc/contract'

function procedureAt(
  contract: AnyContractRouter,
  path: readonly string[],
): AnyContractProcedure | undefined {
  let node: unknown = contract
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return isContractProcedure(node) ? node : undefined
}

/**
 * Link interceptor that marks a backend error as a defined oRPC error when the procedure's
 * contract documents its `code` for that status (and its body matches), so callers can
 * narrow it with `isDefinedError`. Undocumented errors stay undefined.
 *
 * A defined error's `data` is the zod-parsed body, so keys outside the documented error body
 * (`code`, `message`, `status`, `params`, `details`) are dropped; read extra legacy keys from
 * an undefined error or document them on the backend error class.
 */
export function validateDefinedErrors<TContext extends ClientContext>(contract: AnyContractRouter) {
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
      const procedure = procedureAt(contract, path)
      if (!procedure) throw error
      throw await validateORPCError(procedure['~orpc'].errorMap, error)
    }
  }
}
