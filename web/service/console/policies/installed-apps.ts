import type { ConsolePolicies, ConsoleQuery } from './types'
import { isNotFoundError } from '@/service/http-error'

export function installedAppPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['installedApps'] {
  return {
    byInstalledAppId: {
      get: {
        queryOptions: {
          retry: (failureCount, error) => {
            if (isNotFoundError(error)) return false

            return failureCount < 3
          },
        },
      },
      patch: {
        mutationOptions: {
          onSuccess: (_response, variables, _onMutateResult, context) => {
            context.client.invalidateQueries({
              queryKey: consoleQuery.installedApps.get.key(),
            })
            context.client.invalidateQueries({
              queryKey: consoleQuery.installedApps.byInstalledAppId.get.queryKey({
                input: {
                  params: variables.params,
                },
              }),
            })
          },
        },
      },
    },
  }
}
