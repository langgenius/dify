import type { consoleRouterContract } from '@dify/contracts/console'
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
import { loadConsoleContractForSegment } from './contract-loader'

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

/**
 * The defined error `error` is for `procedure`, for calls that do not go through the console
 * link (legacy `service/base` helpers). Its `code` narrows to the codes the contract documents.
 * Prefer `consoleDefinedError`, which finds the procedure by path without importing the contract.
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

type DefinedErrorResolver<TErrorMap extends ErrorMap> = (
  error: unknown,
) => Promise<ORPCErrorFromErrorMap<TErrorMap> | undefined>

/** The console contract as a tree of `toDefinedError` resolvers, one per procedure. */
type DefinedErrorResolvers<TContract> =
  // oxlint-disable-next-line typescript/no-explicit-any -- only the error map parameter matters here
  TContract extends ContractProcedure<any, any, infer TErrorMap, any>
    ? DefinedErrorResolver<TErrorMap>
    : { readonly [TKey in keyof TContract]: DefinedErrorResolvers<TContract[TKey]> }

async function resolveDefinedError(path: readonly string[], error: unknown) {
  if (!(error instanceof ORPCError)) return undefined
  const [segment] = path
  if (!segment) throw new Error('Console contract path is empty.')
  const procedure = procedureAt(await loadConsoleContractForSegment(segment), path)
  if (!procedure) throw new Error(`"${path.join('.')}" is not a console contract procedure.`)
  return toDefinedError(procedure, error)
}

function createDefinedErrorResolvers(path: readonly string[]): unknown {
  return new Proxy((error: unknown) => resolveDefinedError(path, error), {
    get: (_target, key) =>
      typeof key === 'string' ? createDefinedErrorResolvers([...path, key]) : undefined,
  })
}

/**
 * `toDefinedError` addressed like `consoleClient`:
 * `await consoleDefinedError.apps.byAppId.workflows.draft.get(error)` narrows `error` to the
 * codes that operation documents. The contract segment loads on demand, through the same
 * loader as the console link, so it stays out of the caller's bundle.
 */
export const consoleDefinedError = createDefinedErrorResolvers([]) as DefinedErrorResolvers<
  typeof consoleRouterContract
>
