import type { AgentAppPagination } from '@dify/contracts/api/console/agent/types.gen'
import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type {
  GetReleaseResponse,
  ListReleasesResponse,
  PrecheckReleaseRequest,
} from '@dify/contracts/enterprise/types.gen'
import type { ClientLink } from '@orpc/client'
import type { AnyContractRouter, ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Tag } from '@/contract/console/tags'
import type { consoleRouterContract } from '@/contract/router'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  API_PREFIX,
  APP_VERSION,
  IS_MARKETPLACE,
  MARKETPLACE_API_PREFIX,
} from '@/config'
import { marketplaceRouterContract } from '@/contract/marketplace'
import { isClient } from '@/utils/client'
// eslint-disable-next-line no-restricted-imports
import { request } from './base'
import { createConsoleDynamicLink } from './console-link'

function getMarketplaceHeaders() {
  return new Headers({
    'X-Dify-Version': !IS_MARKETPLACE ? APP_VERSION : '999.0.0',
  })
}

function isURL(path: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(path)
    return true
  }
  catch {
    return false
  }
}

export function getBaseURL(path: string) {
  const url = new URL(path, isURL(path) ? undefined : isClient ? window.location.origin : 'http://localhost')

  if (!isClient && !isURL(path)) {
    console.warn('Using localhost as base URL in server environment, please configure accordingly.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.warn(`Unexpected protocol for API requests, expected http or https. Current protocol: ${url.protocol}. Please configure accordingly.`)
  }

  return url
}

type ConsoleClientContext = Record<never, never>
type ConsoleClientLink = ClientLink<ConsoleClientContext>

function createConsoleOpenAPILink(contract: AnyContractRouter): ConsoleClientLink {
  return new OpenAPILink<ConsoleClientContext>(contract, {
    url: getBaseURL(API_PREFIX),
    fetch: (input, init) => {
      return request(
        input.url,
        init,
        {
          fetchCompat: true,
          request: input,
        },
      )
    },
    interceptors: [
      onError((error) => {
        console.error(error)
      }),
    ],
  })
}

const marketplaceLink = new OpenAPILink(marketplaceRouterContract, {
  url: MARKETPLACE_API_PREFIX,
  headers: () => (getMarketplaceHeaders()),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      cache: 'no-store',
    })
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const marketplaceClient: JsonifiedClient<ContractRouterClient<typeof marketplaceRouterContract>> = createORPCClient(marketplaceLink)
export const marketplaceQuery = createTanstackQueryUtils(marketplaceClient, { path: ['marketplace'] })

const APP_DEPLOY_SOURCE_APPS_PAGE_SIZE = 100
const APP_DEPLOY_READINESS_RETRY_DELAYS = [0, 300, 700, 1200]

type AppDeployInvalidationOptions = {
  appInstances?: boolean
  appInstanceSummaries?: boolean
  appInstance?: boolean
  appInstanceOverview?: boolean
  environmentDeployments?: boolean
  releases?: boolean
  releaseSummaries?: boolean
  releaseDeploymentView?: boolean
  accessChannels?: boolean
  accessSettings?: boolean
  developerApiSettings?: boolean
}

type ConsoleQueryUtils = RouterUtils<JsonifiedClient<ContractRouterClient<typeof consoleRouterContract>>>

const defaultAppDeployInvalidationOptions = {
  appInstances: true,
  appInstanceSummaries: true,
  appInstance: true,
  appInstanceOverview: true,
  environmentDeployments: true,
  releases: true,
  releaseSummaries: true,
  releaseDeploymentView: true,
  accessChannels: true,
  accessSettings: true,
  developerApiSettings: true,
} satisfies Required<AppDeployInvalidationOptions>

function invalidateQueryKeys(client: QueryClient, queryKeys: QueryKey[]) {
  return Promise.all(queryKeys.map(queryKey => client.invalidateQueries({ queryKey })))
}

function appInstanceQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.appInstanceService.getAppInstance.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function appInstanceOverviewQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.appInstanceService.getAppInstanceOverview.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function environmentDeploymentsQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.deploymentService.listEnvironmentDeployments.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function releasesQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.releaseService.listReleases.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function releaseSummariesQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.releaseService.listReleaseSummaries.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function releaseDeploymentViewQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.releaseService.computeReleaseDeploymentView.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function releaseQueryKey(query: ConsoleQueryUtils, releaseId: string) {
  return query.enterprise.releaseService.getRelease.key({
    type: 'query',
    input: { params: { releaseId } },
  })
}

function cachedReleaseAppInstanceId(
  query: ConsoleQueryUtils,
  client: QueryClient,
  releaseId: string,
) {
  const listQueries = client.getQueriesData<ListReleasesResponse>({
    queryKey: query.enterprise.releaseService.listReleases.key({ type: 'query' }),
  })
  for (const [, data] of listQueries) {
    const appInstanceId = data?.releases?.find(release => release.id === releaseId)?.appInstanceId
    if (appInstanceId)
      return appInstanceId
  }

  const releaseQueries = client.getQueriesData<GetReleaseResponse>({
    queryKey: query.enterprise.releaseService.getRelease.key({ type: 'query' }),
  })
  for (const [, data] of releaseQueries) {
    const release = data?.release
    if (release?.id === releaseId && release.appInstanceId)
      return release.appInstanceId
  }
}

function precheckReleaseQueryKey(query: ConsoleQueryUtils, body: PrecheckReleaseRequest) {
  return query.enterprise.releaseService.precheckRelease.key({
    type: 'query',
    input: { body },
  })
}

function accessChannelsQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.accessService.getAccessChannels.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function accessSettingsQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.accessService.getAccessSettings.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function developerApiSettingsQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.accessService.getDeveloperApiSettings.key({
    type: 'query',
    input: { params: { appInstanceId } },
  })
}

function apiKeysQueryKey(query: ConsoleQueryUtils, appInstanceId: string, environmentId: string) {
  return query.enterprise.accessService.listApiKeys.key({
    type: 'query',
    input: { params: { appInstanceId, environmentId } },
  })
}

function accessPolicyQueryKey(query: ConsoleQueryUtils, appInstanceId: string, environmentId: string) {
  return query.enterprise.accessService.getAccessPolicy.key({
    type: 'query',
    input: { params: { appInstanceId, environmentId } },
  })
}

function invalidateAppDeployQueries(
  query: ConsoleQueryUtils,
  client: QueryClient,
  appInstanceId: string,
  options: AppDeployInvalidationOptions = {},
) {
  const resolvedOptions = {
    ...defaultAppDeployInvalidationOptions,
    ...options,
  }
  const queryKeys: QueryKey[] = []

  if (resolvedOptions.appInstances)
    queryKeys.push(query.enterprise.appInstanceService.listAppInstances.key())
  if (resolvedOptions.appInstanceSummaries)
    queryKeys.push(query.enterprise.appInstanceService.listAppInstanceSummaries.key())
  if (resolvedOptions.appInstance)
    queryKeys.push(appInstanceQueryKey(query, appInstanceId))
  if (resolvedOptions.appInstanceOverview)
    queryKeys.push(appInstanceOverviewQueryKey(query, appInstanceId))
  if (resolvedOptions.environmentDeployments)
    queryKeys.push(environmentDeploymentsQueryKey(query, appInstanceId))
  if (resolvedOptions.releases)
    queryKeys.push(releasesQueryKey(query, appInstanceId))
  if (resolvedOptions.releaseSummaries)
    queryKeys.push(releaseSummariesQueryKey(query, appInstanceId))
  if (resolvedOptions.releaseDeploymentView)
    queryKeys.push(releaseDeploymentViewQueryKey(query, appInstanceId))
  if (resolvedOptions.accessChannels)
    queryKeys.push(accessChannelsQueryKey(query, appInstanceId))
  if (resolvedOptions.accessSettings)
    queryKeys.push(accessSettingsQueryKey(query, appInstanceId))
  if (resolvedOptions.developerApiSettings)
    queryKeys.push(developerApiSettingsQueryKey(query, appInstanceId))

  return invalidateQueryKeys(client, queryKeys)
}

function removeAppDeployQueries(query: ConsoleQueryUtils, client: QueryClient, appInstanceId: string) {
  const queryKeys = [
    appInstanceQueryKey(query, appInstanceId),
    appInstanceOverviewQueryKey(query, appInstanceId),
    environmentDeploymentsQueryKey(query, appInstanceId),
    releasesQueryKey(query, appInstanceId),
    releaseSummariesQueryKey(query, appInstanceId),
    releaseDeploymentViewQueryKey(query, appInstanceId),
    accessChannelsQueryKey(query, appInstanceId),
    accessSettingsQueryKey(query, appInstanceId),
    developerApiSettingsQueryKey(query, appInstanceId),
  ]

  queryKeys.forEach(queryKey => client.removeQueries({ queryKey }))
}

async function invalidateReleaseMutationQueries(
  query: ConsoleQueryUtils,
  client: QueryClient,
  releaseId: string,
  appInstanceId?: string,
  options: {
    removeRelease?: boolean
  } = {},
) {
  const releaseDetailQueryKey = releaseQueryKey(query, releaseId)
  if (options.removeRelease) {
    client.removeQueries({
      queryKey: releaseDetailQueryKey,
    })
  }
  else {
    await client.invalidateQueries({
      queryKey: releaseDetailQueryKey,
    })
  }

  if (appInstanceId) {
    return invalidateAppDeployQueries(query, client, appInstanceId, {
      accessChannels: false,
      accessSettings: false,
      developerApiSettings: false,
    })
  }

  return invalidateQueryKeys(client, [
    query.enterprise.appInstanceService.listAppInstances.key(),
    query.enterprise.appInstanceService.listAppInstanceSummaries.key(),
    query.enterprise.releaseService.listReleases.key({ type: 'query' }),
    query.enterprise.releaseService.listReleaseSummaries.key({ type: 'query' }),
    query.enterprise.releaseService.computeReleaseDeploymentView.key({ type: 'query' }),
    query.enterprise.appInstanceService.getAppInstance.key({ type: 'query' }),
    query.enterprise.appInstanceService.getAppInstanceOverview.key({ type: 'query' }),
  ])
}

const consoleLink = createConsoleDynamicLink<ConsoleClientContext>(createConsoleOpenAPILink)

export const consoleClient: JsonifiedClient<ContractRouterClient<typeof consoleRouterContract>> = createORPCClient(consoleLink)

export const consoleQuery: RouterUtils<typeof consoleClient> = createTanstackQueryUtils(consoleClient, {
  path: ['console'],
  experimental_defaults: {
    apps: {
      byAppId: {
        workflows: {
          draft: {
            nodes: {
              byNodeId: {
                agentComposer: {
                  put: {
                    mutationOptions: {
                      onSuccess: (composerState, variables, _onMutateResult, context) => {
                        context.client.setQueryData(
                          consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
                            input: {
                              params: variables.params,
                            },
                          }),
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
                            consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
                              input: {
                                params: variables.params,
                              },
                            }),
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
                            consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
                              input: {
                                params: variables.params,
                              },
                            }),
                            composerState,
                          )
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.agent.get.key(),
                          })
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.agent.inviteOptions.get.key(),
                          })

                          const agentId = composerState.binding?.binding_type === 'roster_agent'
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
                  if (!oldList?.data.some(item => item.id === updatedAgent.id))
                    return oldList

                  return {
                    ...oldList,
                    data: oldList.data.map(item => item.id === updatedAgent.id ? updatedAgent : item),
                  }
                },
              )
              context.client.setQueriesData(
                {
                  queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
                },
                (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
                  if (!oldList?.pages.some(page => page.data.some(item => item.id === updatedAgent.id)))
                    return oldList

                  return {
                    ...oldList,
                    pages: oldList.pages.map(page => ({
                      ...page,
                      data: page.data.map(item => item.id === updatedAgent.id ? updatedAgent : item),
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
              onSuccess: (_composerState, variables, _onMutateResult, context) => {
                if (variables.body.save_strategy !== 'save_as_new_version')
                  return

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
        publish: {
          post: {
            mutationOptions: {
              onSuccess: (_publishResult, _variables, _onMutateResult, context) => {
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
              context.client.setQueriesData(
                {
                  queryKey: consoleQuery.agent.get.key({ type: 'query' }),
                },
                (oldList: AgentAppPagination | undefined) => {
                  if (!oldList?.data.some(item => item.id === variables.params.agent_id))
                    return oldList

                  return {
                    ...oldList,
                    data: oldList.data.filter(item => item.id !== variables.params.agent_id),
                    total: Math.max(0, oldList.total - 1),
                  }
                },
              )
              context.client.setQueriesData(
                {
                  queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
                },
                (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
                  if (!oldList?.pages.some(page => page.data.some(item => item.id === variables.params.agent_id)))
                    return oldList

                  return {
                    ...oldList,
                    pages: oldList.pages.map((page) => {
                      const total = Math.max(0, page.total - 1)

                      return {
                        ...page,
                        data: page.data.filter(item => item.id !== variables.params.agent_id),
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
    explore: {
      updateAppAccessMode: {
        mutationOptions: {
          onSuccess: (_data, _variables, _onMutateResult, context) => {
            return Promise.all([
              context.client.invalidateQueries({
                queryKey: consoleQuery.explore.appAccessMode.key({ type: 'query' }),
              }),
              context.client.invalidateQueries({
                queryKey: ['access-control', 'app-whitelist-subjects'],
              }),
            ])
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
                  oldExtensions?.map(extension => extension.id === variables.params.id
                    ? updatedExtension
                    : extension),
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
                  oldExtensions?.filter(extension => extension.id !== variables.params.id),
              )
            },
          },
        },
      },
    },
    tags: {
      create: {
        mutationOptions: {
          onSuccess: (tag, _variables, _onMutateResult, context) => {
            context.client.setQueryData(
              consoleQuery.tags.list.queryKey({
                input: {
                  query: {
                    type: tag.type,
                  },
                },
              }),
              (oldTags: Tag[] | undefined) => oldTags ? [tag, ...oldTags] : oldTags,
            )
          },
        },
      },
      update: {
        mutationOptions: {
          onSuccess: (updatedTag, variables, _onMutateResult, context) => {
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.tags.list.key({ type: 'query' }),
              },
              (oldTags: Tag[] | undefined) => oldTags?.map(tag => tag.id === variables.params.tagId
                ? updatedTag
                : tag),
            )
          },
        },
      },
      delete: {
        mutationOptions: {
          onSuccess: (_data, variables, _onMutateResult, context) => {
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.tags.list.key({ type: 'query' }),
              },
              (oldTags: Tag[] | undefined) => oldTags?.filter(tag => tag.id !== variables.params.tagId),
            )
          },
        },
      },
    },
    enterprise: {
      appInstanceService: {
        createAppInstance: {
          mutationOptions: {
            onSuccess: async (data, _variables, _result, context) => {
              const appInstanceId = data.appInstance?.id
              if (appInstanceId) {
                for (const delay of APP_DEPLOY_READINESS_RETRY_DELAYS) {
                  if (delay > 0)
                    await new Promise(resolve => setTimeout(resolve, delay))

                  const listResponse = await context.client
                    .fetchQuery(consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
                      input: {
                        query: {
                          pageNumber: 1,
                          resultsPerPage: APP_DEPLOY_SOURCE_APPS_PAGE_SIZE,
                        },
                      },
                    }))
                    .catch(() => undefined)

                  if (listResponse?.appInstances?.some(app => app.id === appInstanceId))
                    break
                }
              }

              await context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
              })
              await context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
              })
            },
          },
        },
        updateAppInstance: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId, {
                environmentDeployments: false,
                releases: false,
                accessChannels: false,
              })
            },
          },
        },
        deleteAppInstance: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              removeAppDeployQueries(consoleQuery, context.client, appInstanceId)

              return Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
                }),
              ])
            },
          },
        },
      },
      releaseService: {
        createRelease: {
          mutationOptions: {
            onSuccess: (data, variables, _result, context) => {
              const appInstanceId = data.release?.appInstanceId ?? data.appInstance?.id ?? variables.body.appInstanceId
              const { dsl, sourceAppId } = variables.body
              if (!appInstanceId) {
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
                  }),
                ])
              }

              const appDeployInvalidation = invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId, {
                environmentDeployments: false,
                accessChannels: false,
              })
              if (!dsl && !sourceAppId)
                return appDeployInvalidation

              return Promise.all([
                appDeployInvalidation,
                context.client.invalidateQueries({
                  queryKey: precheckReleaseQueryKey(consoleQuery, {
                    appInstanceId,
                    ...(dsl ? { dsl } : { sourceAppId }),
                  }),
                }),
              ])
            },
          },
        },
        deleteRelease: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const releaseId = variables.params.releaseId
              const appInstanceId = cachedReleaseAppInstanceId(consoleQuery, context.client, releaseId)

              return invalidateReleaseMutationQueries(consoleQuery, context.client, releaseId, appInstanceId, {
                removeRelease: true,
              })
            },
          },
        },
        updateRelease: {
          mutationOptions: {
            onSuccess: (data, variables, _result, context) => {
              const releaseId = variables.params.releaseId
              const appInstanceId = data.release?.appInstanceId
                ?? cachedReleaseAppInstanceId(consoleQuery, context.client, releaseId)

              return invalidateReleaseMutationQueries(consoleQuery, context.client, releaseId, appInstanceId)
            },
          },
        },
      },
      deploymentService: {
        deploy: {
          mutationOptions: {
            onSuccess: (data, _variables, _result, context) => {
              // Deploy always creates a new AppInstance, so the reply carries it.
              const appInstanceId = data.appInstance?.id ?? data.release?.appInstanceId
              if (!appInstanceId) {
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
                  }),
                ])
              }

              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        cancelDeployment: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        promote: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        rollback: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        undeploy: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
      },
      accessService: {
        createApiKey: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              const environmentId = variables.params.environmentId
              return invalidateQueryKeys(context.client, [
                appInstanceQueryKey(consoleQuery, appInstanceId),
                appInstanceOverviewQueryKey(consoleQuery, appInstanceId),
                consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
                accessChannelsQueryKey(consoleQuery, appInstanceId),
                developerApiSettingsQueryKey(consoleQuery, appInstanceId),
                apiKeysQueryKey(consoleQuery, appInstanceId, environmentId),
              ])
            },
          },
        },
        deleteApiKey: {
          mutationOptions: {
            onSuccess: (_data, _variables, _result, context) => {
              return invalidateQueryKeys(context.client, [
                consoleQuery.enterprise.accessService.listApiKeys.key({ type: 'query' }),
                consoleQuery.enterprise.accessService.getDeveloperApiSettings.key({ type: 'query' }),
                consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.key({ type: 'query' }),
                consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.key(),
              ])
            },
          },
        },
        updateAccessChannels: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId, {
                environmentDeployments: false,
                releases: false,
              })
            },
          },
        },
        updateAccessPolicy: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { appInstanceId, environmentId } = variables.params
              return invalidateQueryKeys(context.client, [
                accessPolicyQueryKey(consoleQuery, appInstanceId, environmentId),
                accessChannelsQueryKey(consoleQuery, appInstanceId),
                accessSettingsQueryKey(consoleQuery, appInstanceId),
              ])
            },
          },
        },
      },
    },
  },
})
