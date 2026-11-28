import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleQuery, WorkspaceCurrentPolicies } from './types'
import { pluginTaskListInput, upsertStartedPluginTask } from '../plugin-task-cache'
import { invalidateQueryKeys } from './shared'

// MCP edits and deletes report a refused write in the body as `result: 'error'`.
const isSuccessResult = (data: unknown) =>
  typeof data === 'object' && data !== null && 'result' in data && data.result === 'success'

// Model selectors list models by type, with their providers' status.
const modelTypeLists = 'workspaces.current.models.modelTypes'

// Plugin lists show each plugin's endpoint counts.
const endpointCountReaders = [
  'workspaces.current.plugin.list.get',
  'workspaces.current.plugin.byCategory.list.get',
]

export function workspacePluginPolicies(
  consoleQuery: ConsoleQuery,
): Pick<
  WorkspaceCurrentPolicies,
  'modelProviders' | 'defaultModel' | 'toolProvider' | 'plugin' | 'endpoints'
> {
  const refreshMCPLists = (client: QueryClient) =>
    invalidateQueryKeys(client, [
      consoleQuery.workspaces.current.toolProviders.get.key(),
      consoleQuery.workspaces.current.tools.mcp.get.key(),
    ])

  return {
    // Switching or re-prioritizing credentials changes the provider summaries and the
    // per-model-type lists. Both wait for the provider list.
    modelProviders: {
      byProvider: {
        preferredProviderType: {
          post: {
            mutationOptions: {
              meta: { alsoInvalidate: [modelTypeLists] },
              onSuccess: (_data, _variables, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.modelProviders.get.key(),
                ]),
            },
          },
        },
        credentials: {
          switch: {
            post: {
              mutationOptions: {
                meta: { alsoInvalidate: [modelTypeLists] },
                onSuccess: (_data, _variables, _result, { client }) =>
                  invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.modelProviders.get.key(),
                  ]),
              },
            },
          },
        },
        models: {
          enable: { patch: { mutationOptions: { meta: { alsoInvalidate: [modelTypeLists] } } } },
          disable: { patch: { mutationOptions: { meta: { alsoInvalidate: [modelTypeLists] } } } },
        },
      },
    },
    defaultModel: {
      post: {
        mutationOptions: {
          meta: { alsoInvalidate: [modelTypeLists] },
          // Waits for the saved model types' defaults.
          onSuccess: (response, { body }, _result, { client }) => {
            if (response.result !== 'success') return
            return invalidateQueryKeys(
              client,
              body.model_settings.map(({ model_type }) =>
                consoleQuery.workspaces.current.defaultModel.get.queryKey({
                  input: { query: { model_type } },
                }),
              ),
            )
          },
        },
      },
    },
    toolProvider: {
      // The MCP list opens the created or edited provider by its id, so writes wait for the
      // catalogs that list it. Edits and deletes report a refused write as `result: 'error'`.
      mcp: {
        post: {
          mutationOptions: { onSuccess: (_d, _v, _r, { client }) => refreshMCPLists(client) },
        },
        put: {
          mutationOptions: {
            onSuccess: (data, _v, _r, { client }) =>
              isSuccessResult(data) ? refreshMCPLists(client) : undefined,
          },
        },
        delete: {
          mutationOptions: {
            onSuccess: (data, _v, _r, { client }) =>
              isSuccessResult(data) ? refreshMCPLists(client) : undefined,
          },
        },
        update: {
          byProviderId: {
            get: {
              mutationOptions: {
                // Waits for the provider's tools and the MCP provider list it appears in.
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey(
                      { input: { params: { provider_id: params.provider_id } } },
                    ),
                    consoleQuery.workspaces.current.tools.mcp.get.queryKey(),
                  ]),
              },
            },
          },
        },
      },
      builtin: {
        byProvider: {
          add: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateBuiltinCredentialQueries(consoleQuery, client, params.provider),
              },
            },
          },
          // The credential editor reopens with the values from these lists, so every
          // credential write waits for them; otherwise a quick reopen saves the old values back.
          update: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateBuiltinCredentialQueries(consoleQuery, client, params.provider),
              },
            },
          },
          oauth: {
            // Waits for the OAuth client settings it writes.
            customClient: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateBuiltinOAuthClientQueries(consoleQuery, client, params.provider),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateBuiltinOAuthClientQueries(consoleQuery, client, params.provider),
                },
              },
            },
          },
          defaultCredential: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateBuiltinCredentialQueries(consoleQuery, client, params.provider),
              },
            },
          },
          delete: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateBuiltinCredentialQueries(consoleQuery, client, params.provider),
              },
            },
          },
        },
      },
    },
    plugin: {
      readme: {
        get: {
          queryOptions: {
            meta: { errorToast: false },
            retry: false,
          },
        },
      },
      asset: {
        get: {
          // README images fall back to the URL in the markdown.
          queryOptions: { meta: { errorToast: false } },
        },
      },
      autoUpgrade: {
        fetch: {
          get: {
            queryOptions: { staleTime: 60 * 1000 },
          },
        },
        exclude: {
          post: {
            mutationOptions: {
              // Waits for the category's auto-upgrade settings.
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                return invalidateQueryKeys(context.client, [
                  consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryKey({
                    input: { query: { category: variables.body.category } },
                  }),
                ])
              },
            },
          },
        },
      },
      install: {
        marketplace: {
          post: {
            mutationOptions: {
              onSuccess: async (response, _variables, _result, context) => {
                if (response.task)
                  if (
                    context.client.isFetching({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                  )
                    await context.client.cancelQueries({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
        pkg: {
          post: {
            mutationOptions: {
              onSuccess: async (response, _variables, _result, context) => {
                if (response.task)
                  if (
                    context.client.isFetching({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                  )
                    await context.client.cancelQueries({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
        github: {
          post: {
            mutationOptions: {
              onSuccess: async (response, _variables, _result, context) => {
                if (response.task)
                  if (
                    context.client.isFetching({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                  )
                    await context.client.cancelQueries({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
      },
      upgrade: {
        marketplace: {
          post: {
            mutationOptions: {
              onSuccess: async (response, _variables, _result, context) => {
                if (response.task)
                  if (
                    context.client.isFetching({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                  )
                    await context.client.cancelQueries({
                      queryKey: pluginTaskListKey(consoleQuery),
                      exact: true,
                    })
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
      },
    },
    // Endpoint writes change the endpoint list and the endpoint counts shown on plugin lists.
    // Each waits for the endpoint list, also after a failure.
    endpoints: {
      post: {
        mutationOptions: {
          meta: { alsoInvalidate: endpointCountReaders },
          onSettled: (_data, error, _variables, _result, { client }) =>
            invalidateEndpointQueries(consoleQuery, client, error),
        },
      },
      byId: {
        patch: {
          mutationOptions: {
            meta: { alsoInvalidate: endpointCountReaders },
            onSettled: (_data, error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client, error),
          },
        },
        delete: {
          mutationOptions: {
            meta: { alsoInvalidate: endpointCountReaders },
            onSettled: (_data, error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client, error),
          },
        },
      },
      enable: {
        post: {
          mutationOptions: {
            meta: { alsoInvalidate: endpointCountReaders },
            // The endpoint switch reads the refreshed list and stays disabled until it lands.
            onSettled: (_data, error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client, error),
          },
        },
      },
      disable: {
        post: {
          mutationOptions: {
            meta: { alsoInvalidate: endpointCountReaders },
            // The endpoint switch reads the refreshed list and stays disabled until it lands.
            onSettled: (_data, error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client, error),
          },
        },
      },
    },
  }
}

// Returns once the endpoint list has refreshed. The fallback refreshes plugin counts after a
// success; after a failure they refresh here.
function invalidateEndpointQueries(query: ConsoleQuery, client: QueryClient, error: unknown) {
  if (error)
    void invalidateQueryKeys(client, [
      query.workspaces.current.plugin.list.get.key(),
      query.workspaces.current.plugin.byCategory.list.get.key(),
    ])
  return invalidateQueryKeys(client, [query.workspaces.current.endpoints.list.key()])
}

function invalidateBuiltinCredentialQueries(
  query: ConsoleQuery,
  client: QueryClient,
  provider: string,
) {
  const input = { input: { params: { provider } } }
  const builtin = query.workspaces.current.toolProvider.builtin.byProvider
  return invalidateQueryKeys(client, [
    builtin.credential.info.get.key(input),
    builtin.credentials.get.key(input),
    query.workspaces.current.tools.builtin.get.key(),
  ])
}

function invalidateBuiltinOAuthClientQueries(
  query: ConsoleQuery,
  client: QueryClient,
  provider: string,
) {
  const input = { input: { params: { provider } } }
  const oauth = query.workspaces.current.toolProvider.builtin.byProvider.oauth
  return invalidateQueryKeys(client, [
    oauth.clientSchema.get.key(input),
    oauth.customClient.get.key(input),
  ])
}

// The task list a started install or upgrade is written into.
function pluginTaskListKey(query: ConsoleQuery) {
  return query.workspaces.current.plugin.tasks.get.queryKey({ input: pluginTaskListInput })
}
