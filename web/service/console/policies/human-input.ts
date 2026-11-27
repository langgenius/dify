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
        // Contact writes wait for the contacts they change.
        contacts: {
          platform: {
            post: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _onMutateResult, context) =>
                  invalidateContactQueries(consoleQuery, context.client, error),
              },
            },
          },
          byContactId: {
            imBindings: {
              put: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    invalidateContactQueries(consoleQuery, context.client),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    invalidateContactQueries(consoleQuery, context.client),
                },
              },
            },
            imOverride: {
              put: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    invalidateContactQueries(consoleQuery, context.client),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    invalidateContactQueries(consoleQuery, context.client),
                },
              },
            },
          },
          external: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) =>
                  invalidateContactQueries(consoleQuery, context.client),
              },
            },
            byContactId: {
              // The contact dialog reopens with the details from these queries, so the edit
              // waits for them.
              patch: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    invalidateHumanInputContactQueries(consoleQuery, context.client),
                },
              },
            },
          },
          remove: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) =>
                  invalidateContactQueries(consoleQuery, context.client),
              },
            },
          },
        },
        imSyncRuns: {
          post: {
            mutationOptions: {
              onSuccess: async (data, _variables, _onMutateResult, context) => {
                const queryKey =
                  consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.get.queryKey()
                if (context.client.isFetching({ queryKey, exact: true }))
                  await context.client.cancelQueries({ queryKey, exact: true })
                context.client.setQueryData(queryKey, data)
                void context.client.resetQueries({
                  queryKey:
                    consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.results.key(),
                })
              },
            },
          },
        },
        // Channel writes wait for the channel list.
        channels: {
          email: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) =>
                  invalidateHumanInputChannelQueries(consoleQuery, context.client),
              },
            },
            byChannelId: {
              put: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _onMutateResult, context) =>
                    invalidateHumanInputChannelQueries(consoleQuery, context.client, error),
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _onMutateResult, context) =>
                    invalidateHumanInputChannelQueries(consoleQuery, context.client, error),
                },
              },
            },
          },
          im: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) =>
                  invalidateHumanInputChannelQueries(consoleQuery, context.client),
              },
            },
            byChannelId: {
              put: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _onMutateResult, context) =>
                    invalidateHumanInputChannelQueries(consoleQuery, context.client, error),
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _onMutateResult, context) =>
                    invalidateHumanInputChannelQueries(consoleQuery, context.client, error),
                },
              },
              replacement: {
                post: {
                  mutationOptions: {
                    onSettled: (_data, error, _variables, _onMutateResult, context) =>
                      invalidateHumanInputChannelQueries(consoleQuery, context.client, error),
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

// The fallback refreshes the rest of human input after a success; after a failure
// (`onSettled`) the option lists refresh here.
function invalidateContactQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  error?: unknown,
) {
  const v2 = query.workspaces.current.humanInput.v2
  if (error)
    void invalidateQueryKeys(client, [
      v2.contactOptions.key(),
      v2.imIdentities.key(),
      v2.organizationCandidates.key(),
    ])
  return invalidateQueryKeys(client, [v2.contacts.key()])
}

function invalidateHumanInputChannelQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  error?: unknown,
) {
  const v2 = query.workspaces.current.humanInput.v2
  if (error) {
    // The contact helper also refreshes IM identities.
    void invalidateHumanInputContactQueries(query, client)
    void invalidateQueryKeys(client, [v2.testChannels.key(), v2.imSyncRuns.key()])
  }
  return invalidateQueryKeys(client, [v2.channels.key()])
}
