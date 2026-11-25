import type {
  AgentAppComposerResponse,
  AgentAppPagination,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type {
  DatasetListResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type {
  KnowledgeFsGoldenQuestionListResponse,
  KnowledgeFsSpaceListResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ResourceAccessTokenListResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import type {
  AccountWithRoleListResponse,
  RbacRoleList,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from './index'
import { isDefinedError } from '@orpc/client'
import { noop } from 'es-toolkit/function'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { getHttpErrorStatus, isNotFoundError } from '@/service/http-error'
import { createPolicyQueryUtils } from './mutation-policies'
import { upsertStartedPluginTask } from './plugin-task-cache'
import { setSkillDetailCache } from './skill-cache'
import {
  syncAppWorkflowVersionCaches,
  syncWorkflowDeploymentCaches,
} from './workflow-version-cache'

async function refreshRejectedPersonalToken(
  error: unknown,
  client: QueryClient,
  tokenId: string,
  query: RouterUtils<ConsoleClient>,
) {
  const status = getHttpErrorStatus(error)
  if (status !== 403 && status !== 404 && status !== 409) return
  await Promise.all([
    client.invalidateQueries({ queryKey: query.account.personalAccessTokens.get.key() }),
    client.invalidateQueries({
      queryKey: query.account.personalAccessTokens.byTokenId.get.queryKey({
        input: { params: { token_id: tokenId } },
      }),
    }),
  ])
}

export function createConsoleQuery(consoleClient: ConsoleClient) {
  const consoleQuery: RouterUtils<ConsoleClient> = createPolicyQueryUtils(consoleClient, {
    path: ['console'],
    experimental_defaults: {
      workflowRunArchives: {
        downloads: {
          post: {
            mutationOptions: {
              onSuccess: (task, _variables, _onMutateResult, context) => {
                context.client.setQueryData(
                  consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryKey({
                    input: { params: { download_id: task.download_id } },
                  }),
                  task,
                )
              },
            },
          },
        },
        byYear: {
          byMonth: {
            delete: {
              mutationOptions: {
                onSuccess: (task, _variables, _onMutateResult, context) => {
                  const queryKey = consoleQuery.workflowRunArchives.get.queryKey()
                  const deletionStatus = task.status
                  context.client.setQueryData<GetWorkflowRunArchivesResponse>(queryKey, (data) => {
                    if (!data) return data

                    if (deletionStatus === 'completed') {
                      const months = data.months.filter(
                        (archive) => archive.year !== task.year || archive.month !== task.month,
                      )
                      return {
                        months,
                        summary: {
                          archived_month_count: months.length,
                          workflow_run_count: months.reduce(
                            (count, archive) => count + archive.workflow_run_count,
                            0,
                          ),
                          archive_bytes: months.reduce(
                            (bytes, archive) => bytes + archive.archive_bytes,
                            0,
                          ),
                          latest_archived_at: months.reduce<string | null>(
                            (latest, archive) =>
                              archive.latest_archived_at &&
                              (!latest || archive.latest_archived_at > latest)
                                ? archive.latest_archived_at
                                : latest,
                            null,
                          ),
                        },
                      }
                    }

                    return {
                      ...data,
                      months: data.months.map((archive) =>
                        archive.year === task.year && archive.month === task.month
                          ? { ...archive, deletion_status: deletionStatus }
                          : archive,
                      ),
                    }
                  })
                },
                onSettled: (_data, _error, _variables, _onMutateResult, context) => {
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
                  })
                },
              },
            },
          },
        },
      },
      auth: {
        plugin: {
          datasource: {
            list: { get: { queryOptions: { retry: false } } },
            defaultList: { get: { queryOptions: { retry: false } } },
            byProviderId: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) =>
                    Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                          input: { params: { provider_id: variables.params.provider_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
                      }),
                    ]),
                },
              },
              update: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) =>
                      Promise.all([
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                            input: { params: { provider_id: variables.params.provider_id } },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
                        }),
                      ]),
                  },
                },
              },
              customClient: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) =>
                      Promise.all([
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                            input: { params: { provider_id: variables.params.provider_id } },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
                        }),
                      ]),
                  },
                },
                delete: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) =>
                      Promise.all([
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                            input: { params: { provider_id: variables.params.provider_id } },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
                        }),
                      ]),
                  },
                },
              },
              get: { queryOptions: { retry: false } },
              default: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) =>
                      Promise.all([
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                            input: { params: { provider_id: variables.params.provider_id } },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
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
                          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
                            input: { params: { provider_id: variables.params.provider_id } },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
                        }),
                      ]),
                  },
                },
              },
            },
          },
        },
      },
      notion: {
        pages: {
          byPageId: {
            byPageType: {
              preview: {
                get: {
                  queryOptions: {
                    context: { silent: true },
                    retry: false,
                    staleTime: 0,
                  },
                },
              },
            },
          },
        },
      },
      rag: {
        pipeline: {
          templates: {
            byTemplateId: { get: { queryOptions: { staleTime: 0 } } },
          },
          customized: {
            templates: {
              byTemplateId: {
                patch: {
                  mutationOptions: {
                    onSuccess: (_data, _variables, _result, { client }) => {
                      void client.invalidateQueries({
                        queryKey: customizedPipelineTemplatesKey(consoleQuery),
                      })
                    },
                  },
                },
                delete: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) => {
                      const queryKey = customizedPipelineTemplatesKey(consoleQuery)
                      client.setQueryData(
                        queryKey,
                        (current) =>
                          current && {
                            ...current,
                            pipeline_templates: current.pipeline_templates.filter(
                              (template) => template.id !== params.template_id,
                            ),
                          },
                      )
                      void client.invalidateQueries({ queryKey, exact: true })
                    },
                  },
                },
              },
            },
          },
          // A new pipeline dataset joins the dataset list.
          emptyDataset: {
            post: {
              mutationOptions: {
                onSuccess: (data, _variables, _result, { client }) => {
                  if (!data) return
                  void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                },
              },
            },
          },
          dataset: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) => {
                  void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                },
              },
            },
          },
        },
        pipelines: {
          transform: {
            datasets: {
              byDatasetId: {
                post: {
                  mutationOptions: {
                    onSuccess: (data, { params }, _result, { client }) => {
                      if (data.status !== 'success') return
                      void client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.get.queryKey({
                          input: { params: { dataset_id: params.dataset_id } },
                        }),
                      })
                    },
                  },
                },
              },
            },
          },
          datasourcePlugins: {
            get: {
              queryOptions: { staleTime: 0, retry: false },
            },
          },
          // DSL import failures are reported by the import flow.
          imports: {
            post: { mutationOptions: { context: { silent: true } } },
            byImportId: {
              confirm: { post: { mutationOptions: { context: { silent: true } } } },
            },
          },
          byPipelineId: {
            customized: {
              publish: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, _variables, _result, { client }) => {
                      void client.invalidateQueries({
                        queryKey: customizedPipelineTemplatesKey(consoleQuery),
                      })
                    },
                  },
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
                          return context.client.invalidateQueries({
                            queryKey: consoleQuery.rag.pipelines.byPipelineId.workflowRuns.key({
                              input: { params: { pipeline_id: variables.params.pipeline_id } },
                            }),
                          })
                        },
                      },
                    },
                  },
                },
              },
            },
            workflows: {
              publish: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) =>
                      Promise.all([
                        context.client.invalidateQueries({
                          queryKey:
                            consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.key({
                              input: { params: variables.params },
                            }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                            input: { params: variables.params },
                          }),
                        }),
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.datasets.get.key(),
                        }),
                      ]),
                  },
                },
              },
              byWorkflowId: {
                patch: {
                  mutationOptions: {
                    onSuccess: (_data, variables, _result, context) => {
                      return Promise.all([
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                            input: { params: { pipeline_id: variables.params.pipeline_id } },
                          }),
                        }),
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
                        queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                          type: 'infinite',
                          input: { params: { pipeline_id: variables.params.pipeline_id } },
                        }),
                      })
                    },
                  },
                },
              },
              draft: {
                processing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
                preProcessing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
              },
              published: {
                processing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
                preProcessing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
              },
            },
          },
        },
      },
      workspaces: {
        byWorkspaceId: {
          members: {
            pendingInvitations: {
              revoke: {
                post: {
                  mutationOptions: {
                    // A failed revoke may mean the invitation was already accepted or revoked.
                    onSettled: (_data, _error, { params }, _result, { client }) => {
                      void invalidateQueryKeys(client, [
                        consoleQuery.workspaces.current.members.get.key(),
                        consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
                          input: { params: { workspace_id: params.workspace_id } },
                        }),
                        consoleQuery.features.get.queryKey(),
                      ])
                    },
                  },
                },
              },
            },
          },
        },
        current: {
          customizedSnippets: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _onMutateResult, context) => {
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                  })
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.snippets.key(),
                  })
                },
              },
            },
            bySnippetId: {
              patch: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    })
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    })
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                  },
                },
              },
              useCount: {
                increment: {
                  post: {
                    mutationOptions: {
                      onSuccess: (_data, _variables, _onMutateResult, context) => {
                        void context.client.invalidateQueries({
                          queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                        })
                        void context.client.invalidateQueries({
                          queryKey: consoleQuery.snippets.key(),
                        })
                      },
                    },
                  },
                },
              },
            },
            imports: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    })
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                  },
                },
              },
              byImportId: {
                confirm: {
                  post: {
                    mutationOptions: {
                      onSuccess: (_data, _variables, _onMutateResult, context) => {
                        void context.client.invalidateQueries({
                          queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                        })
                        void context.client.invalidateQueries({
                          queryKey: consoleQuery.snippets.key(),
                        })
                      },
                    },
                  },
                },
              },
            },
          },
          humanInput: {
            v2: {
              contacts: {
                platform: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                        invalidateHumanInputContactQueries(consoleQuery, context.client),
                    },
                  },
                },
                byContactId: {
                  imBindings: {
                    put: {
                      mutationOptions: {
                        onSuccess: (_data, _variables, _onMutateResult, context) =>
                          invalidateHumanInputContactQueries(consoleQuery, context.client),
                      },
                    },
                    delete: {
                      mutationOptions: {
                        onSuccess: (_data, _variables, _onMutateResult, context) =>
                          invalidateHumanInputContactQueries(consoleQuery, context.client),
                      },
                    },
                  },
                  imOverride: {
                    put: {
                      mutationOptions: {
                        onSuccess: (_data, _variables, _onMutateResult, context) =>
                          invalidateHumanInputContactQueries(consoleQuery, context.client),
                      },
                    },
                    delete: {
                      mutationOptions: {
                        onSuccess: (_data, _variables, _onMutateResult, context) =>
                          invalidateHumanInputContactQueries(consoleQuery, context.client),
                      },
                    },
                  },
                },
                external: {
                  post: {
                    mutationOptions: {
                      onSuccess: (_data, _variables, _onMutateResult, context) =>
                        invalidateHumanInputContactQueries(consoleQuery, context.client),
                    },
                  },
                  byContactId: {
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
                        invalidateHumanInputContactQueries(consoleQuery, context.client),
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
                      return context.client.resetQueries({
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
                      onSuccess: (_data, _variables, _onMutateResult, context) =>
                        invalidateHumanInputChannelQueries(consoleQuery, context.client),
                    },
                  },
                  byChannelId: {
                    put: {
                      mutationOptions: {
                        onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                          invalidateHumanInputChannelQueries(consoleQuery, context.client),
                      },
                    },
                    delete: {
                      mutationOptions: {
                        onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                          invalidateHumanInputChannelQueries(consoleQuery, context.client),
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
                        onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                          invalidateHumanInputChannelQueries(consoleQuery, context.client),
                      },
                    },
                    delete: {
                      mutationOptions: {
                        onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                          invalidateHumanInputChannelQueries(consoleQuery, context.client),
                      },
                    },
                    replacement: {
                      post: {
                        mutationOptions: {
                          onSettled: (_data, _error, _variables, _onMutateResult, context) =>
                            invalidateHumanInputChannelQueries(consoleQuery, context.client),
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          members: {
            // Invitations change seats (plan usage), the member list, and pending invitations.
            inviteEmail: {
              post: {
                mutationOptions: {
                  onSuccess: (response, _variables, _result, { client }) => {
                    void invalidateQueryKeys(client, [
                      consoleQuery.features.get.queryKey(),
                      consoleQuery.workspaces.current.members.get.key(),
                      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
                        input: { params: { workspace_id: response.tenant_id } },
                      }),
                    ])
                  },
                },
              },
            },
            byMemberId: {
              delete: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) => {
                    context.client.setQueriesData(
                      { queryKey: consoleQuery.workspaces.current.members.get.key() },
                      (members: AccountWithRoleListResponse | undefined) =>
                        members && {
                          ...members,
                          accounts: members.accounts.filter(
                            (member) => member.id !== variables.params.member_id,
                          ),
                        },
                    )
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.members.get.key(),
                    })
                    void invalidateHumanInputContactQueries(consoleQuery, context.client)
                  },
                },
              },
            },
          },
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
                          consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey(
                            { input: { params: { provider: params.provider } } },
                          ),
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
          networkAccessGroups: {
            post: {
              mutationOptions: {
                // Show the new group right away; the settled refetch confirms it.
                onSuccess: (data, _variables, _result, { client }) => {
                  client.setQueryData(
                    consoleQuery.workspaces.current.networkAccessGroups.get.queryKey(),
                    (current) => {
                      if (!current) return current
                      if (current.groups.some((group) => group.id === data.group.id)) return current
                      return { ...current, groups: [...current.groups, data.group] }
                    },
                  )
                },
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
                },
              },
            },
            byGroupId: {
              put: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
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
                        queryKey:
                          consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryKey({
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
          endpoints: {
            post: {
              mutationOptions: {
                onSettled: (_data, _error, _variables, _result, context) => {
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
                    }),
                  ])
                },
              },
            },
            byId: {
              patch: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
                      }),
                    ])
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
                      }),
                    ])
                  },
                },
              },
            },
            enable: {
              post: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
                      }),
                    ])
                  },
                },
              },
            },
            disable: {
              post: {
                mutationOptions: {
                  onSettled: (_data, _error, _variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
                      }),
                    ])
                  },
                },
              },
            },
          },
          skills: {
            // A new skill shows in the lists; the caller navigates without waiting for them.
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) => {
                  void invalidateSkillListQueries(consoleQuery, client)
                },
              },
            },
            import: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _result, { client }) => {
                    void invalidateSkillListQueries(consoleQuery, client)
                  },
                },
              },
            },
            bySkillId: {
              duplicate: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, _variables, _result, { client }) => {
                      void invalidateSkillListQueries(consoleQuery, client)
                    },
                  },
                },
              },
              // The publisher writes the published detail itself and waits for it; versions and
              // lists refresh in the background.
              publish: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) => {
                      void invalidateQueryKeys(client, [
                        consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
                          type: 'query',
                          input: { params: { skill_id: params.skill_id } },
                        }),
                        consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
                        consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
                      ])
                    },
                  },
                },
              },
              // Metadata writes return the full detail: write it instead of refetching it.
              patch: {
                mutationOptions: {
                  onSuccess: (detail, { params, body }, _result, { client }) => {
                    setSkillDetailCache(consoleQuery, client, params.skill_id, detail)
                    const input = { params: { skill_id: params.skill_id } }
                    void invalidateQueryKeys(client, [
                      consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({ input }),
                      consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
                      consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
                      ...(body.tags ? [consoleQuery.workspaces.current.skills.tags.get.key()] : []),
                    ])
                  },
                },
              },
              restore: {
                post: {
                  mutationOptions: {
                    onSettled: (_data, error, variables, _result, context) => {
                      if (error) return
                      void invalidateSkillVersionQueries(
                        consoleQuery,
                        context.client,
                        variables.params.skill_id,
                      )
                      void context.client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.skills.get.key(),
                      })
                    },
                  },
                },
              },
              versions: {
                byVersionId: {
                  patch: {
                    mutationOptions: {
                      onSuccess: (_data, { params }, _result, { client }) => {
                        void invalidateSkillVersionQueries(consoleQuery, client, params.skill_id)
                        void client.invalidateQueries({
                          queryKey:
                            consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.get.key(
                              { input: { params } },
                            ),
                        })
                      },
                    },
                  },
                  delete: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) => {
                        if (error) return
                        void invalidateSkillVersionQueries(
                          consoleQuery,
                          context.client,
                          variables.params.skill_id,
                        )
                      },
                    },
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    void invalidateSkillListQueries(consoleQuery, context.client)
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
                    })
                  },
                },
              },
            },
          },
          agents: {
            byAgentId: {
              skills: {
                put: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) => {
                      const input = { params: { agent_id: params.agent_id } }
                      void invalidateQueryKeys(client, [
                        consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({
                          type: 'query',
                          input,
                        }),
                        consoleQuery.agent.byAgentId.composer.get.key({ type: 'query', input }),
                      ])
                    },
                  },
                },
              },
            },
          },
          // Role writes refresh the role list; role assignment changes also refresh members.
          rbac: {
            roles: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) =>
                    error
                      ? undefined
                      : context.client.invalidateQueries({
                          queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
                        }),
                },
              },
              byRoleId: {
                put: {
                  mutationOptions: {
                    onSettled: (_data, error, _variables, _result, context) =>
                      error
                        ? undefined
                        : context.client.invalidateQueries({
                            queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
                          }),
                  },
                },
                delete: {
                  mutationOptions: {
                    onSettled: (_data, error, { params }, _result, { client }) => {
                      if (error) return
                      const roles = consoleQuery.workspaces.current.rbac.roles.get
                      const removeRole = (page: RbacRoleList): RbacRoleList =>
                        page.data?.some((role) => role.id === params.role_id)
                          ? {
                              ...page,
                              data: page.data.filter((role) => role.id !== params.role_id),
                            }
                          : page
                      client.setQueriesData<RbacRoleList>(
                        { queryKey: roles.key({ type: 'query' }) },
                        (data) => data && removeRole(data),
                      )
                      client.setQueriesData<InfiniteData<RbacRoleList>>(
                        { queryKey: roles.key({ type: 'infinite' }) },
                        (data) => data && { ...data, pages: data.pages.map(removeRole) },
                      )
                      void client.invalidateQueries({ queryKey: roles.key() })
                      void client.invalidateQueries({
                        queryKey: consoleQuery.workspaces.current.members.get.key(),
                      })
                    },
                  },
                },
                copy: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) =>
                        error
                          ? undefined
                          : Promise.all([
                              context.client.invalidateQueries({
                                queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
                              }),
                              variables.body?.copy_member &&
                                context.client.invalidateQueries({
                                  queryKey: consoleQuery.workspaces.current.members.get.key(),
                                }),
                            ]),
                    },
                  },
                },
              },
            },
            members: {
              byMemberId: {
                rbacRoles: {
                  put: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) =>
                        error
                          ? undefined
                          : Promise.all([
                              context.client.invalidateQueries({
                                queryKey:
                                  consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.key(
                                    { input: { params: variables.params } },
                                  ),
                              }),
                              context.client.invalidateQueries({
                                queryKey: consoleQuery.workspaces.current.members.get.key(),
                              }),
                            ]),
                    },
                  },
                },
              },
            },
            accessPolicies: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    return invalidateAccessPolicyQueries(consoleQuery, context.client)
                  },
                },
              },
              byPolicyId: {
                put: {
                  mutationOptions: {
                    onSettled: (_data, error, _variables, _result, context) => {
                      if (error) return
                      return invalidateAccessPolicyQueries(consoleQuery, context.client)
                    },
                  },
                },
                delete: {
                  mutationOptions: {
                    onSettled: (_data, error, _variables, _result, context) => {
                      if (error) return
                      void invalidateAccessPolicyQueries(consoleQuery, context.client)
                    },
                  },
                },
                copy: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, _variables, _result, context) => {
                        if (error) return
                        return invalidateAccessPolicyQueries(consoleQuery, context.client)
                      },
                    },
                  },
                },
              },
            },
            agents: {
              byAgentId: {
                whitelist: {
                  put: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) => {
                        if (error) return
                        return invalidateAgentAccessQueries(
                          consoleQuery,
                          context.client,
                          variables.params.agent_id,
                        )
                      },
                    },
                  },
                },
                users: {
                  byTargetAccountId: {
                    accessPolicies: {
                      put: {
                        mutationOptions: {
                          onSettled: (_data, error, variables, _result, context) => {
                            if (error) return
                            return invalidateAgentAccessQueries(
                              consoleQuery,
                              context.client,
                              variables.params.agent_id,
                            )
                          },
                        },
                      },
                    },
                  },
                },
                accessPolicies: {
                  byPolicyId: {
                    memberBindings: {
                      delete: {
                        mutationOptions: {
                          onSettled: (_data, error, variables, _result, context) => {
                            if (error) return
                            return invalidateAgentAccessQueries(
                              consoleQuery,
                              context.client,
                              variables.params.agent_id,
                            )
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
        customConfig: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, { client }) =>
                client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.customConfig.get.key(),
                }),
            },
          },
        },
      },
      account: {
        personalAccessTokens: {
          byTokenId: {
            delete: {
              mutationOptions: {
                onSuccess: async (_data, variables, _onMutateResult, context) => {
                  context.client.removeQueries({
                    queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                      input: { params: variables.params },
                    }),
                  })
                  await context.client.invalidateQueries({
                    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
                  })
                },
              },
            },
            patch: {
              mutationOptions: {
                onError: (error, variables, _onMutateResult, context) =>
                  refreshRejectedPersonalToken(
                    error,
                    context.client,
                    variables.params.token_id,
                    consoleQuery,
                  ),
                onSuccess: async (_data, variables, _onMutateResult, context) => {
                  await Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.account.personalAccessTokens.get.key(),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                        input: { params: variables.params },
                      }),
                    }),
                  ])
                },
              },
            },
          },
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client
                  .invalidateQueries({
                    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
                  })
                  .catch(noop)
              },
            },
          },
        },
        education: {
          get: {
            queryOptions: {
              // Passive probe: every callsite degrades to "not a student", so no toast.
              context: { silent: true },
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
                // Verified education changes the plan features.
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.features.get.queryKey(),
                })
              },
            },
          },
        },
        password: {
          post: {
            mutationOptions: {
              // The request alone decides success; a slow profile refresh must not hold the mutation.
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.account.profile.get.queryKey(),
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
          annotations: {
            byAnnotationId: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.apps.byAppId.annotations.key({
                        input: { params: { app_id: variables.params.app_id } },
                      }),
                    })
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.apps.byAppId.annotations.key({
                          input: { params: { app_id: variables.params.app_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.features.get.key(),
                      }),
                    ])
                  },
                },
              },
            },
            post: {
              mutationOptions: {
                onSettled: (_data, error, variables, _result, context) => {
                  if (error) return
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.apps.byAppId.annotations.key({
                        input: { params: { app_id: variables.params.app_id } },
                      }),
                    }),
                    context.client.invalidateQueries({ queryKey: consoleQuery.features.get.key() }),
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
                  if (!isDefinedError(error) || error.code !== 'network_access_version_conflict')
                    return
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
          server: {
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
      },
      byEvaluateTargetType: {
        byEvaluateTargetId: {
          evaluation: {
            put: {
              mutationOptions: {
                onSettled: (_data, error, variables, _onMutateResult, context) => {
                  if (error) return

                  return context.client.invalidateQueries({
                    queryKey:
                      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.get.key({
                        type: 'query',
                        input: { params: variables.params },
                      }),
                  })
                },
              },
            },
            run: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _onMutateResult, context) => {
                    if (error) return

                    return context.client.invalidateQueries({
                      queryKey:
                        consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key(
                          {
                            type: 'query',
                            input: { params: variables.params },
                          },
                        ),
                    })
                  },
                },
              },
            },
            runs: {
              byRunId: {
                cancel: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _onMutateResult, context) => {
                        if (error) return

                        const params = variables.params
                        const targetParams = {
                          evaluate_target_id: params.evaluate_target_id,
                          evaluate_target_type: params.evaluate_target_type,
                        }
                        return Promise.all([
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key(
                                {
                                  type: 'query',
                                  input: { params: targetParams },
                                },
                              ),
                          }),
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                                {
                                  type: 'query',
                                  input: { params },
                                },
                              ),
                          }),
                        ])
                      },
                    },
                  },
                },
                retry: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _onMutateResult, context) => {
                        if (error) return

                        const params = variables.params
                        const targetParams = {
                          evaluate_target_id: params.evaluate_target_id,
                          evaluate_target_type: params.evaluate_target_type,
                        }
                        return Promise.all([
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key(
                                {
                                  type: 'query',
                                  input: { params: targetParams },
                                },
                              ),
                          }),
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                                {
                                  type: 'query',
                                  input: { params },
                                },
                              ),
                          }),
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
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            patch: {
              mutationOptions: {
                onSuccess: async (space, { params }, _result, { client }) => {
                  const queryKey = consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryKey({
                    input: { params: { control_space_id: params.control_space_id } },
                  })
                  await client.cancelQueries({ queryKey })
                  client.setQueryData(queryKey, space)
                  // List cards render the same name, icon and visibility; refresh every list variant.
                  void client.invalidateQueries({
                    queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
                  })
                },
              },
            },
            members: {
              put: {
                mutationOptions: {
                  onSuccess: async (permissions, { params }, _result, { client }) => {
                    const queryKey =
                      consoleQuery.knowledgeFs.spaces.byControlSpaceId.permissions.get.queryKey({
                        input: { params: { control_space_id: params.control_space_id } },
                      })
                    await client.cancelQueries({ queryKey })
                    client.setQueryData(queryKey, permissions)
                  },
                },
              },
            },
            externalAccess: {
              put: {
                mutationOptions: {
                  onSuccess: async (externalAccess, { params }, _result, { client }) => {
                    const queryKey =
                      consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryKey({
                        input: { params: { control_space_id: params.control_space_id } },
                      })
                    await client.cancelQueries({ queryKey })
                    client.setQueryData(queryKey, externalAccess)
                  },
                },
              },
            },
            settings: {
              patch: {
                mutationOptions: {
                  onSuccess: async (response, { params }, _result, { client }) => {
                    const queryKey =
                      consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryKey({
                        input: { params: { control_space_id: params.control_space_id } },
                      })
                    await client.cancelQueries({ queryKey })
                    client.setQueryData(queryKey, response.settings)
                  },
                },
              },
            },
            quality: {
              replayRuns: {
                post: {
                  mutationOptions: {
                    onSuccess: (run, { params }, _result, { client }) => {
                      const replayRuns =
                        consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns
                      client.setQueryData(
                        replayRuns.byRunId.get.queryKey({
                          input: {
                            params: { control_space_id: params.control_space_id, run_id: run.id },
                          },
                        }),
                        // Polling may already hold a newer revision of the run.
                        (current) => (current && current.revision >= run.revision ? current : run),
                      )
                      void client.invalidateQueries({
                        queryKey: replayRuns.get.key({
                          input: { params: { control_space_id: params.control_space_id } },
                          type: 'infinite',
                        }),
                        refetchType: 'none',
                      })
                    },
                  },
                },
              },
            },
            goldenQuestions: {
              // Creating, importing or deleting questions changes the space's question list.
              post: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
                },
              },
              bulkImport: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) =>
                      invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
                  },
                },
              },
              byQuestionId: {
                delete: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) =>
                      invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
                  },
                },
                patch: {
                  mutationOptions: {
                    onSuccess: async (question, { params }, _result, { client }) => {
                      const get =
                        consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get
                      const input = { params: { control_space_id: params.control_space_id } }
                      const scope = { queryKey: get.key({ input }) }
                      await client.cancelQueries(scope)
                      client.setQueriesData<InfiniteData<KnowledgeFsGoldenQuestionListResponse>>(
                        { queryKey: get.key({ input, type: 'infinite' }) },
                        (list) =>
                          list && {
                            ...list,
                            pages: list.pages.map((page) => ({
                              ...page,
                              data: page.data.map((item) =>
                                item.id === question.id ? question : item,
                              ),
                            })),
                          },
                      )
                      void client.invalidateQueries(scope)
                    },
                  },
                },
              },
            },
            documents: {
              // Queued re-index tasks change document status and the space's task list.
              reindex: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) => {
                      const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                      const input = { params: { control_space_id: params.control_space_id } }
                      void Promise.allSettled([
                        client.invalidateQueries({
                          queryKey: space.logicalDocuments.get.key({ input }),
                        }),
                        client.invalidateQueries({
                          queryKey: space.backgroundTasks.get.key({ input }),
                        }),
                        client.invalidateQueries({
                          queryKey: space.goldenQuestions.get.key({ input }),
                        }),
                      ])
                    },
                  },
                },
              },
              byDocumentId: {
                patch: {
                  mutationOptions: {
                    onSuccess: (_data, { params, body }, _result, { client }) => {
                      const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                      const input = { params: { control_space_id: params.control_space_id } }
                      void client.invalidateQueries({
                        queryKey: space.logicalDocuments.byDocumentId.get.key({
                          input: { params },
                        }),
                      })
                      void client.invalidateQueries({
                        queryKey: space.logicalDocuments.get.key({ input }),
                      })
                      if ('displayName' in body.patch)
                        void client.invalidateQueries({
                          queryKey: space.goldenQuestions.get.key({ input }),
                        })
                    },
                  },
                },
              },
            },
            fileScanPolicy: {
              put: {
                mutationOptions: {
                  onSuccess: (policy, variables, _result, context) => {
                    context.client.setQueryData(
                      consoleQuery.knowledgeFs.spaces.byControlSpaceId.fileScanPolicy.get.queryKey({
                        input: { params: variables.params },
                      }),
                      policy,
                    )
                    // Each scanner reports how many knowledge bases select it.
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.fileScan.providers.get.key(),
                    })
                  },
                },
              },
            },
            delete: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  context.client.setQueriesData(
                    { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'query' }) },
                    (list: KnowledgeFsSpaceListResponse | undefined) => {
                      if (
                        !list?.data.some(
                          (item) => item.control_space_id === variables.params.control_space_id,
                        )
                      )
                        return list
                      return {
                        ...list,
                        data: list.data.filter(
                          (item) => item.control_space_id !== variables.params.control_space_id,
                        ),
                      }
                    },
                  )
                  context.client.setQueriesData(
                    { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'infinite' }) },
                    (list: InfiniteData<KnowledgeFsSpaceListResponse, unknown> | undefined) => {
                      if (
                        !list?.pages.some((page) =>
                          page.data.some(
                            (item) => item.control_space_id === variables.params.control_space_id,
                          ),
                        )
                      )
                        return list
                      return {
                        ...list,
                        pages: list.pages.map((page) => ({
                          ...page,
                          data: page.data.filter(
                            (item) => item.control_space_id !== variables.params.control_space_id,
                          ),
                        })),
                      }
                    },
                  )
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
                  })
                },
              },
            },
          },
        },
      },
      datasets: {
        // Process rules are read once to describe a running import.
        processRule: { get: { queryOptions: { refetchOnWindowFocus: false } } },
        byDatasetId: {
          fileScanPolicy: {
            put: {
              mutationOptions: {
                onSuccess: (policy, variables, _result, context) => {
                  context.client.setQueryData(
                    consoleQuery.datasets.byDatasetId.fileScanPolicy.get.queryKey({
                      input: { params: variables.params },
                    }),
                    policy,
                  )
                  // Each scanner reports how many knowledge bases select it.
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.fileScan.providers.get.key(),
                  })
                },
              },
            },
          },
          delete: {
            mutationOptions: {
              onSuccess: (_data, variables, _result, context) => {
                context.client.setQueriesData(
                  { queryKey: consoleQuery.datasets.get.key({ type: 'query' }) },
                  (list: DatasetListResponse | undefined) => {
                    if (!list?.data.some((item) => item.id === variables.params.dataset_id))
                      return list
                    const total = Math.max(0, list.total - 1)
                    return {
                      ...list,
                      data: list.data.filter((item) => item.id !== variables.params.dataset_id),
                      total,
                      has_more: list.page * list.limit < total,
                    }
                  },
                )
                context.client.setQueriesData(
                  { queryKey: consoleQuery.datasets.get.key({ type: 'infinite' }) },
                  (list: InfiniteData<DatasetListResponse, unknown> | undefined) => {
                    if (
                      !list?.pages.some((page) =>
                        page.data.some((item) => item.id === variables.params.dataset_id),
                      )
                    )
                      return list
                    return {
                      ...list,
                      pages: list.pages.map((page) => {
                        const total = Math.max(0, page.total - 1)
                        return {
                          ...page,
                          data: page.data.filter((item) => item.id !== variables.params.dataset_id),
                          total,
                          has_more: page.page * page.limit < total,
                        }
                      }),
                    }
                  },
                )
                void context.client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
              },
            },
          },
          // The upgrade dialog reports start failures, including model issues, inline.
          knowledgeFsUpgrades: {
            post: {
              mutationOptions: {
                context: { silent: true },
                // An upgrade job changes the dataset card and the list of running upgrades.
                onSuccess: (_job, _variables, _result, { client }) => {
                  void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                  void client.invalidateQueries({
                    queryKey: consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
                  })
                },
              },
            },
            byJobId: {
              post: {
                mutationOptions: {
                  onSuccess: (_job, { params }, _result, { client }) => {
                    void client.invalidateQueries({
                      queryKey:
                        consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryKey({
                          input: {
                            params: { dataset_id: params.dataset_id, job_id: params.job_id },
                          },
                        }),
                    })
                    void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                    void client.invalidateQueries({
                      queryKey: consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
                    })
                  },
                },
              },
            },
          },
          evaluation: {
            put: {
              mutationOptions: {
                onSettled: (_data, error, variables, _onMutateResult, context) => {
                  if (error) return

                  return context.client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.evaluation.get.key({
                      type: 'query',
                      input: { params: variables.params },
                    }),
                  })
                },
              },
            },
            run: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _onMutateResult, context) => {
                    if (error) return

                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                        type: 'query',
                        input: { params: variables.params },
                      }),
                    })
                  },
                },
              },
            },
            runs: {
              byRunId: {
                cancel: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _onMutateResult, context) => {
                        if (error) return

                        const params = variables.params
                        const targetParams = { dataset_id: params.dataset_id }
                        return Promise.all([
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                              type: 'query',
                              input: { params: targetParams },
                            }),
                          }),
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.key({
                                type: 'query',
                                input: { params },
                              }),
                          }),
                        ])
                      },
                    },
                  },
                },
                retry: {
                  post: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _onMutateResult, context) => {
                        if (error) return

                        const params = variables.params
                        const targetParams = { dataset_id: params.dataset_id }
                        return Promise.all([
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                              type: 'query',
                              input: { params: targetParams },
                            }),
                          }),
                          context.client.invalidateQueries({
                            queryKey:
                              consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.key({
                                type: 'query',
                                input: { params },
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
          get: {
            queryOptions: {
              // A missing or inaccessible dataset sends the detail page back to the list.
              retry: (failureCount, error) => {
                const status = getHttpErrorStatus(error)
                if (status === 403 || status === 404) return false

                return failureCount < 3
              },
            },
          },
          documents: {
            // Creating or re-saving a document changes the dataset card, the document list and
            // the document's detail.
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const input = { params: { dataset_id: params.dataset_id } }
                  void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                  void client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
                  })
                  void client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                      input,
                    }),
                  })
                },
              },
            },
            status: {
              byAction: {
                batch: {
                  patch: {
                    mutationOptions: {
                      onSuccess: (_data, { params }, _result, { client }) => {
                        // Enabled documents leave the auto-disabled notice.
                        if (params.action !== 'enable') return
                        void client.invalidateQueries({
                          queryKey: consoleQuery.datasets.byDatasetId.autoDisableLogs.get.queryKey({
                            input: { params: { dataset_id: params.dataset_id } },
                          }),
                        })
                      },
                    },
                  },
                },
              },
            },
            delete: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  const documentIds = new Set(variables.query?.document_id ?? [])
                  const input = { params: variables.params }
                  context.client.setQueriesData(
                    {
                      queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                        type: 'query',
                        input,
                      }),
                    },
                    (list: DocumentWithSegmentsListResponse | undefined) => {
                      if (!list) return list
                      const data = list.data.filter((document) => !documentIds.has(document.id))
                      if (data.length === list.data.length) return list
                      const total = Math.max(0, list.total - (list.data.length - data.length))
                      return { ...list, data, total, has_more: list.page * list.limit < total }
                    },
                  )
                  void context.client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
                  })
                },
              },
            },
            byDocumentId: {
              rename: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, { params }, _result, { client }) => {
                      const documents = consoleQuery.datasets.byDatasetId.documents
                      void client.invalidateQueries({
                        queryKey: documents.get.key({
                          input: { params: { dataset_id: params.dataset_id } },
                        }),
                      })
                      void client.invalidateQueries({
                        queryKey: documents.byDocumentId.get.key({ input: { params } }),
                      })
                    },
                  },
                },
              },
              pipelineExecutionLog: { get: { queryOptions: { staleTime: 0 } } },
            },
            // Document metadata shows in the dataset fields, the document list and each
            // document's detail.
            metadata: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    const params = { dataset_id: variables.params.dataset_id }
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                          input: { params },
                        }),
                      }),
                    ])
                  },
                },
              },
            },
          },
          metadata: {
            post: {
              mutationOptions: {
                onSettled: (_data, error, variables, _result, context) => {
                  if (error) return
                  return context.client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                      input: { params: variables.params },
                    }),
                  })
                },
              },
            },
            byMetadataId: {
              patch: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    const params = { dataset_id: variables.params.dataset_id }
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                          input: { params },
                        }),
                      }),
                    ])
                  },
                },
              },
              delete: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    const params = { dataset_id: variables.params.dataset_id }
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                          input: { params },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                          input: { params },
                        }),
                      }),
                    ])
                  },
                },
              },
            },
            builtIn: {
              byAction: {
                post: {
                  mutationOptions: {
                    onSettled: (_data, error, variables, _result, context) => {
                      if (error) return
                      return context.client.invalidateQueries({
                        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                          input: { params: { dataset_id: variables.params.dataset_id } },
                        }),
                      })
                    },
                  },
                },
              },
            },
          },
        },
        // A dataset created with its first document joins the dataset list.
        init: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, { client }) => {
                void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
              },
            },
          },
        },
        externalKnowledgeApi: {
          byExternalKnowledgeApiId: {
            delete: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const queryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryKey({
                    input: {},
                  })
                  client.setQueryData(
                    queryKey,
                    (previous) =>
                      previous && {
                        ...previous,
                        data: previous.data.filter(
                          (api) => api.id !== params.external_knowledge_api_id,
                        ),
                      },
                  )
                  void client.invalidateQueries({ queryKey, exact: true })
                },
              },
            },
          },
        },
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
          workflowRuns: {
            tasks: {
              byTaskId: {
                stop: {
                  post: {
                    mutationOptions: {
                      // A failed response can still follow an accepted stop request.
                      onSettled: (_data, _error, variables, _result, context) => {
                        return context.client.invalidateQueries({
                          queryKey: consoleQuery.snippets.bySnippetId.workflowRuns.key({
                            input: { params: { snippet_id: variables.params.snippet_id } },
                          }),
                        })
                      },
                    },
                  },
                },
              },
            },
          },
          workflows: {
            publish: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, variables, _onMutateResult, context) => {
                    context.client.setQueryData(
                      consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey({
                        input: { params: { snippet_id: variables.params.snippet_id } },
                      }),
                      (snippet) => (snippet ? { ...snippet, is_published: true } : snippet),
                    )
                    // The version list reloads from its first page; the publisher does not wait.
                    void context.client.resetQueries({
                      queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                        type: 'infinite',
                        input: { params: { snippet_id: variables.params.snippet_id } },
                      }),
                    })
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.snippets.bySnippetId.workflows.draft.get.key({
                          type: 'query',
                          input: { params: { snippet_id: variables.params.snippet_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.snippets.bySnippetId.workflows.publish.get.key({
                          type: 'query',
                          input: { params: { snippet_id: variables.params.snippet_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.snippets.bySnippetId.workflowRuns.get.key({
                          type: 'query',
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.key(
                            { type: 'query' },
                          ),
                      }),
                    ])
                  },
                },
              },
            },
            byWorkflowId: {
              patch: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) => {
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                          input: { params: { snippet_id: variables.params.snippet_id } },
                        }),
                      }),
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
                      queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                        type: 'infinite',
                        input: { params: { snippet_id: variables.params.snippet_id } },
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
                if (isNotFoundError(error)) return false

                return failureCount < 3
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
      onboarding: {
        stepByStepTour: {
          state: {
            patch: {
              mutationOptions: {
                onSuccess: (state, _variables, _result, { client }) => {
                  client.setQueryData(
                    consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
                    state,
                  )
                },
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
                  return Promise.all([
                    ...(error
                      ? [
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.agent.byAgentId.traceConfig.get.key({
                              input: { params: variables.params },
                            }),
                          }),
                        ]
                      : []),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
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
                      queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                        input: {
                          params: variables.params,
                          query: { tracing_provider: variables.body.tracing_provider },
                        },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
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
                      queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                        input: {
                          params: variables.params,
                          query: { tracing_provider: variables.body.tracing_provider },
                        },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
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
                      queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
                        input: {
                          params: variables.params,
                          query: { tracing_provider: variables.query.tracing_provider },
                        },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
                        input: { params: variables.params },
                      }),
                    }),
                  ])
                },
              },
            },
          },
          apiKeys: {
            post: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) =>
                  void Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
                        input: { params: { agent_id: variables.params.agent_id } },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
                        input: { params: { agent_id: variables.params.agent_id } },
                      }),
                    }),
                  ]),
              },
            },
            byApiKeyId: {
              delete: {
                mutationOptions: {
                  onSuccess: (_data, variables, _result, context) =>
                    void Promise.all([
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
                          input: { params: { agent_id: variables.params.agent_id } },
                        }),
                      }),
                      context.client.invalidateQueries({
                        queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
                          input: { params: { agent_id: variables.params.agent_id } },
                        }),
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
          // Restoring rewrites the agent's config; the restore dialog waits for it to reload.
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
                        consoleQuery.agent.byAgentId.versions.get.key({ input }),
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
            // Applying the build draft rewrites the agent; the editor waits for it to reload.
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
                  // The publisher waits for the new version, detail, and API access.
                  const input = { params: { agent_id: variables.params.agent_id } }
                  return invalidateQueryKeys(context.client, [
                    consoleQuery.agent.byAgentId.versions.get.key({ input }),
                    consoleQuery.agent.byAgentId.get.queryKey({ input }),
                    consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
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
                return refreshAgentTagCatalogs(consoleQuery, context.client)
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
      fileScan: {
        providers: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.fileScan.providers.get.key(),
                })
              },
            },
          },
          byProviderId: {
            patch: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return context.client.invalidateQueries({
                    queryKey: consoleQuery.fileScan.providers.get.key(),
                  })
                },
              },
            },
            delete: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return context.client.invalidateQueries({
                    queryKey: consoleQuery.fileScan.providers.get.key(),
                  })
                },
              },
            },
            test: {
              post: {
                // A finished check always stores a new status, including a failing one.
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.fileScan.providers.get.key(),
                    })
                  },
                },
              },
            },
          },
        },
      },
      resourceAccessTokens: {
        post: {
          mutationOptions: {
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              void context.client.invalidateQueries({
                queryKey: consoleQuery.resourceAccessTokens.get.key(),
              })
            },
          },
        },
        byTokenId: {
          patch: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.resourceAccessTokens.get.key(),
                })
              },
            },
          },
          relations: {
            byRelationId: {
              delete: {
                mutationOptions: {
                  networkMode: 'always',
                  onSettled: async (_data, error, { params }, _result, { client }) => {
                    if (error) return
                    const queryKey = consoleQuery.resourceAccessTokens.get.key()
                    await client.cancelQueries({ queryKey })
                    client.setQueriesData<ResourceAccessTokenListResponse>(
                      { queryKey },
                      (current) => {
                        if (!current?.data.some((row) => row.token_id === params.token_id))
                          return current

                        return {
                          ...current,
                          data: current.data.filter((row) => row.token_id !== params.token_id),
                          total: Math.max(0, current.total - 1),
                        }
                      },
                    )
                    void client.invalidateQueries({ queryKey })
                  },
                },
              },
            },
          },
        },
      },
      tags: {
        post: {
          mutationOptions: {
            onSuccess: async (tag, { body: { type } }, _result, { client, meta }) => {
              const queryKey = consoleQuery.tags.get.queryKey({ input: { query: { type } } })
              if (type === 'agent') await client.cancelQueries({ queryKey })

              client.setQueryData(
                queryKey,
                (oldTags: Tag[] | undefined) =>
                  oldTags && [tag, ...oldTags.filter((item) => item.id !== tag.id)],
              )

              if (type === 'agent') {
                // Card edits refresh the catalog after applying the new bindings.
                const refetchType = meta?.deferAgentTagCatalogRefresh ? 'none' : 'active'
                return client.invalidateQueries({ queryKey, refetchType })
              }
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
                  (oldTags: Tag[] | undefined) => {
                    if (!oldTags?.some((tag) => tag.id === variables.params.tag_id)) return
                    return oldTags.map((tag) =>
                      tag.id === variables.params.tag_id ? updatedTag : tag,
                    )
                  },
                )

                return Promise.all([
                  updatedTag.type === 'agent' &&
                    refreshAgentTagCatalogs(consoleQuery, context.client),
                  invalidateTaggedResources(consoleQuery, context.client, updatedTag.type),
                ])
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
                  (oldTags: Tag[] | undefined) => {
                    if (!oldTags?.some((tag) => tag.id === variables.params.tag_id)) return
                    return oldTags.filter((tag) => tag.id !== variables.params.tag_id)
                  },
                )

                return Promise.all([
                  deletedTag?.type === 'agent' &&
                    refreshAgentTagCatalogs(consoleQuery, context.client),
                  invalidateTaggedResources(consoleQuery, context.client, deletedTag?.type),
                ])
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
                        environment_deployments: current.environment_deployments.map((deployment) =>
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
                        environment_deployments: current.environment_deployments.map((deployment) =>
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
            updateEnvironmentWebAppAccessMode: {
              mutationOptions: {
                onSuccess: (site, { params }, _result, { client }) => {
                  const input = {
                    params: { app_id: params.app_id, environment_id: params.environment_id },
                  }
                  client.setQueryData(
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                      input,
                    }),
                    site,
                  )
                  void client.invalidateQueries({
                    queryKey:
                      consoleQuery.enterprise.appDeploy.accessService.getEnvironmentWebAppSubjects.queryKey(
                        { input },
                      ),
                  })
                },
              },
            },
            resetEnvironmentSiteAccessToken: {
              mutationOptions: {
                onSuccess: (site, { params }, _result, { client }) => {
                  client.setQueryData(
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                      input: {
                        params: { app_id: params.app_id, environment_id: params.environment_id },
                      },
                    }),
                    site,
                  )
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

function invalidateQueryKeys(client: QueryClient, queryKeys: QueryKey[]) {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })))
}

export async function refreshAgentTagCatalogs(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  const filters = { queryKey: query.tags.get.queryKey({ input: { query: { type: 'agent' } } }) }
  // Invalidation alone can reuse an initial GET that started before the write.
  await client.cancelQueries(filters)
  return client.invalidateQueries(filters)
}

export function invalidateTaggedResources(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  type: Tag['type'],
  targetId?: string,
) {
  if (type === 'agent') {
    return invalidateQueryKeys(client, [
      query.agent.get.key(),
      query.agent.inviteOptions.get.key(),
      query.agent.byAgentId.get.key(
        targetId ? { input: { params: { agent_id: targetId } } } : undefined,
      ),
    ])
  }
  if (type === 'app')
    return invalidateQueryKeys(client, [
      query.apps.get.key(),
      query.apps.starred.get.key(),
      query.apps.recent.get.key(),
    ])
}

function invalidateNetworkAccessGroupQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.networkAccessGroups.get.key(),
    query.workspaces.current.networkAccessGroups.byGroupId.key(),
    query.apps.byAppId.networkAccessGroup.key(),
  ])
}

function invalidateAccessPolicyQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.key(),
    query.agent.get.key(),
    query.agent.byAgentId.get.key(),
    query.apps.byAppId.get.key(),
    query.datasets.byDatasetId.get.key(),
  ])
}

function invalidateAgentAccessQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  agentId: string,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.agents.byAgentId.key({
      input: { params: { agent_id: agentId } },
    }),
    query.workspaces.current.rbac.myPermissions.get.key(),
    query.agent.get.key(),
    query.agent.inviteOptions.get.key(),
    query.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
  ])
}

function invalidateHumanInputContactQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.humanInput.v2.contacts.key(),
    query.workspaces.current.humanInput.v2.contactOptions.key(),
    query.workspaces.current.humanInput.v2.imIdentities.key(),
    query.workspaces.current.humanInput.v2.organizationCandidates.key(),
  ])
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

export function invalidateSkillVersionQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  skillId: string,
) {
  const input = { params: { skill_id: skillId } }
  return invalidateQueryKeys(client, [
    query.workspaces.current.skills.bySkillId.get.key({ input }),
    query.workspaces.current.skills.bySkillId.versions.get.key({ input }),
    query.workspaces.current.agents.byAgentId.skills.get.key(),
  ])
}

// knowledge helpers

function customizedPipelineTemplatesKey(query: RouterUtils<ConsoleClient>) {
  return query.rag.pipeline.templates.get.queryKey({ input: { query: { type: 'customized' } } })
}

function invalidateGoldenQuestionList(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  controlSpaceId: string,
) {
  return client.invalidateQueries({
    queryKey: query.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
      input: { params: { control_space_id: controlSpaceId } },
    }),
  })
}

// apps, workflow, agent, and skills helpers

function invalidateSkillListQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.skills.get.key({ type: 'query' }),
    query.workspaces.current.skills.get.key({ type: 'infinite' }),
    query.workspaces.current.skills.tags.get.key({ type: 'query' }),
  ])
}
