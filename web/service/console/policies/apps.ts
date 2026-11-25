import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { isDefinedError } from '@orpc/client'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { getHttpErrorStatus } from '@/service/http-error'
import {
  syncAppWorkflowVersionCaches,
  syncWorkflowDeploymentCaches,
} from '../workflow-version-cache'
import { invalidateNetworkAccessGroupQueries, invalidateQueryKeys } from './shared'

export function appPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['apps'] {
  return {
    post: {
      mutationOptions: {
        // Waits for the app list the new app appears in; quota and other lists refresh in the background.
        onSuccess: (_data, _variables, _onMutateResult, context) => {
          void invalidateQueryKeys(context.client, [
            consoleQuery.features.get.key(),
            consoleQuery.apps.starred.get.key(),
            consoleQuery.apps.recent.get.key(),
          ])
          return invalidateQueryKeys(context.client, [consoleQuery.apps.get.key()])
        },
      },
    },
    imports: {
      post: {
        mutationOptions: {
          // Waits for the app list the imported app appears in; quota and other lists refresh in
          // the background.
          onSuccess: (data, variables, _onMutateResult, context) => {
            if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

            const isNewApp = !('app_id' in variables.body) || !variables.body.app_id
            void invalidateQueryKeys(context.client, [
              ...(isNewApp ? [consoleQuery.features.get.key()] : []),
              consoleQuery.apps.starred.get.key(),
              consoleQuery.apps.recent.get.key(),
            ])
            return invalidateQueryKeys(context.client, [consoleQuery.apps.get.key()])
          },
        },
      },
      byImportId: {
        confirm: {
          post: {
            mutationOptions: {
              // Waits for the app list the imported app appears in; quota and other lists
              // refresh in the background.
              onSuccess: (data, _variables, _onMutateResult, context) => {
                if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

                void invalidateQueryKeys(context.client, [
                  consoleQuery.features.get.key(),
                  consoleQuery.apps.starred.get.key(),
                  consoleQuery.apps.recent.get.key(),
                ])
                return invalidateQueryKeys(context.client, [consoleQuery.apps.get.key()])
              },
            },
          },
        },
      },
    },
    byAppId: {
      workflow: {
        comments: {
          // Collaborators change comments while the editor is closed, and their live
          // updates reach only an open editor, so every mount reads comments again. While
          // open, live updates keep them current; a read on window focus could land on an
          // optimistic write.
          get: { queryOptions: { staleTime: 0, refetchOnWindowFocus: false } },
          byCommentId: {
            get: { queryOptions: { staleTime: 0, refetchOnWindowFocus: false } },
            resolve: {
              post: {
                // Resolving shows at once, on the thread and on the canvas: a thread resolved
                // while resolved ones are hidden closes and its marker goes. Reads running for
                // the comment are stopped first, and a failed resolve puts both back.
                mutationOptions: {
                  onMutate: async ({ params }, context) => {
                    await Promise.all([
                      context.client.cancelQueries({
                        queryKey: consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
                          input: { params: { app_id: params.app_id } },
                        }),
                      }),
                      context.client.cancelQueries({
                        queryKey:
                          consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
                            input: { params },
                          }),
                      }),
                    ])
                    setCommentResolved(consoleQuery, context.client, params, {
                      resolved: true,
                    })
                  },
                  onError: (_error, { params }, _result, context) => {
                    setCommentResolved(consoleQuery, context.client, params, {
                      resolved: false,
                    })
                  },
                  onSuccess: (result, { params }, _result, context) => {
                    setCommentResolved(consoleQuery, context.client, params, {
                      resolved: result.resolved,
                      resolved_at: result.resolved_at,
                      resolved_by: result.resolved_by,
                    })
                  },
                },
              },
            },
          },
        },
      },
      // An annotation added from a chat answer can land while the annotation page is
      // still loading its first list, so refreshes cancel that pre-write load. Writes wait
      // for the annotation list and count (their primary source) but not for the quota.
      annotations: {
        byAnnotationId: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, { params }, _result, { client }) => {
                if (error) return
                // Waits for the annotation list and count it edits.
                return invalidateQueryKeys(client, [annotationListKey(consoleQuery, params.app_id)])
              },
            },
          },
          delete: {
            mutationOptions: {
              onSettled: (_data, error, { params }, _result, { client }) => {
                if (error) return
                // Waits for the annotation list and count it changes; the quota refreshes in the
                // background, so adding from a chat answer does not wait for it.
                void invalidateQueryKeys(client, [consoleQuery.features.get.key()])
                return invalidateQueryKeys(client, [annotationListKey(consoleQuery, params.app_id)])
              },
            },
          },
        },
        post: {
          mutationOptions: {
            onSettled: (_data, error, { params }, _result, { client }) => {
              if (error) return
              // Waits for the annotation list and count it changes; the quota refreshes in the
              // background, so adding from a chat answer does not wait for it.
              void invalidateQueryKeys(client, [consoleQuery.features.get.key()])
              return invalidateQueryKeys(client, [annotationListKey(consoleQuery, params.app_id)])
            },
          },
        },
        // Batch delete and clear all free annotation quota, like a single delete.
        delete: {
          mutationOptions: {
            onSettled: (_data, error, { params }, _result, { client }) => {
              if (error) return
              // Waits for the annotation list and count it changes; the quota refreshes in the
              // background, so adding from a chat answer does not wait for it.
              void invalidateQueryKeys(client, [consoleQuery.features.get.key()])
              return invalidateQueryKeys(client, [annotationListKey(consoleQuery, params.app_id)])
            },
          },
        },
      },
      traceRuns: {
        bySourceKind: {
          bySourceId: {
            get: { queryOptions: { context: { silent: true }, retry: false } },
          },
        },
      },
      workflowRuns: {
        tasks: {
          byTaskId: {
            stop: {
              post: {
                mutationOptions: {
                  // A failed response can still follow an accepted stop request. Waits for the
                  // run histories and details the stopped run is read from.
                  onSettled: (_data, _error, variables, _result, context) => {
                    const input = { params: { app_id: variables.params.app_id } }
                    return invalidateQueryKeys(context.client, [
                      consoleQuery.apps.byAppId.workflowRuns.key({ input }),
                      consoleQuery.apps.byAppId.advancedChat.workflowRuns.key({ input }),
                    ])
                  },
                },
              },
            },
          },
        },
      },
      // Tracing reloads run in the background: a saved status is written into the cache, and
      // the provider dialog closes without waiting for the configs to reload.
      trace: {
        post: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              context.client.setQueryData(
                consoleQuery.apps.byAppId.trace.get.queryKey({
                  input: { params: variables.params },
                }),
                {
                  ...variables.body,
                  capture_content: variables.body.capture_content ?? false,
                  capture_agent: variables.body.capture_agent ?? true,
                },
              )
            },
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              const input = { params: variables.params }
              void invalidateQueryKeys(context.client, [
                ...(error ? [consoleQuery.apps.byAppId.traceConfig.get.key({ input })] : []),
                consoleQuery.apps.byAppId.trace.get.queryKey({ input }),
                consoleQuery.apps.byAppId.traceCapabilities.get.key({ input }),
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
                consoleQuery.apps.byAppId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params } }),
                consoleQuery.apps.byAppId.traceConfig.get.queryKey({
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
                consoleQuery.apps.byAppId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params } }),
                consoleQuery.apps.byAppId.traceConfig.get.queryKey({
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
                consoleQuery.apps.byAppId.traceCapabilities.get.key({ input: { params } }),
              ])
              // The provider dialog reopens from this config (and status toggles send the
              // cached status), so the save waits for both reloads.
              return invalidateQueryKeys(context.client, [
                consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params } }),
                consoleQuery.apps.byAppId.traceConfig.get.queryKey({
                  input: { params, query: { tracing_provider: variables.query.tracing_provider } },
                }),
              ])
            },
          },
        },
      },
      server: {
        post: {
          mutationOptions: {
            // Waits for the MCP server it saves.
            onSuccess: (_data, { params }, _result, { client }) =>
              invalidateQueryKeys(client, [
                consoleQuery.apps.byAppId.server.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              ]),
          },
        },
        put: {
          mutationOptions: {
            // Waits for the MCP server it saves.
            onSuccess: (_data, { params }, _result, { client }) =>
              invalidateQueryKeys(client, [
                consoleQuery.apps.byAppId.server.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              ]),
          },
        },
        refresh: {
          post: {
            mutationOptions: {
              onSuccess: (server, { params }, _result, { client }) => {
                const queryKey = consoleQuery.apps.byAppId.server.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                })
                client.setQueryData(queryKey, (previous) =>
                  previous?.id === server.id
                    ? { ...previous, server_code: server.server_code }
                    : server,
                )
                void client.invalidateQueries({ queryKey, exact: true })
              },
            },
          },
        },
      },
      // Shared invalidation uses onSettled so feature-owned onSuccess callbacks can coexist.
      networkAccessGroup: {
        put: {
          mutationOptions: {
            onSuccess: (data, { params }, _result, { client }) => {
              client.setQueryData(
                consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
                (current) => (current ? { ...current, ...data } : current),
              )
            },
            // A version conflict means another write landed first: waits for the app's binding to
            // reload; the group list refreshes in the background.
            onError: (error, { params }, _result, { client }) => {
              if (!isDefinedError(error) || error.code !== 'network_access_version_conflict') return
              void invalidateQueryKeys(client, [
                consoleQuery.workspaces.current.networkAccessGroups.get.queryKey(),
              ])
              return invalidateQueryKeys(client, [
                consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              ])
            },
            // The binding is written above, so the save does not wait for the group lists.
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              void invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
            },
          },
        },
      },
      apiEnable: {
        post: {
          mutationOptions: {
            onSettled: (data, error, variables, _onMutateResult, context) => {
              if (error || !data) return

              context.client.setQueryData<AppDetailWithSite>(
                consoleQuery.apps.byAppId.get.queryKey({ input: { params: variables.params } }),
                (detail) =>
                  detail
                    ? { ...detail, enable_api: data.enable_api, updated_at: data.updated_at }
                    : undefined,
              )

              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: variables.params },
                }),
              })
            },
          },
        },
      },
      delete: {
        mutationOptions: {
          onMutate: ({ params }) => markAppDeletionStarted(params.app_id),
          onError: (_error, { params }) => markAppDeletionFailed(params.app_id),
          onSuccess: (_data, { params }, _onMutateResult, context) => {
            markAppDeletionSucceeded(params.app_id)
            void invalidateQueryKeys(context.client, [
              consoleQuery.features.get.key(),
              consoleQuery.apps.recent.get.key(),
            ])
            // The app list's delete dialog stays open until both lists drop the app, then
            // moves focus to the card next to it.
            return invalidateQueryKeys(context.client, [
              consoleQuery.apps.get.key(),
              consoleQuery.apps.starred.get.key(),
            ])
          },
        },
      },
      put: {
        mutationOptions: {
          onSuccess: (data, variables, _onMutateResult, context) => {
            context.client.setQueryData(
              consoleQuery.apps.byAppId.get.queryKey({
                input: { params: variables.params },
              }),
              data,
            )
            // The detail is written above; waits for the app lists it edits, recent apps refresh
            // in the background.
            void invalidateQueryKeys(context.client, [consoleQuery.apps.recent.get.key()])
            return invalidateQueryKeys(context.client, [
              consoleQuery.apps.get.key(),
              consoleQuery.apps.starred.get.key(),
            ])
          },
        },
      },
      siteEnable: {
        post: {
          mutationOptions: {
            onSettled: (data, error, variables, _onMutateResult, context) => {
              if (error || !data) return

              context.client.setQueryData<AppDetailWithSite>(
                consoleQuery.apps.byAppId.get.queryKey({ input: { params: variables.params } }),
                (detail) =>
                  detail
                    ? { ...detail, enable_site: data.enable_site, updated_at: data.updated_at }
                    : undefined,
              )

              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: variables.params },
                }),
              })
            },
          },
        },
      },
      site: {
        post: {
          mutationOptions: {
            // Waits for the app detail the site settings are read from; app lists refresh in the
            // background.
            onSettled: (_data, error, variables, _onMutateResult, context) => {
              if (error) return
              void invalidateQueryKeys(context.client, [
                consoleQuery.apps.get.key(),
                consoleQuery.apps.starred.get.key(),
                consoleQuery.apps.recent.get.key(),
              ])
              return invalidateQueryKeys(context.client, [
                consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: variables.params },
                }),
              ])
            },
          },
        },
        accessTokenReset: {
          post: {
            mutationOptions: {
              onSettled: (data, error, variables, _onMutateResult, context) => {
                if (error || !data) return

                const { code } = data
                if (code !== undefined) {
                  context.client.setQueryData<AppDetailWithSite>(
                    consoleQuery.apps.byAppId.get.queryKey({
                      input: { params: variables.params },
                    }),
                    (detail) =>
                      detail?.site
                        ? {
                            ...detail,
                            site: { ...detail.site, code, access_token: code },
                          }
                        : detail,
                  )
                }

                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.get.queryKey({
                    input: { params: variables.params },
                  }),
                })
              },
            },
          },
        },
      },
      convertToWorkflow: {
        post: {
          mutationOptions: {
            // Waits for the app list the converted app appears in; other lists refresh in the
            // background.
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              void invalidateQueryKeys(context.client, [
                consoleQuery.apps.starred.get.key(),
                consoleQuery.apps.recent.get.key(),
              ])
              return invalidateQueryKeys(context.client, [consoleQuery.apps.get.key()])
            },
          },
        },
      },
      copy: {
        post: {
          mutationOptions: {
            // Waits for the app list the copy appears in; quota and other lists refresh in the
            // background.
            onSuccess: (data, _variables, _onMutateResult, context) => {
              if (!('mode' in data)) return

              void invalidateQueryKeys(context.client, [
                consoleQuery.features.get.key(),
                consoleQuery.apps.starred.get.key(),
                consoleQuery.apps.recent.get.key(),
              ])
              return invalidateQueryKeys(context.client, [consoleQuery.apps.get.key()])
            },
          },
        },
      },
      // The app card's star toggle shows `is_starred` from these lists and stays disabled
      // until they reload, so it never re-enables showing the old value.
      star: {
        delete: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) =>
              invalidateQueryKeys(context.client, [
                consoleQuery.apps.get.key(),
                consoleQuery.apps.starred.get.key(),
              ]),
          },
        },
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) =>
              invalidateQueryKeys(context.client, [
                consoleQuery.apps.get.key(),
                consoleQuery.apps.starred.get.key(),
              ]),
          },
        },
      },
      // Trigger and MCP toggles keep their pending value until the refreshed state lands.
      triggerEnable: {
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) =>
              client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.triggers.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              }),
          },
        },
      },
      // Waits for the app detail the model config is read from.
      modelConfig: {
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) =>
              invalidateQueryKeys(client, [
                consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              ]),
          },
        },
      },
      workflows: {
        publish: {
          post: {
            mutationOptions: {
              // "Deploy latest" stores the published version from `publish.get` in its
              // flow, so publishing waits for it; the other refreshes run in the background.
              onSuccess: (_data, { params }, _result, { client }) => {
                void invalidateEvaluationDefaultMetrics(consoleQuery, client, params.app_id)
                void invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.workflows.get.key({ input: { params } }),
                  consoleQuery.apps.byAppId.get.key({ input: { params } }),
                  consoleQuery.apps.byAppId.triggers.get.key({ input: { params } }),
                ])
                return invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.workflows.publish.get.key({ input: { params } }),
                ])
              },
            },
          },
          // Same as the default publish: "Deploy latest" and "Edit version" read the published
          // version from `publish.get`, so that one is awaited; the rest refresh in the background.
          evaluation: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
                    consoleQuery.apps.byAppId.triggers.get.key({ input: { params } }),
                    consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
                  ])
                  void invalidateEvaluationDefaultMetrics(consoleQuery, client, params.app_id)
                  return invalidateQueryKeys(client, [
                    consoleQuery.apps.byAppId.workflows.publish.get.key({ input: { params } }),
                  ])
                },
              },
            },
          },
        },
        convertType: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) => {
                void invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.workflows.publish.get.key({ input: { params } }),
                  consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
                ])
                // The publisher's kind switch reads `workflow_kind` from the app detail and
                // stays pending until it reloads, so it cannot re-enable on the old kind.
                return invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
                ])
              },
            },
          },
        },
        byWorkflowId: {
          patch: {
            mutationOptions: {
              onSuccess: (data, variables, _result, context) => {
                syncAppWorkflowVersionCaches(
                  context.client,
                  consoleQuery,
                  variables.params.app_id,
                  data,
                )
                const deploymentsKey = syncWorkflowDeploymentCaches(
                  context.client,
                  consoleQuery,
                  variables.params.app_id,
                  data,
                )
                // The caches above already show the new name, so callers do not wait for reloads.
                const input = { params: { app_id: variables.params.app_id } }
                void invalidateQueryKeys(context.client, [
                  consoleQuery.apps.byAppId.workflows.publish.get.queryKey({ input }),
                  consoleQuery.apps.byAppId.workflows.get.key({ input }),
                  deploymentsKey,
                ])
              },
            },
          },
          delete: {
            mutationOptions: {
              // Reset the version lists so they reload from the first page: the deleted version is gone
              // even if the reload fails, and no stale page can shift the next one. Not awaited, so
              // callers can close their UI as soon as the version is deleted.
              onSuccess: (_data, variables, _result, context) => {
                void context.client.resetQueries({
                  queryKey: consoleQuery.apps.byAppId.workflows.get.key({
                    type: 'infinite',
                    input: { params: { app_id: variables.params.app_id } },
                  }),
                })
              },
            },
          },
        },
        draft: {
          nodes: {
            byNodeId: {
              agentComposer: {
                put: {
                  mutationOptions: {
                    onSuccess: (composerState, variables, _onMutateResult, context) => {
                      context.client.setQueryData(
                        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                          {
                            input: {
                              params: variables.params,
                            },
                          },
                        ),
                        composerState,
                      )
                    },
                  },
                },
                copyFromRoster: {
                  post: {
                    mutationOptions: {
                      onSuccess: (composerState, variables, _onMutateResult, context) => {
                        context.client.setQueryData(
                          consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                            {
                              input: {
                                params: variables.params,
                              },
                            },
                          ),
                          composerState,
                        )
                      },
                    },
                  },
                },
                saveToRoster: {
                  post: {
                    mutationOptions: {
                      // The composer is written from the response; waits for the roster agent
                      // list and the saved agent's detail, invite options refresh in the background.
                      onSuccess: (composerState, variables, _onMutateResult, context) => {
                        context.client.setQueryData(
                          consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                            {
                              input: {
                                params: variables.params,
                              },
                            },
                          ),
                          composerState,
                        )
                        void invalidateQueryKeys(context.client, [
                          consoleQuery.agent.inviteOptions.get.key(),
                        ])

                        const agentId =
                          composerState.binding?.binding_type === 'roster_agent'
                            ? composerState.binding.agent_id
                            : undefined
                        return invalidateQueryKeys(context.client, [
                          consoleQuery.agent.get.key(),
                          ...(agentId
                            ? [
                                consoleQuery.agent.byAgentId.get.queryKey({
                                  input: { params: { agent_id: agentId } },
                                }),
                              ]
                            : []),
                        ])
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    byResourceId: {
      apiKeys: {
        post: {
          mutationOptions: {
            // Waits for the API key list the new key appears in.
            onSuccess: (_data, variables, _onMutateResult, context) =>
              invalidateQueryKeys(context.client, [
                consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
                  input: { params: { resource_id: variables.params.resource_id } },
                }),
              ]),
          },
        },
        byApiKeyId: {
          delete: {
            mutationOptions: {
              // Waits for the API key list it deletes from.
              onSuccess: (_data, variables, _onMutateResult, context) =>
                invalidateQueryKeys(context.client, [
                  consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
                    input: { params: { resource_id: variables.params.resource_id } },
                  }),
                ]),
            },
          },
        },
      },
    },
  }
}

// A comment's resolved state, on its thread and in its app's comment list.
function setCommentResolved(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  params: { app_id: string; comment_id: string },
  fields: { resolved: boolean; resolved_at?: number | null; resolved_by?: string | null },
) {
  client.setQueryData(
    query.apps.byAppId.workflow.comments.byCommentId.get.queryKey({ input: { params } }),
    (detail) => (detail ? { ...detail, ...fields } : detail),
  )
  client.setQueryData(
    query.apps.byAppId.workflow.comments.get.queryKey({
      input: { params: { app_id: params.app_id } },
    }),
    (list) =>
      list
        ? {
            ...list,
            data: list.data.map((comment) =>
              comment.id === params.comment_id
                ? { ...comment, resolved: fields.resolved }
                : comment,
            ),
          }
        : list,
  )
}

function invalidateEvaluationDefaultMetrics(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  appId: string,
) {
  return client.invalidateQueries({
    queryKey: query.byEvaluateTargetType.byEvaluateTargetId.evaluation.defaultMetrics.get.key({
      type: 'query',
      input: { params: { evaluate_target_id: appId, evaluate_target_type: 'apps' } },
    }),
  })
}

function annotationListKey(query: ConsoleQuery, appId: string) {
  return query.apps.byAppId.annotations.key({ input: { params: { app_id: appId } } })
}
