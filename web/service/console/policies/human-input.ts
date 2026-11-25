import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsoleQuery, WorkspaceCurrentPolicies } from './types'
import { invalidateHumanInputContactQueries, invalidateQueryKeys } from './shared'

export function humanInputPolicies(
  consoleQuery: ConsoleQuery,
): Pick<WorkspaceCurrentPolicies, 'humanInput'> {
  return {
    humanInput: {
      v2: {
        contacts: {
          platform: {
            post: {
              mutationOptions: {
                onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                  void invalidateHumanInputContactQueries(consoleQuery, context.client)
                },
              },
            },
          },
          byContactId: {
            imBindings: {
              put: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
            },
            imOverride: {
              put: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
            },
          },
          external: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void invalidateHumanInputContactQueries(consoleQuery, context.client)
                },
              },
            },
            byContactId: {
              patch: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
            },
          },
          remove: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void invalidateHumanInputContactQueries(consoleQuery, context.client)
                },
              },
            },
          },
        },
        imSyncRuns: {
          post: {
            mutationOptions: {
              onSuccess: (data, _variables, _onMutateResult, context) => {
                context.client.setQueryData(
                  consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.get.queryKey(),
                  data,
                )
                void context.client.resetQueries({
                  queryKey:
                    consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.results.key(),
                })
              },
            },
          },
        },
        channels: {
          email: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                },
              },
            },
            byChannelId: {
              put: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                  },
                },
              },
            },
          },
          im: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                },
              },
            },
            byChannelId: {
              put: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                    void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                  },
                },
              },
              replacement: {
                post: {
                  mutationOptions: {
                    onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                      void invalidateHumanInputChannelQueries(consoleQuery, context.client)
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}

function invalidateHumanInputChannelQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return Promise.all([
    invalidateHumanInputContactQueries(query, client),
    invalidateQueryKeys(client, [
      query.workspaces.current.humanInput.v2.channels.key(),
      query.workspaces.current.humanInput.v2.testChannels.key(),
      query.workspaces.current.humanInput.v2.imIdentities.key(),
      query.workspaces.current.humanInput.v2.imSyncRuns.key(),
    ]),
  ])
}
