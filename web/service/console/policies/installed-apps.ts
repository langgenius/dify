import type { ConsolePolicies, ConsoleQuery } from './types'
import { isNotFoundError } from '@/service/http-error'
import { installedAppConnectionConfigurationKey } from '../installed-app-connection-key'
import { invalidateQueryKeys } from './shared'

export function installedAppPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['installedApps'] {
  return {
    byInstalledAppId: {
      connections: {
        configuration: {
          put: {
            mutationOptions: {
              onSuccess: async (result, { params, body }, _onMutateResult, { client }) => {
                const query =
                  consoleQuery.installedApps.byInstalledAppId.connections.configuration.get
                const queryKey = installedAppConnectionConfigurationKey(
                  query,
                  { params, query: { conversation_id: body.conversation_id ?? undefined } },
                  body.connection_revision,
                )
                const filters = { queryKey, exact: true }
                if (client.isFetching(filters)) await client.cancelQueries(filters)
                client.setQueryData(queryKey, result)
              },
            },
          },
        },
      },
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
