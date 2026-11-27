import type {
  AgentAppComposerResponse,
  AgentAppPagination,
} from '@dify/contracts/api/console/agent/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus, isNotFoundError } from '@/service/http-error'
import { addCreatedKeyToLists, invalidateQueryKeys, refreshAgentTagCatalogs } from './shared'

export function agentPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['agent'] {
  return {
    post: {
      mutationOptions: {
        // Waits for the agent list the new agent appears in; invite options refresh in the background.
        onSuccess: (_createdAgent, _variables, _onMutateResult, context) => {
          void invalidateQueryKeys(context.client, [consoleQuery.agent.inviteOptions.get.key()])
          return invalidateQueryKeys(context.client, [consoleQuery.agent.get.key()])
        },
      },
    },
    byAgentId: {
      // Tracing reloads run in the background: a saved status is written into the cache, and
      // the provider dialog closes without waiting for the configs to reload.
      trace: {
        post: {
          mutationOptions: {
            onSuccess: (data, variables, _result, context) => {
              context.client.setQueryData(
                consoleQuery.agent.byAgentId.trace.get.queryKey({
                  input: { params: variables.params },
                }),
                data,
              )
            },
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              const input = { params: variables.params }
              void invalidateQueryKeys(context.client, [
                ...(error ? [consoleQuery.agent.byAgentId.traceConfig.get.key({ input })] : []),
                consoleQuery.agent.byAgentId.trace.get.queryKey({ input }),
                consoleQuery.agent.byAgentId.traceCapabilities.get.key({ input }),
              ])
            },
          },
        },
      },
      traceConfig: {
        post: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              const { params } = variables
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.trace.get.queryKey({ input: { params } }),
                consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                  input: { params, query: { tracing_provider: variables.body.tracing_provider } },
                }),
              ])
            },
          },
        },
        patch: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              const { params } = variables
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.trace.get.queryKey({ input: { params } }),
                consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                  input: { params, query: { tracing_provider: variables.body.tracing_provider } },
                }),
              ])
            },
          },
        },
        delete: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              const { params } = variables
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.trace.get.queryKey({ input: { params } }),
                consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                  input: { params, query: { tracing_provider: variables.query.tracing_provider } },
                }),
              ])
            },
          },
        },
      },
      apiKeys: {
        post: {
          mutationOptions: {
            // Agent keys use their App's capacity; refresh it after a rejected create.
            onError: (_error, variables, _result, context) => {
              const input = { params: { agent_id: variables.params.agent_id } }
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
              ])
              return invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.apiKeys.get.queryKey({ input }),
              ])
            },
            // Writes the new key into its list, so the one-time secret shows at once; API
            // access refreshes in the background.
            onSuccess: (created, variables, _result, context) => {
              const input = { params: { agent_id: variables.params.agent_id } }
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
              ])
              addCreatedKeyToLists(
                context.client,
                consoleQuery.agent.byAgentId.apiKeys.get.queryKey({ input }),
                created,
              )
            },
          },
        },
        byApiKeyId: {
          delete: {
            mutationOptions: {
              // Waits for the key list it deletes from; API access refreshes in the background.
              onSuccess: (_data, variables, _result, context) => {
                const input = { params: { agent_id: variables.params.agent_id } }
                void invalidateQueryKeys(context.client, [
                  consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
                ])
                return invalidateQueryKeys(context.client, [
                  consoleQuery.agent.byAgentId.apiKeys.get.queryKey({ input }),
                ])
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
      copy: {
        post: {
          mutationOptions: {
            // The copy's detail is written from the response; waits for the agent list it appears
            // in, invite options refresh in the background.
            onSuccess: (copiedAgent, _variables, _onMutateResult, context) => {
              context.client.setQueryData(
                consoleQuery.agent.byAgentId.get.queryKey({
                  input: {
                    params: {
                      agent_id: copiedAgent.id,
                    },
                  },
                }),
                copiedAgent,
              )
              void invalidateQueryKeys(context.client, [consoleQuery.agent.inviteOptions.get.key()])
              return invalidateQueryKeys(context.client, [consoleQuery.agent.get.key()])
            },
          },
        },
      },
      put: {
        mutationOptions: {
          onSuccess: (updatedAgent, variables, _onMutateResult, context) => {
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.agent.get.key({ type: 'query' }),
              },
              (oldList: AgentAppPagination | undefined) => {
                if (!oldList?.data.some((item) => item.id === updatedAgent.id)) return oldList

                return {
                  ...oldList,
                  data: oldList.data.map((item) =>
                    item.id === updatedAgent.id ? { ...item, ...updatedAgent } : item,
                  ),
                }
              },
            )
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
              },
              (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
                if (
                  !oldList?.pages.some((page) =>
                    page.data.some((item) => item.id === updatedAgent.id),
                  )
                )
                  return oldList

                return {
                  ...oldList,
                  pages: oldList.pages.map((page) => ({
                    ...page,
                    data: page.data.map((item) =>
                      item.id === updatedAgent.id ? { ...item, ...updatedAgent } : item,
                    ),
                  })),
                }
              },
            )
            context.client.setQueryData(
              consoleQuery.agent.byAgentId.get.queryKey({
                input: {
                  params: {
                    agent_id: variables.params.agent_id,
                  },
                },
              }),
              updatedAgent,
            )
            context.client.invalidateQueries({
              queryKey: consoleQuery.agent.inviteOptions.get.key(),
            })
          },
        },
      },
      // Restoring rewrites the agent's config. `AgentVersionRestore` rebases the editor
      // in its per-call success callback, so the agent and composer reloads stay awaited.
      versions: {
        byVersionId: {
          restore: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const input = { params: { agent_id: params.agent_id } }
                  void invalidateQueryKeys(client, [
                    consoleQuery.agent.byAgentId.versions.get.key({ input }),
                  ])
                  return invalidateQueryKeys(client, [
                    consoleQuery.agent.byAgentId.get.queryKey({ input }),
                    consoleQuery.agent.byAgentId.composer.get.queryKey({ input }),
                  ])
                },
              },
            },
          },
        },
      },
      buildDraft: {
        put: {
          mutationOptions: {
            onSuccess: (buildDraft, { params }, _result, { client }) => {
              client.setQueryData(
                consoleQuery.agent.byAgentId.buildDraft.get.queryKey({
                  input: { params: { agent_id: params.agent_id } },
                }),
                buildDraft,
              )
            },
          },
        },
        checkout: {
          post: {
            mutationOptions: {
              onSuccess: (buildDraft, { params }, _result, { client }) => {
                client.setQueryData(
                  consoleQuery.agent.byAgentId.buildDraft.get.queryKey({
                    input: { params: { agent_id: params.agent_id } },
                  }),
                  buildDraft,
                )
              },
            },
          },
        },
        // Applying the build draft rewrites the agent: waits for its detail and the agent list.
        apply: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.agent.byAgentId.get.queryKey({
                    input: { params: { agent_id: params.agent_id } },
                  }),
                  consoleQuery.agent.get.key(),
                ]),
            },
          },
        },
      },
      debugConversation: {
        refresh: {
          post: {
            mutationOptions: {
              onSuccess: (conversation, { params }, _result, { client }) => {
                client.setQueryData(
                  consoleQuery.agent.byAgentId.get.queryKey({
                    input: { params: { agent_id: params.agent_id } },
                  }),
                  (agentDetail) =>
                    agentDetail && {
                      ...agentDetail,
                      debug_conversation_id: conversation.debug_conversation_id,
                      debug_conversation_has_messages:
                        conversation.debug_conversation_has_messages ?? false,
                      debug_conversation_message_count:
                        conversation.debug_conversation_message_count ?? 0,
                    },
                )
              },
            },
          },
        },
      },
      apiEnable: {
        post: {
          mutationOptions: {
            onSuccess: (apiAccess, { params, body }, _result, { client }) => {
              const input = { params: { agent_id: params.agent_id } }
              client.setQueryData(
                consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
                apiAccess,
              )
              client.setQueryData(
                consoleQuery.agent.byAgentId.get.queryKey({ input }),
                (agentDetail) => agentDetail && { ...agentDetail, enable_api: body.enable_api },
              )
            },
          },
        },
      },
      composer: {
        put: {
          mutationOptions: {
            onSuccess: (composerState, variables, _onMutateResult, context) => {
              context.client.setQueryData(
                consoleQuery.agent.byAgentId.composer.get.queryKey({
                  input: {
                    params: {
                      agent_id: variables.params.agent_id,
                    },
                  },
                }),
                composerState,
              )
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.get.key(),
              })
              if (variables.body.save_strategy !== 'save_as_new_version') return

              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
              context.client.removeQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
            },
          },
        },
      },
      publish: {
        post: {
          mutationOptions: {
            onSuccess: (publishResult, variables, _onMutateResult, context) => {
              context.client.setQueryData<AgentAppComposerResponse>(
                consoleQuery.agent.byAgentId.composer.get.queryKey({
                  input: {
                    params: {
                      agent_id: variables.params.agent_id,
                    },
                  },
                }),
                (composerState) => {
                  if (!composerState) return composerState

                  return {
                    ...composerState,
                    active_config_is_published: true,
                    active_config_snapshot: publishResult.active_config_snapshot,
                    agent: {
                      ...composerState.agent,
                      active_config_snapshot_id: publishResult.active_config_snapshot_id,
                    },
                    draft:
                      publishResult.draft === undefined ? composerState.draft : publishResult.draft,
                  }
                },
              )
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.get.key(),
              })
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
              context.client.removeQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
              const input = { params: { agent_id: variables.params.agent_id } }
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.versions.get.key({ input }),
                consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
              ])
              // The publish bar's success panel links the web app from the reloaded detail.
              return invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.get.queryKey({ input }),
              ])
            },
          },
        },
      },
      delete: {
        mutationOptions: {
          onSuccess: (_data, variables, _onMutateResult, context) => {
            context.client.removeQueries({
              queryKey: consoleQuery.agent.byAgentId.key({
                input: {
                  params: {
                    agent_id: variables.params.agent_id,
                  },
                },
              }),
            })
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.agent.get.key({ type: 'query' }),
              },
              (oldList: AgentAppPagination | undefined) => {
                if (!oldList?.data.some((item) => item.id === variables.params.agent_id))
                  return oldList

                return {
                  ...oldList,
                  data: oldList.data.filter((item) => item.id !== variables.params.agent_id),
                  total: Math.max(0, oldList.total - 1),
                }
              },
            )
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
              },
              (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
                if (
                  !oldList?.pages.some((page) =>
                    page.data.some((item) => item.id === variables.params.agent_id),
                  )
                )
                  return oldList

                return {
                  ...oldList,
                  pages: oldList.pages.map((page) => {
                    const total = Math.max(0, page.total - 1)

                    return {
                      ...page,
                      data: page.data.filter((item) => item.id !== variables.params.agent_id),
                      has_more: page.page * page.limit < total,
                      total,
                    }
                  }),
                }
              },
            )
            context.client.invalidateQueries({
              queryKey: consoleQuery.agent.get.key(),
            })
            context.client.invalidateQueries({
              queryKey: consoleQuery.agent.inviteOptions.get.key(),
            })
            void refreshAgentTagCatalogs(consoleQuery, context.client)
          },
        },
      },
    },
  }
}
