import type { QueryClient } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function dataSourceAuthPolicies(
  consoleQuery: ConsoleQuery,
): Pick<ConsolePolicies, 'auth' | 'notion'> {
  return {
    auth: {
      plugin: {
        // Credential writes change the provider's credentials and both data source lists, and
        // each waits for them.
        datasource: {
          list: { get: { queryOptions: { retry: false } } },
          defaultList: { get: { queryOptions: { retry: false } } },
          byProviderId: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
              },
            },
            // The credential editor reopens with the values from the credential list.
            update: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
                },
              },
            },
            customClient: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
                },
              },
            },
            get: { queryOptions: { retry: false } },
            default: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
                },
              },
            },
            delete: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateDataSourceCredentialQueries(consoleQuery, client, params.provider_id),
                },
              },
            },
          },
        },
      },
    },
    notion: {
      pages: {
        byPageId: {
          byPageType: {
            preview: {
              get: {
                queryOptions: {
                  // The preview replaces its content with an inline error and retry, also on a
                  // failed refetch.
                  meta: { errorToast: false },
                  retry: false,
                  staleTime: 0,
                },
              },
            },
          },
        },
      },
    },
  }
}

function invalidateDataSourceCredentialQueries(
  query: ConsoleQuery,
  client: QueryClient,
  providerId: string,
) {
  return invalidateQueryKeys(client, [
    query.auth.plugin.datasource.byProviderId.get.key({
      input: { params: { provider_id: providerId } },
    }),
    query.auth.plugin.datasource.list.get.key(),
    query.auth.plugin.datasource.defaultList.get.key(),
  ])
}
