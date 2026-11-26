import type { ConsolePolicies, ConsoleQuery } from './types'
import { isNotFoundError } from '@/service/http-error'
import { invalidateQueryKeys } from './shared'

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
          // Waits for the installed app list and the edited app's detail.
          onSuccess: (_response, variables, _onMutateResult, context) =>
            invalidateQueryKeys(context.client, [
              consoleQuery.installedApps.get.key(),
              consoleQuery.installedApps.byInstalledAppId.get.queryKey({
                input: {
                  params: variables.params,
                },
              }),
            ]),
        },
      },
    },
  }
}
