import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleQuery, WorkspaceCurrentPolicies } from './types'
import { upsertStartedPluginTask } from '../plugin-task-cache'
import { invalidateQueryKeys } from './shared'

export function workspacePluginPolicies(
  consoleQuery: ConsoleQuery,
): Pick<
  WorkspaceCurrentPolicies,
  'modelProviders' | 'defaultModel' | 'toolProvider' | 'plugin' | 'endpoints'
> {
  return {
    // Switching or re-prioritizing credentials changes the provider summaries. The
    // per-model-type lists depend on the provider's supported types, which callers own.
    // Both wait for the provider list; summaries refresh in the background.
    modelProviders: {
      byProvider: {
        preferredProviderType: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) => {
                void client.invalidateQueries({
                  queryKey:
                    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
                      input: { params: { provider: params.provider } },
                    }),
                  exact: true,
                  refetchType: 'none',
                })
                void invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.modelProviders.summary.get.key(),
                ])
                return invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.modelProviders.get.key(),
                ])
              },
            },
          },
        },
        credentials: {
          switch: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.modelProviders.summary.get.key(),
                  ])
                  return invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.modelProviders.get.key(),
                  ])
                },
              },
            },
          },
        },
      },
    },
    defaultModel: {
      post: {
        mutationOptions: {
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
      mcp: {
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
            context: { silent: true },
            retry: false,
          },
        },
      },
      asset: {
        get: {
          queryOptions: { context: { silent: true } },
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
              onSuccess: (response, _variables, _result, context) => {
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
        pkg: {
          post: {
            mutationOptions: {
              onSuccess: (response, _variables, _result, context) => {
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
        github: {
          post: {
            mutationOptions: {
              onSuccess: (response, _variables, _result, context) => {
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
              onSuccess: (response, _variables, _result, context) => {
                upsertStartedPluginTask(consoleQuery, context.client, response)
              },
            },
          },
        },
      },
    },
    // Endpoint writes change the endpoint list and the endpoint counts shown on plugin lists.
    // Each waits for the endpoint list; plugin list counts refresh in the background.
    endpoints: {
      post: {
        mutationOptions: {
          onSettled: (_data, _error, _variables, _result, { client }) =>
            invalidateEndpointQueries(consoleQuery, client),
        },
      },
      byId: {
        patch: {
          mutationOptions: {
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
        delete: {
          mutationOptions: {
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
      },
      enable: {
        post: {
          mutationOptions: {
            // The endpoint switch reads the refreshed list and stays disabled until it lands.
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
      },
      disable: {
        post: {
          mutationOptions: {
            // The endpoint switch reads the refreshed list and stays disabled until it lands.
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
      },
    },
  }
}

// Returns once the endpoint list has refreshed; plugin list counts refresh in the background.
function invalidateEndpointQueries(query: ConsoleQuery, client: QueryClient) {
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
