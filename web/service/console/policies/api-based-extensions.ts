import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ConsolePolicies, ConsoleQuery } from './types'

export function apiBasedExtensionPolicies(
  consoleQuery: ConsoleQuery,
): ConsolePolicies['apiBasedExtension'] {
  return {
    post: {
      mutationOptions: {
        onSuccess: async (createdExtension, _variables, _onMutateResult, context) => {
          const queryKey = consoleQuery.apiBasedExtension.get.queryKey()
          if (context.client.isFetching({ queryKey, exact: true }))
            await context.client.cancelQueries({ queryKey, exact: true })
          context.client.setQueryData(
            queryKey,
            (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
              oldExtensions ? [createdExtension, ...oldExtensions] : oldExtensions,
          )
        },
      },
    },
    byId: {
      post: {
        mutationOptions: {
          onSuccess: async (updatedExtension, variables, _onMutateResult, context) => {
            const queryKey = consoleQuery.apiBasedExtension.get.queryKey()
            if (context.client.isFetching({ queryKey, exact: true }))
              await context.client.cancelQueries({ queryKey, exact: true })
            context.client.setQueryData(
              queryKey,
              (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                oldExtensions?.map((extension) =>
                  extension.id === variables.params.id ? updatedExtension : extension,
                ),
            )
          },
        },
      },
      delete: {
        mutationOptions: {
          onSuccess: async (_data, variables, _onMutateResult, context) => {
            const queryKey = consoleQuery.apiBasedExtension.get.queryKey()
            if (context.client.isFetching({ queryKey, exact: true }))
              await context.client.cancelQueries({ queryKey, exact: true })
            context.client.setQueryData(
              queryKey,
              (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                oldExtensions?.filter((extension) => extension.id !== variables.params.id),
            )
          },
        },
      },
    },
  }
}
