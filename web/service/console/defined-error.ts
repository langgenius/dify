import type { AnyContractProcedure, ORPCErrorFromErrorMap } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { validateORPCError } from '@orpc/contract'

/** Narrow only errors that match this operation's code, HTTP status, and schema. */
export async function parseDefinedError<T extends AnyContractProcedure>(
  procedure: T,
  error: unknown,
): Promise<ORPCErrorFromErrorMap<T['~orpc']['errorMap']> | undefined> {
  if (!(error instanceof ORPCError)) return undefined
  const validated = await validateORPCError(procedure['~orpc'].errorMap, error)
  if (!validated.defined) return undefined
  // validateORPCError checks the operation's runtime schemas before this narrowing.
  return validated as ORPCErrorFromErrorMap<T['~orpc']['errorMap']>
}
