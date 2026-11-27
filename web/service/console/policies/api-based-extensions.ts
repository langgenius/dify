import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ConsolePolicies, ConsoleQuery } from './types'

export function apiBasedExtensionPolicies(
  consoleQuery: ConsoleQuery,
): ConsolePolicies['apiBasedExtension'] {
  return {
    post: {
      mutationOptions: {
        onSuccess: (createdExtension, _variables, _onMutateResult, context) => {
          context.client.setQueryData(
            consoleQuery.apiBasedExtension.get.queryKey(),
            (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
              oldExtensions ? [createdExtension, ...oldExtensions] : oldExtensions,
          )
        },
      },
    },
    byId: {
      post: {
        mutationOptions: {
          onSuccess: (updatedExtension, variables, _onMutateResult, context) => {
            context.client.setQueryData(
              consoleQuery.apiBasedExtension.get.queryKey(),
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
          onSuccess: (_data, variables, _onMutateResult, context) => {
            context.client.setQueryData(
              consoleQuery.apiBasedExtension.get.queryKey(),
              (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                oldExtensions?.filter((extension) => extension.id !== variables.params.id),
            )
          },
        },
      },
    },
  }
}
