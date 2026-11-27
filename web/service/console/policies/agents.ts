import type {
  AgentAppComposerResponse,
  AgentAppPagination,
} from '@dify/contracts/api/console/agent/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus, isNotFoundError } from '@/service/http-error'
import { addCreatedKeyToLists, invalidateQueryKeys } from './shared'

export function agentPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['agent'] {
  return {
    post: {
      mutationOptions: {
        // Waits for the agent list the new agent appears in.
        onSuccess: (_createdAgent, _variables, _onMutateResult, context) =>
          invalidateQueryKeys(context.client, [consoleQuery.agent.get.key()]),
      },
    },
    byAgentId: {
      // Tracing reloads run in the background: a saved status is written into the cache, and
      // the provider dialog closes without waiting for the configs to reload.
      trace: {
        post: {
          mutationOptions: {
            onSuccess: async (data, variables, _result, context) => {
              const queryKey = consoleQuery.agent.byAgentId.trace.get.queryKey({
                input: { params: variables.params },
              })
              if (context.client.isFetching({ queryKey, exact: true }))
                await context.client.cancelQueries({ queryKey, exact: true })
              context.client.setQueryData(queryKey, data)
            },
            // A conflict means another save landed first: reloads what it changed.
            onSettled: (_data, error, variables, _result, context) => {
              if (!error || getHttpErrorStatus(error) !== 409) return
              const input = { params: variables.params }
              void invalidateQueryKeys(context.client, [
                consoleQuery.agent.byAgentId.traceConfig.get.key({ input }),
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
              // After a conflict the fallback does not run; capabilities reload here.
              if (error)
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
              // After a conflict the fallback does not run; capabilities reload here.
              if (error)
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
              // After a conflict the fallback does not run; capabilities reload here.
              if (error)
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
            // Writes the new key into its list, so the one-time secret shows at once.
            onSuccess: async (created, variables, _result, context) => {
              const listKey = consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
                input: { params: { agent_id: variables.params.agent_id } },
              })
              return addCreatedKeyToLists(context.client, listKey, created)
            },
          },
        },
        byApiKeyId: {
          delete: {
            mutationOptions: {
              // Waits for the key list it deletes from.
              onSuccess: (_data, variables, _result, context) =>
                invalidateQueryKeys(context.client, [
                  consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
                    input: { params: { agent_id: variables.params.agent_id } },
                  }),
                ]),
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
            // in.
            onSuccess: async (copiedAgent, _variables, _onMutateResult, context) => {
              const detailKey = consoleQuery.agent.byAgentId.get.queryKey({
                input: { params: { agent_id: copiedAgent.id } },
              })
              if (context.client.isFetching({ queryKey: detailKey, exact: true }))
                await context.client.cancelQueries({ queryKey: detailKey, exact: true })
              context.client.setQueryData(detailKey, copiedAgent)
              return invalidateQueryKeys(context.client, [consoleQuery.agent.get.key()])
            },
          },
        },
      },
      put: {
        mutationOptions: {
          onSuccess: async (updatedAgent, variables, _onMutateResult, context) => {
            const detailKey = consoleQuery.agent.byAgentId.get.queryKey({
              input: { params: { agent_id: variables.params.agent_id } },
            })
            // Reads started before the save must not overwrite what it writes.
            if (
              context.client.isFetching({
                queryKey: consoleQuery.agent.get.key({ type: 'query' }),
              }) ||
              context.client.isFetching({
                queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
              }) ||
              context.client.isFetching({ queryKey: detailKey, exact: true })
            )
              await Promise.all([
                context.client.cancelQueries({
                  queryKey: consoleQuery.agent.get.key({ type: 'query' }),
                }),
                context.client.cancelQueries({
                  queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
                }),
                context.client.cancelQueries({ queryKey: detailKey, exact: true }),
              ])
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
            context.client.setQueryData(detailKey, updatedAgent)
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
            onSuccess: async (buildDraft, { params }, _result, { client }) => {
              const queryKey = consoleQuery.agent.byAgentId.buildDraft.get.queryKey({
                input: { params: { agent_id: params.agent_id } },
              })
              if (client.isFetching({ queryKey, exact: true }))
                await client.cancelQueries({ queryKey, exact: true })
              client.setQueryData(queryKey, buildDraft)
            },
          },
        },
        checkout: {
          post: {
            mutationOptions: {
              onSuccess: async (buildDraft, { params }, _result, { client }) => {
                const queryKey = consoleQuery.agent.byAgentId.buildDraft.get.queryKey({
                  input: { params: { agent_id: params.agent_id } },
                })
                if (client.isFetching({ queryKey, exact: true }))
                  await client.cancelQueries({ queryKey, exact: true })
                client.setQueryData(queryKey, buildDraft)
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
      // The log rating control waits for the logs and messages that show the saved rating.
      feedbacks: {
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              const input = { params: { agent_id: params.agent_id } }
              return invalidateQueryKeys(client, [
                consoleQuery.agent.byAgentId.logs.get.key({ input }),
                consoleQuery.agent.byAgentId.logs.byConversationId.messages.get.key({ input }),
              ])
            },
          },
        },
      },
      debugConversation: {
        refresh: {
          post: {
            mutationOptions: {
              onSuccess: async (conversation, { params }, _result, { client }) => {
                const detailKey = consoleQuery.agent.byAgentId.get.queryKey({
                  input: { params: { agent_id: params.agent_id } },
                })
                if (client.isFetching({ queryKey: detailKey, exact: true }))
                  await client.cancelQueries({ queryKey: detailKey, exact: true })
                client.setQueryData(
                  detailKey,
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
            onSuccess: async (apiAccess, { params, body }, _result, { client }) => {
              const input = { params: { agent_id: params.agent_id } }
              const apiAccessKey = consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input })
              const detailKey = consoleQuery.agent.byAgentId.get.queryKey({ input })
              if (
                client.isFetching({ queryKey: apiAccessKey, exact: true }) ||
                client.isFetching({ queryKey: detailKey, exact: true })
              )
                await Promise.all([
                  client.cancelQueries({ queryKey: apiAccessKey, exact: true }),
                  client.cancelQueries({ queryKey: detailKey, exact: true }),
                ])
              client.setQueryData(apiAccessKey, apiAccess)
              client.setQueryData(
                detailKey,
                (agentDetail) => agentDetail && { ...agentDetail, enable_api: body.enable_api },
              )
            },
          },
        },
      },
      composer: {
        put: {
          mutationOptions: {
            onSuccess: async (composerState, variables, _onMutateResult, context) => {
              const composerKey = consoleQuery.agent.byAgentId.composer.get.queryKey({
                input: { params: { agent_id: variables.params.agent_id } },
              })
              if (context.client.isFetching({ queryKey: composerKey, exact: true }))
                await context.client.cancelQueries({ queryKey: composerKey, exact: true })
              context.client.setQueryData(composerKey, composerState)
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
            onSuccess: async (publishResult, variables, _onMutateResult, context) => {
              const composerKey = consoleQuery.agent.byAgentId.composer.get.queryKey({
                input: { params: { agent_id: variables.params.agent_id } },
              })
              if (context.client.isFetching({ queryKey: composerKey, exact: true }))
                await context.client.cancelQueries({ queryKey: composerKey, exact: true })
              context.client.setQueryData<AgentAppComposerResponse>(
                composerKey,
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
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
              context.client.removeQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
              const input = { params: { agent_id: variables.params.agent_id } }
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
          // The agent's tags lose their usage.
          meta: { alsoInvalidate: ['tags'] },
          onSuccess: async (_data, variables, _onMutateResult, context) => {
            context.client.removeQueries({
              queryKey: consoleQuery.agent.byAgentId.key({
                input: {
                  params: {
                    agent_id: variables.params.agent_id,
                  },
                },
              }),
            })
            // A list read started before the delete must not bring the agent back.
            if (
              context.client.isFetching({
                queryKey: consoleQuery.agent.get.key({ type: 'query' }),
              }) ||
              context.client.isFetching({
                queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
              })
            )
              await Promise.all([
                context.client.cancelQueries({
                  queryKey: consoleQuery.agent.get.key({ type: 'query' }),
                }),
                context.client.cancelQueries({
                  queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
                }),
              ])
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
            // The lists are written above; a background read confirms them.
            context.client.invalidateQueries({
              queryKey: consoleQuery.agent.get.key(),
            })
          },
        },
      },
    },
  }
}
