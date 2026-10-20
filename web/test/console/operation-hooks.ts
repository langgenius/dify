import type { OperationKeyOptions, OperationType } from '@orpc/tanstack-query'
import { generateOperationKey } from '@orpc/tanstack-query'

// Keep the path prefix aligned with createConsoleQuery in service/console/query-policies.ts.
export const consoleOperationKey = <TType extends OperationType, TInput = unknown>(
  path: string,
  options: OperationKeyOptions<TType, TInput> = {},
) => generateOperationKey(['console', ...path.split('.')], options)

// Seed helpers also run with partial console mocks, so they cannot rely on consoleQuery.
export const consoleQueryKey = (path: string, input?: unknown) =>
  consoleOperationKey(path, { type: 'query', input })

/**
 * Stands in for one console operation inside a fully mocked `@/service/console`
 * module, producing keys with oRPC's own generator.
 */
export const consoleOperationStub = (path: string) => {
  const queryKey = (options?: { input?: unknown }) => consoleQueryKey(path, options?.input)
  return {
    key: () => consoleOperationKey(path),
    queryKey,
    queryOptions: (options: { input?: unknown } = {}) => ({
      ...options,
      queryKey: queryKey(options),
    }),
    mutationOptions: (options: object = {}) => ({
      ...options,
      mutationKey: consoleOperationKey(path, { type: 'mutation' }),
    }),
  }
}
