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
        onSuccess: (_data, _variables, _onMutateResult, context) => {
          void context.client.invalidateQueries({ queryKey: consoleQuery.features.get.key() })
          void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
          void context.client.invalidateQueries({
            queryKey: consoleQuery.apps.starred.get.key(),
          })
          void context.client.invalidateQueries({
            queryKey: consoleQuery.apps.recent.get.key(),
          })
        },
      },
    },
    imports: {
      post: {
        mutationOptions: {
          onSuccess: (data, variables, _onMutateResult, context) => {
            if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

            if (!('app_id' in variables.body) || !variables.body.app_id) {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.features.get.key(),
              })
            }
            void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.starred.get.key(),
            })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.recent.get.key(),
            })
          },
        },
      },
      byImportId: {
        confirm: {
          post: {
            mutationOptions: {
              onSuccess: (data, _variables, _onMutateResult, context) => {
                if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

                void context.client.invalidateQueries({
                  queryKey: consoleQuery.features.get.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.get.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.starred.get.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.recent.get.key(),
                })
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
      // still loading its first list, so refreshes cancel that pre-write load.
      annotations: {
        byAnnotationId: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, { params }, _result, { client }) => {
                if (error) return
                return invalidateQueryKeys(client, [annotationListKey(consoleQuery, params.app_id)])
              },
            },
          },
          delete: {
            mutationOptions: {
              onSettled: (_data, error, { params }, _result, { client }) => {
                if (error) return
                return invalidateQueryKeys(client, [
                  annotationListKey(consoleQuery, params.app_id),
                  consoleQuery.features.get.key(),
                ])
              },
            },
          },
        },
        post: {
          mutationOptions: {
            onSettled: (_data, error, { params }, _result, { client }) => {
              if (error) return
              return invalidateQueryKeys(client, [
                annotationListKey(consoleQuery, params.app_id),
                consoleQuery.features.get.key(),
              ])
            },
          },
        },
        // Batch delete and clear all free annotation quota, like a single delete.
        delete: {
          mutationOptions: {
            onSettled: (_data, error, { params }, _result, { client }) => {
              if (error) return
              return invalidateQueryKeys(client, [
                annotationListKey(consoleQuery, params.app_id),
                consoleQuery.features.get.key(),
              ])
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
                  // A failed response can still follow an accepted stop request.
                  onSettled: (_data, _error, variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.apps.byAppId.workflowRuns.key({
                          input: { params: { app_id: variables.params.app_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.apps.byAppId.advancedChat.workflowRuns.key({
                          input: { params: { app_id: variables.params.app_id } },
                        }),
                      }),
                    ])
                  },
                },
              },
            },
          },
        },
      },
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
              return Promise.all([
                ...(error
                  ? [
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.apps.byAppId.traceConfig.get.key({
                          input: { params: variables.params },
                        }),
                      }),
                    ]
                  : []),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
                    input: { params: variables.params },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
                    input: { params: variables.params },
                  }),
                }),
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
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
                    input: { params: variables.params },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
                    input: {
                      params: variables.params,
                      query: { tracing_provider: variables.body.tracing_provider },
                    },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
                    input: { params: variables.params },
                  }),
                }),
              ])
            },
          },
        },
        patch: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
                    input: { params: variables.params },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
                    input: {
                      params: variables.params,
                      query: { tracing_provider: variables.body.tracing_provider },
                    },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
                    input: { params: variables.params },
                  }),
                }),
              ])
            },
          },
        },
        delete: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error && getHttpErrorStatus(error) !== 409) return
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
                    input: { params: variables.params },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
                    input: {
                      params: variables.params,
                      query: { tracing_provider: variables.query.tracing_provider },
                    },
                  }),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
                    input: { params: variables.params },
                  }),
                }),
              ])
            },
          },
        },
      },
      server: {
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              void client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.server.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              })
            },
          },
        },
        put: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              void client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.server.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              })
            },
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
            // A version conflict means another write landed first: reload what it changed.
            onError: (error, { params }, _result, { client }) => {
              if (!isDefinedError(error) || error.code !== 'network_access_version_conflict') return
              void invalidateQueryKeys(client, [
                consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
                consoleQuery.workspaces.current.networkAccessGroups.get.queryKey(),
              ])
            },
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
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
            void context.client.invalidateQueries({ queryKey: consoleQuery.features.get.key() })
            return Promise.all([
              context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
              context.client.invalidateQueries({
                queryKey: consoleQuery.apps.starred.get.key(),
              }),
              context.client.invalidateQueries({
                queryKey: consoleQuery.apps.recent.get.key(),
              }),
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
            void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.starred.get.key(),
            })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.recent.get.key(),
            })
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
            onSettled: (_data, error, variables, _onMutateResult, context) => {
              if (error) return
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: variables.params },
                }),
              })
              void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.starred.get.key(),
              })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.recent.get.key(),
              })
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
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.starred.get.key(),
              })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.recent.get.key(),
              })
            },
          },
        },
      },
      copy: {
        post: {
          mutationOptions: {
            onSuccess: (data, _variables, _onMutateResult, context) => {
              if (!('mode' in data)) return

              void context.client.invalidateQueries({
                queryKey: consoleQuery.features.get.key(),
              })
              void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.starred.get.key(),
              })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.recent.get.key(),
              })
            },
          },
        },
      },
      star: {
        delete: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) =>
              Promise.all([
                context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.starred.get.key(),
                }),
              ]),
          },
        },
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) =>
              Promise.all([
                context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.starred.get.key(),
                }),
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
      modelConfig: {
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) =>
              client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: { app_id: params.app_id } },
                }),
              }),
          },
        },
      },
      workflows: {
        publish: {
          post: {
            mutationOptions: {
              onSuccess: (_data, variables, _result, context) => {
                // Evaluation metrics follow the published graph; the publisher does not wait for them.
                void invalidateEvaluationDefaultMetrics(
                  consoleQuery,
                  context.client,
                  variables.params.app_id,
                )
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.apps.byAppId.workflows.publish.get.key({
                      input: { params: variables.params },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.apps.byAppId.workflows.get.key({
                      input: { params: variables.params },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.apps.byAppId.get.key({
                      input: { params: variables.params },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.apps.byAppId.triggers.get.key({
                      input: { params: variables.params },
                    }),
                  }),
                ])
              },
            },
          },
          // Not awaited: the publisher reports the result before the refresh finishes.
          evaluation: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.apps.byAppId.workflows.publish.get.key({ input: { params } }),
                    consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
                    consoleQuery.apps.byAppId.triggers.get.key({ input: { params } }),
                    consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
                  ])
                  void invalidateEvaluationDefaultMetrics(consoleQuery, client, params.app_id)
                },
              },
            },
          },
        },
        convertType: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.workflows.publish.get.key({ input: { params } }),
                  consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
                  consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
                ]),
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
                // Callers do not wait for the published workflow to reload.
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byAppId.workflows.publish.get.queryKey({
                    input: { params: { app_id: variables.params.app_id } },
                  }),
                })
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.apps.byAppId.workflows.get.key({
                      input: { params: { app_id: variables.params.app_id } },
                    }),
                  }),
                  context.client.invalidateQueries({ queryKey: deploymentsKey }),
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
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.agent.get.key(),
                        })
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.agent.inviteOptions.get.key(),
                        })

                        const agentId =
                          composerState.binding?.binding_type === 'roster_agent'
                            ? composerState.binding.agent_id
                            : undefined
                        if (agentId) {
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.agent.byAgentId.get.queryKey({
                              input: {
                                params: {
                                  agent_id: agentId,
                                },
                              },
                            }),
                          })
                        }
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
            onSuccess: (_data, variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
                  input: { params: { resource_id: variables.params.resource_id } },
                }),
              })
            },
          },
        },
        byApiKeyId: {
          delete: {
            mutationOptions: {
              onSuccess: (_data, variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
                    input: { params: { resource_id: variables.params.resource_id } },
                  }),
                })
              },
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
