/**
 * Stands in for one console operation inside a fully mocked `@/service/console`
 * module, producing the same key shape the real utilities use.
 */
export const consoleOperationStub = (path: string) => {
  const queryKey = (options?: { input?: unknown }) =>
    [['console', ...path.split('.')], { type: 'query', input: options?.input }] as const
  return {
    key: () => [['console', ...path.split('.')]] as const,
    queryKey,
    queryOptions: (options: { input?: unknown } = {}) => ({
      ...options,
      queryKey: queryKey(options),
    }),
    mutationOptions: (options: object = {}) => ({
      ...options,
      mutationKey: [['console', ...path.split('.')], { type: 'mutation' }],
    }),
  }
}
