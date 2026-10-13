import type { ClientContext } from '@orpc/client'
import type { StandardLinkInterceptorOptions } from '@orpc/client/standard'
import type {
  AnyContractProcedure,
  AnyContractRouter,
  ContractProcedure,
  ErrorMap,
  ORPCErrorFromErrorMap,
} from '@orpc/contract'
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

/**
 * The defined error `error` is for `procedure`, for calls that do not go through the console
 * link (legacy `service/base` helpers). Its `code` narrows to the codes the contract documents.
 */
export async function toDefinedError<TErrorMap extends ErrorMap>(
  // oxlint-disable-next-line typescript/no-explicit-any -- only the error map parameter matters here
  procedure: ContractProcedure<any, any, TErrorMap, any>,
  error: unknown,
): Promise<ORPCErrorFromErrorMap<TErrorMap> | undefined> {
  if (!(error instanceof ORPCError)) return undefined
  const validated = await validateORPCError(procedure['~orpc'].errorMap, error)
  // validateORPCError only marks an error defined when its code is in the map.
  return validated.defined ? (validated as ORPCErrorFromErrorMap<TErrorMap>) : undefined
}
