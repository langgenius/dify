import type {
  experimental_ProcedureUtilsDefaults,
  GeneralUtils,
  ProcedureUtils,
} from '@orpc/tanstack-query'
import type { RuntimeConfig } from './client.js'
import type { OperationDescriptor } from './operation.js'
import type { CallOptions } from './types.js'
import { createGeneralUtils, createProcedureUtils } from '@orpc/tanstack-query'
import { invokeRpcOperation } from './client.js'

type Input = Parameters<typeof invokeRpcOperation>[1]
export function createQueryOperation(
  operation: OperationDescriptor,
  path: string[],
  runtime?: RuntimeConfig,
  defaults?: experimental_ProcedureUtilsDefaults<object, Input, unknown, unknown>,
  validateError?: (error: unknown) => Promise<unknown>,
): ProcedureUtils<object, Input, unknown, unknown> & GeneralUtils<Input> {
  const queryPath = [...(runtime?.queryKeyPrefix ?? []), ...path]
  return {
    ...createGeneralUtils<Input>(queryPath),
    ...createProcedureUtils<object, Input, unknown, unknown>(
      (input: Input, options?: CallOptions) =>
        invokeRpcOperation(operation, input, options, runtime, validateError),
      { path: queryPath, experimental_defaults: defaults },
    ),
  }
}

export function createQueryKey(
  path: string[],
  runtime?: RuntimeConfig,
): GeneralUtils<unknown>['key'] {
  return createGeneralUtils([...(runtime?.queryKeyPrefix ?? []), ...path]).key
}
