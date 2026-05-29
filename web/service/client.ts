import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { Tag } from '@/contract/console/tags'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  API_PREFIX,
  APP_VERSION,
  IS_MARKETPLACE,
  MARKETPLACE_API_PREFIX,
} from '@/config'
import {
  consoleRouterContract,
  marketplaceRouterContract,
} from '@/contract/router'
import { isClient } from '@/utils/client'
import { request } from './base'

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

function getRequestPathname(url: string) {
  try {
    return new URL(url, 'http://localhost').pathname
  }
  catch {
    return url
  }
}

function shouldUseLocalDeploymentErrorToast(url: string, method?: string) {
  const pathname = getRequestPathname(url)
  const normalizedMethod = method?.toUpperCase()

  return pathname.includes('/enterprise/app-deploy/initial-deployments/')
    || (
      normalizedMethod === 'POST'
      && (
        pathname.endsWith('/enterprise/app-deploy/app-instances')
        || pathname.endsWith('/enterprise/app-deploy/releases/dsl')
        || pathname.endsWith('/enterprise/app-deploy/releases/source-app')
      )
    )
    || /\/enterprise\/app-deploy\/app-instances\/[^/]+\/environments\/[^/]+\/deploy$/.test(pathname)
}

function getFetchRequestMethod(input: { method?: unknown }, init?: RequestInit) {
  return typeof input.method === 'string' ? input.method : init?.method
}

type AppDeployInvalidationOptions = {
  appInstances?: boolean
  appInstance?: boolean
  environmentDeployments?: boolean
  releases?: boolean
  accessChannels?: boolean
}

type ConsoleQueryUtils = RouterUtils<JsonifiedClient<ContractRouterClient<typeof consoleRouterContract>>>

const defaultAppDeployInvalidationOptions = {
  appInstances: true,
  appInstance: true,
  environmentDeployments: true,
  releases: true,
  accessChannels: true,
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

function accessChannelsQueryKey(query: ConsoleQueryUtils, appInstanceId: string) {
  return query.enterprise.accessService.getAccessChannels.key({
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
  if (resolvedOptions.appInstance)
    queryKeys.push(appInstanceQueryKey(query, appInstanceId))
  if (resolvedOptions.environmentDeployments)
    queryKeys.push(environmentDeploymentsQueryKey(query, appInstanceId))
  if (resolvedOptions.releases)
    queryKeys.push(releasesQueryKey(query, appInstanceId))
  if (resolvedOptions.accessChannels)
    queryKeys.push(accessChannelsQueryKey(query, appInstanceId))

  return invalidateQueryKeys(client, queryKeys)
}

function removeAppDeployQueries(query: ConsoleQueryUtils, client: QueryClient, appInstanceId: string) {
  const queryKeys = [
    appInstanceQueryKey(query, appInstanceId),
    environmentDeploymentsQueryKey(query, appInstanceId),
    releasesQueryKey(query, appInstanceId),
    accessChannelsQueryKey(query, appInstanceId),
  ]

  queryKeys.forEach(queryKey => client.removeQueries({ queryKey }))
}

const consoleLink = new OpenAPILink(consoleRouterContract, {
  url: getBaseURL(API_PREFIX),
  fetch: (input, init) => {
    const method = getFetchRequestMethod(input, init)

    return request(
      input.url,
      init,
      {
        fetchCompat: true,
        request: input,
        silent: shouldUseLocalDeploymentErrorToast(input.url, method),
      },
    )
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const consoleClient: JsonifiedClient<ContractRouterClient<typeof consoleRouterContract>> = createORPCClient(consoleLink)

export const consoleQuery: RouterUtils<typeof consoleClient> = createTanstackQueryUtils(consoleClient, {
  path: ['console'],
  experimental_defaults: {
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

                  if (listResponse?.data?.some(app => app.id === appInstanceId))
                    break
                }
              }

              await context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
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

              return context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
              })
            },
          },
        },
      },
      releaseService: {
        createReleaseFromDsl: {
          mutationOptions: {
            onSuccess: (data, variables, _result, context) => {
              const appInstanceId = data.release?.appInstanceId ?? data.appInstance?.id ?? variables.body.appInstanceId
              if (!appInstanceId) {
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                })
              }

              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId, {
                environmentDeployments: false,
                accessChannels: false,
              })
            },
          },
        },
        createReleaseFromSourceApp: {
          mutationOptions: {
            onSuccess: (data, variables, _result, context) => {
              const appInstanceId = data.release?.appInstanceId ?? data.appInstance?.id ?? variables.body.appInstanceId
              if (!appInstanceId) {
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                })
              }

              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId, {
                environmentDeployments: false,
                accessChannels: false,
              })
            },
          },
        },
      },
      deploymentService: {
        deploy: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
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
        undeploy: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const appInstanceId = variables.params.appInstanceId
              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        createInitialDeploymentFromDsl: {
          mutationOptions: {
            onSuccess: (data, _variables, _result, context) => {
              const appInstanceId = data.appInstance?.id ?? data.release?.appInstanceId
              if (!appInstanceId) {
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                })
              }

              return invalidateAppDeployQueries(consoleQuery, context.client, appInstanceId)
            },
          },
        },
        createInitialDeploymentFromSourceApp: {
          mutationOptions: {
            onSuccess: (data, _variables, _result, context) => {
              const appInstanceId = data.appInstance?.id ?? data.release?.appInstanceId
              if (!appInstanceId) {
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.enterprise.appInstanceService.listAppInstances.key(),
                })
              }

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
                accessChannelsQueryKey(consoleQuery, appInstanceId),
                apiKeysQueryKey(consoleQuery, appInstanceId, environmentId),
              ])
            },
          },
        },
        deleteApiKey: {
          mutationOptions: {
            onSuccess: (_data, _variables, _result, context) => {
              return context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.accessService.listApiKeys.key({ type: 'query' }),
              })
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
        putAccessPolicy: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { appInstanceId, environmentId } = variables.params
              return invalidateQueryKeys(context.client, [
                accessPolicyQueryKey(consoleQuery, appInstanceId, environmentId),
                accessChannelsQueryKey(consoleQuery, appInstanceId),
              ])
            },
          },
        },
      },
    },
  },
})
