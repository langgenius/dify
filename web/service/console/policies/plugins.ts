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
          onSuccess: (response, { body }, _result, { client }) => {
            if (response.result !== 'success') return
            void invalidateQueryKeys(
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
                onSuccess: (_data, { params }, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey(
                      { input: { params: { provider_id: params.provider_id } } },
                    ),
                    consoleQuery.workspaces.current.tools.mcp.get.queryKey(),
                  ])
                },
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
                onSuccess: (_data, variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
                    }),
                  ]),
              },
            },
          },
          update: {
            post: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
                    }),
                  ]),
              },
            },
          },
          oauth: {
            customClient: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) =>
                    Promise.all([
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key(
                            { input: { params: { provider: variables.params.provider } } },
                          ),
                      }),
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.get.key(
                            { input: { params: { provider: variables.params.provider } } },
                          ),
                      }),
                    ]),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) =>
                    Promise.all([
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key(
                            { input: { params: { provider: variables.params.provider } } },
                          ),
                      }),
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.get.key(
                            { input: { params: { provider: variables.params.provider } } },
                          ),
                      }),
                    ]),
                },
              },
            },
          },
          defaultCredential: {
            post: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
                    }),
                  ]),
              },
            },
          },
          delete: {
            post: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key(
                          { input: { params: { provider: variables.params.provider } } },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
                    }),
                  ]),
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
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryKey({
                    input: { query: { category: variables.body.category } },
                  }),
                })
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
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
      },
      disable: {
        post: {
          mutationOptions: {
            onSettled: (_data, _error, _variables, _result, { client }) =>
              invalidateEndpointQueries(consoleQuery, client),
          },
        },
      },
    },
  }
}

function invalidateEndpointQueries(query: ConsoleQuery, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.endpoints.list.key(),
    query.workspaces.current.plugin.list.get.key(),
    query.workspaces.current.plugin.byCategory.list.get.key(),
  ])
}
