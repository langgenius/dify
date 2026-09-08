import type {
  AgentAppComposerResponse,
  AgentAppPagination,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData } from '@tanstack/react-query'
import type { ConsoleClient } from './index'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

export function createConsoleQuery(consoleClient: ConsoleClient) {
  const consoleQuery: RouterUtils<ConsoleClient> = createTanstackQueryUtils(consoleClient, {
    path: ['console'],
    experimental_defaults: {
      account: {
        education: {
          get: {
            queryOptions: {
              retry: false,
            },
          },
          post: {
            mutationOptions: {
              onSuccess: (data, _variables, _onMutateResult, context) => {
                if (data.message !== 'success') return

                void context.client.invalidateQueries({
                  queryKey: consoleQuery.account.education.get.key(),
                })
              },
            },
          },
        },
        profile: {
          patch: {
            mutationOptions: {
              onSuccess: async (_data, _variables, _onMutateResult, context) => {
                await context.client.invalidateQueries({
                  queryKey: consoleQuery.account.profile.get.key(),
                })
              },
            },
          },
        },
      },
      apps: {
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

                if (!variables.body.app_id) {
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
                    if (data.status !== 'completed' && data.status !== 'completed-with-warnings')
                      return

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
          // Shared invalidation uses onSettled so feature-owned onSuccess callbacks can coexist.
          apiEnable: {
            post: {
              mutationOptions: {
                onSettled: (_data, error, variables, _onMutateResult, context) => {
                  if (error) return

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
              onSuccess: (_data, _variables, _onMutateResult, context) => {
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
                onSettled: (_data, error, variables, _onMutateResult, context) => {
                  if (error) return

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
            accessTokenReset: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _onMutateResult, context) => {
                    if (error) return

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
          workflows: {
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
      },
      datasets: {
        apiKeys: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.datasets.apiKeys.get.key(),
                })
              },
            },
          },
          byApiKeyId: {
            delete: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.datasets.apiKeys.get.key(),
                  })
                },
              },
            },
          },
        },
      },
      snippets: {
        bySnippetId: {
          workflows: {
            draft: {
              nodes: {
                byNodeId: {
                  agentComposer: {
                    put: {
                      mutationOptions: {
                        onSuccess: (composerState, variables, _onMutateResult, context) => {
                          context.client.setQueryData(
                            consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
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
                              consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
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
                              consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
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
      },
      installedApps: {
        byInstalledAppId: {
          get: {
            queryOptions: {
              retry: (failureCount, error) => {
                if (error instanceof Response && error.status === 404) return false

                return failureCount < 3
              },
            },
          },
          delete: {
            mutationOptions: {
              onSuccess: (_response, variables, _onMutateResult, context) => {
                context.client.removeQueries({
                  queryKey: consoleQuery.installedApps.byInstalledAppId.get.queryKey({
                    input: {
                      params: variables.params,
                    },
                  }),
                })
                context.client.invalidateQueries({
                  queryKey: consoleQuery.installedApps.get.key(),
                })
              },
            },
          },
          patch: {
            mutationOptions: {
              onSuccess: (_response, variables, _onMutateResult, context) => {
                context.client.invalidateQueries({
                  queryKey: consoleQuery.installedApps.get.key(),
                })
                context.client.invalidateQueries({
                  queryKey: consoleQuery.installedApps.byInstalledAppId.get.queryKey({
                    input: {
                      params: variables.params,
                    },
                  }),
                })
              },
            },
          },
        },
      },
      agent: {
        post: {
          mutationOptions: {
            onSuccess: (_createdAgent, _variables, _onMutateResult, context) => {
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.get.key(),
              })
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.inviteOptions.get.key(),
              })
            },
          },
        },
        byAgentId: {
          get: {
            queryOptions: {
              retry: (failureCount, error) => {
                if (error instanceof Response && error.status === 404) return false

                return failureCount < 3
              },
            },
          },
          copy: {
            post: {
              mutationOptions: {
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
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.agent.get.key(),
                  })
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.agent.inviteOptions.get.key(),
                  })
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
                        item.id === updatedAgent.id ? updatedAgent : item,
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
                          item.id === updatedAgent.id ? updatedAgent : item,
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
                          publishResult.draft === undefined
                            ? composerState.draft
                            : publishResult.draft,
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
              },
            },
          },
        },
      },
      apiBasedExtension: {
        post: {
          mutationOptions: {
            onSuccess: (createdExtension, _variables, _onMutateResult, context) => {
              context.client.setQueryData(
                consoleQuery.apiBasedExtension.get.queryKey(),
                (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                  oldExtensions ? [createdExtension, ...oldExtensions] : oldExtensions,
              )
            },
          },
        },
        byId: {
          post: {
            mutationOptions: {
              onSuccess: (updatedExtension, variables, _onMutateResult, context) => {
                context.client.setQueryData(
                  consoleQuery.apiBasedExtension.get.queryKey(),
                  (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                    oldExtensions?.map((extension) =>
                      extension.id === variables.params.id ? updatedExtension : extension,
                    ),
                )
              },
            },
          },
          delete: {
            mutationOptions: {
              onSuccess: (_data, variables, _onMutateResult, context) => {
                context.client.setQueryData(
                  consoleQuery.apiBasedExtension.get.queryKey(),
                  (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
                    oldExtensions?.filter((extension) => extension.id !== variables.params.id),
                )
              },
            },
          },
        },
      },
      tags: {
        post: {
          mutationOptions: {
            onSuccess: (tag, variables, _onMutateResult, context) => {
              context.client.setQueryData(
                consoleQuery.tags.get.queryKey({
                  input: {
                    query: {
                      type: variables.body.type,
                    },
                  },
                }),
                (oldTags: Tag[] | undefined) => (oldTags ? [tag, ...oldTags] : oldTags),
              )
            },
          },
        },
        byTagId: {
          patch: {
            mutationOptions: {
              onSuccess: (updatedTag, variables, _onMutateResult, context) => {
                context.client.setQueriesData(
                  {
                    queryKey: consoleQuery.tags.get.key({ type: 'query' }),
                  },
                  (oldTags: Tag[] | undefined) =>
                    oldTags?.map((tag) => (tag.id === variables.params.tag_id ? updatedTag : tag)),
                )

                if (updatedTag.type !== 'app') return

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
          delete: {
            mutationOptions: {
              onSuccess: (_data, variables, _onMutateResult, context) => {
                const deletedTag = context.client
                  .getQueriesData<Tag[]>({
                    queryKey: consoleQuery.tags.get.key({ type: 'query' }),
                  })
                  .flatMap(([, tags]) => tags ?? [])
                  .find((tag) => tag.id === variables.params.tag_id)

                context.client.setQueriesData(
                  {
                    queryKey: consoleQuery.tags.get.key({ type: 'query' }),
                  },
                  (oldTags: Tag[] | undefined) =>
                    oldTags?.filter((tag) => tag.id !== variables.params.tag_id),
                )

                if (deletedTag?.type !== 'app') return

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
      },
      enterprise: {
        appDeploy: {
          accessService: {
            updateEnvironmentApi: {
              mutationOptions: {
                onSuccess: (updated, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  context.client.setQueryData(
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
                      input: { params: { app_id, environment_id } },
                    }).queryKey,
                    updated,
                  )
                  const list =
                    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
                      {
                        input: { params: { app_id } },
                      },
                    )
                  const detail =
                    consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    )
                  context.client.setQueryData(
                    list.queryKey,
                    (current) =>
                      current && {
                        ...current,
                        environment_deployments: current.environment_deployments.map(
                          (deployment) =>
                            deployment.environment.id === environment_id
                              ? {
                                  ...deployment,
                                  access: { ...deployment.access, enable_api: updated.enabled },
                                }
                              : deployment,
                        ),
                      },
                  )
                  context.client.setQueryData(
                    detail.queryKey,
                    (current) =>
                      current && {
                        ...current,
                        environment_deployment: {
                          ...current.environment_deployment,
                          access: {
                            ...current.environment_deployment.access,
                            enable_api: updated.enabled,
                          },
                        },
                      },
                  )
                  return Promise.all([
                    context.client.invalidateQueries({ queryKey: list.queryKey }),
                    context.client.invalidateQueries({ queryKey: detail.queryKey }),
                  ])
                },
              },
            },
            updateEnvironmentSite: {
              mutationOptions: {
                onSuccess: (updated, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  context.client.setQueryData(
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryOptions(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    ).queryKey,
                    updated,
                  )
                  const list =
                    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
                      {
                        input: { params: { app_id } },
                      },
                    )
                  const detail =
                    consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    )
                  context.client.setQueryData(
                    list.queryKey,
                    (current) =>
                      current && {
                        ...current,
                        environment_deployments: current.environment_deployments.map(
                          (deployment) =>
                            deployment.environment.id === environment_id
                              ? {
                                  ...deployment,
                                  access: { ...deployment.access, enable_site: updated.enabled },
                                }
                              : deployment,
                        ),
                      },
                  )
                  context.client.setQueryData(
                    detail.queryKey,
                    (current) =>
                      current && {
                        ...current,
                        environment_deployment: {
                          ...current.environment_deployment,
                          access: {
                            ...current.environment_deployment.access,
                            enable_site: updated.enabled,
                          },
                        },
                      },
                  )
                  return Promise.all([
                    context.client.invalidateQueries({ queryKey: list.queryKey }),
                    context.client.invalidateQueries({ queryKey: detail.queryKey }),
                  ])
                },
              },
            },
            createEnvironmentApiKey: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
                          {
                            input: { params: { app_id, environment_id } },
                          },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
                          input: { params: { app_id, environment_id } },
                        }),
                    }),
                  ])
                },
              },
            },
            deleteEnvironmentApiKey: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
                          {
                            input: { params: { app_id, environment_id } },
                          },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
                          input: { params: { app_id, environment_id } },
                        }),
                    }),
                  ])
                },
              },
            },
          },
          deploymentService: {
            deployWorkflow: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                          {
                            input: { params: { app_id } },
                          },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                          {
                            input: { params: { app_id, environment_id } },
                          },
                        ),
                    }),
                  ])
                },
              },
            },
            undeployWorkflow: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  const { app_id, environment_id } = variables.params
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                          {
                            input: { params: { app_id } },
                          },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                          {
                            input: { params: { app_id, environment_id } },
                          },
                        ),
                    }),
                    context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey(
                          {
                            input: { params: { app_id } },
                          },
                        ),
                    }),
                  ])
                },
              },
            },
          },
        },
        webAppAuth: {
          updateWebAppWhitelistSubjects: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, context) => {
                void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.starred.get.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.apps.recent.get.key(),
                })

                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.agent.byAgentId.get.key(),
                  }),
                ])
              },
            },
          },
        },
      },
    },
  })

  return consoleQuery
}
