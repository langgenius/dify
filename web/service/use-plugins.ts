import type { MutateOptions, QueryOptions } from '@tanstack/react-query'
import type {
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import type {
  DebugInfo as DebugInfoTypes,
  Dependency,
  GitHubItemAndMarketPlaceDependency,
  InstalledLatestVersionResponse,
  InstallPackageResponse,
  InstallStatusResponse,
  PackageDependency,
  Plugin,
  PluginDeclaration,
  PluginDetail,
  PluginsFromMarketplaceByInfoResponse,
  PluginsFromMarketplaceResponse,
  PluginTask,
  ReferenceSetting,
  uploadGitHubResponse,
  VersionInfo,
  VersionListResponse,
} from '@/app/components/plugins/types'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { cloneDeep } from 'es-toolkit/object'
import { useCallback, useEffect, useState } from 'react'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { getFormattedPlugin } from '@/app/components/plugins/marketplace/utils'
import useReferenceSetting from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { fetchModelProviderModelList } from '@/service/common'
import {
  checkImportDependencies,
  checkInstalledPlugins,
  deleteAllPluginTasks,
  deletePluginTask,
  downloadPlugin,
  excludeAutoUpgrade,
  fetchDebugKey,
  fetchInstalledLatestVersion,
  fetchInstalledPluginList,
  fetchMarketplacePluginsByIds,
  fetchMarketplacePluginsByInfo,
  fetchPluginAsset,
  fetchPluginDeclarationFromMarketplace,
  fetchPluginDynamicOptions,
  fetchPluginInfoFromMarketPlace,
  fetchPluginManifestInfo,
  fetchPluginReadme,
  fetchPluginTaskList,
  fetchPluginVersionList,
  fetchRecommendedMarketplacePlugins,
  fetchReferenceSettings,
  installPackageFromGitHub,
  installPackageFromLocal,
  installPackageFromMarketplace,
  searchMarketplacePlugins,
  uninstallPlugin,
  updateFromMarketPlace,
  updateReferenceSettings,
  uploadGitHubPackage,
} from './plugins'
import { useInvalidateAllBuiltInTools } from './use-tools'

const NAME_SPACE = 'plugins'

const useInstalledPluginListKey = [NAME_SPACE, 'installedPluginList']
export const useCheckInstalled = ({
  pluginIds,
  enabled,
}: {
  pluginIds: string[]
  enabled: boolean
}) => {
  return useQuery<{ plugins: PluginDetail[] }>({
    queryKey: [NAME_SPACE, 'checkInstalled', pluginIds],
    queryFn: () => checkInstalledPlugins(pluginIds),
    enabled,
    staleTime: 0, // always fresh
  })
}

const useRecommendedMarketplacePluginsKey = [NAME_SPACE, 'recommendedMarketplacePlugins']
export const useRecommendedMarketplacePlugins = ({
  collection = '__recommended-plugins-tools',
  enabled = true,
  limit = 15,
}: {
  collection?: string
  enabled?: boolean
  limit?: number
} = {}) => {
  return useQuery<Plugin[]>({
    queryKey: [...useRecommendedMarketplacePluginsKey, collection, limit],
    queryFn: async () => {
      const response = await fetchRecommendedMarketplacePlugins(collection, limit)
      return response.data.plugins.map(plugin => getFormattedPlugin(plugin))
    },
    enabled,
    staleTime: 60 * 1000,
  })
}

export const useFeaturedToolsRecommendations = (enabled: boolean, limit = 15) => {
  const {
    data: plugins = [],
    isLoading,
  } = useRecommendedMarketplacePlugins({
    collection: '__recommended-plugins-tools',
    enabled,
    limit,
  })

  return {
    plugins,
    isLoading,
  }
}

export const useFeaturedTriggersRecommendations = (enabled: boolean, limit = 15) => {
  const {
    data: plugins = [],
    isLoading,
  } = useRecommendedMarketplacePlugins({
    collection: '__recommended-plugins-triggers',
    enabled,
    limit,
  })

  return {
    plugins,
    isLoading,
  }
}

export const useInstalledPluginList = (disable?: boolean, pageSize = 100) => {
  const fetchPlugins = async ({ pageParam = 1 }) => {
    const response = await fetchInstalledPluginList(pageParam as number, pageSize)
    return response
  }

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isSuccess,
  } = useInfiniteQuery({
    enabled: !disable,
    queryKey: useInstalledPluginListKey,
    queryFn: fetchPlugins,
    getNextPageParam: (lastPage, pages) => {
      const totalItems = lastPage.total
      const currentPage = pages.length
      const itemsLoaded = currentPage * pageSize

      if (itemsLoaded >= totalItems)
        return

      return currentPage + 1
    },
    initialPageParam: 1,
  })

  const plugins = data?.pages.flatMap(page => page.plugins) ?? []
  const total = data?.pages[0].total ?? 0

  return {
    data: disable
      ? undefined
      : {
          plugins,
          total,
        },
    isLastPage: !hasNextPage,
    loadNextPage: () => {
      fetchNextPage()
    },
    isLoading,
    isFetching: isFetchingNextPage,
    error,
    isSuccess,
  }
}

export const useInstalledLatestVersion = (pluginIds: string[]) => {
  return useQuery<InstalledLatestVersionResponse>({
    queryKey: [NAME_SPACE, 'installedLatestVersion', pluginIds],
    queryFn: () => fetchInstalledLatestVersion(pluginIds),
    enabled: !!pluginIds.length,
    initialData: pluginIds.length ? undefined : { versions: {} },
  })
}

export const useInvalidateInstalledPluginList = () => {
  const queryClient = useQueryClient()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: useInstalledPluginListKey,
      },
    )
    invalidateAllBuiltInTools()
  }
}

export const useInstallPackageFromMarketPlace = (options?: MutateOptions<InstallPackageResponse, Error, string>) => {
  return useMutation({
    ...options,
    mutationFn: (uniqueIdentifier: string) => {
      return installPackageFromMarketplace(uniqueIdentifier)
    },
  })
}

export const useUpdatePackageFromMarketPlace = (options?: MutateOptions<InstallPackageResponse, Error, object>) => {
  return useMutation({
    ...options,
    mutationFn: (body: object) => {
      return updateFromMarketPlace(body as Record<string, string>)
    },
  })
}

export const usePluginDeclarationFromMarketPlace = (pluginUniqueIdentifier: string) => {
  return useQuery<{ manifest: PluginDeclaration }>({
    queryKey: [NAME_SPACE, 'pluginDeclaration', pluginUniqueIdentifier],
    queryFn: () => fetchPluginDeclarationFromMarketplace(pluginUniqueIdentifier),
    enabled: !!pluginUniqueIdentifier,
  })
}

export const useVersionListOfPlugin = (pluginID: string) => {
  return useQuery<{ data: VersionListResponse }>({
    enabled: !!pluginID,
    queryKey: [NAME_SPACE, 'versions', pluginID],
    queryFn: () => fetchPluginVersionList(pluginID),
  })
}
export const useInvalidateVersionListOfPlugin = () => {
  const queryClient = useQueryClient()
  return (pluginID: string) => {
    queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'versions', pluginID] })
  }
}

export const useInstallPackageFromLocal = () => {
  return useMutation({
    mutationFn: (uniqueIdentifier: string) => {
      return installPackageFromLocal(uniqueIdentifier)
    },
  })
}

export const useInstallPackageFromGitHub = () => {
  return useMutation({
    mutationFn: ({ repoUrl, selectedVersion, selectedPackage, uniqueIdentifier }: {
      repoUrl: string
      selectedVersion: string
      selectedPackage: string
      uniqueIdentifier: string
    }) => {
      return installPackageFromGitHub({ repoUrl, selectedVersion, selectedPackage, uniqueIdentifier })
    },
  })
}

export const useUploadGitHub = (payload: {
  repo: string
  version: string
  package: string
}) => {
  return useQuery<uploadGitHubResponse>({
    queryKey: [NAME_SPACE, 'uploadGitHub', payload],
    queryFn: () => uploadGitHubPackage(payload),
    retry: 0,
  })
}

export const useInstallOrUpdate = ({
  onSuccess,
}: {
  onSuccess?: (res: InstallStatusResponse[]) => void
}) => {
  const { mutateAsync: updatePackageFromMarketPlace } = useUpdatePackageFromMarketPlace()

  return useMutation({
    mutationFn: (data: {
      payload: Dependency[]
      plugin: Plugin[]
      installedInfo: Record<string, VersionInfo>
    }) => {
      const { payload, plugin, installedInfo } = data

      return Promise.all(payload.map(async (item, i) => {
        try {
          const orgAndName = `${plugin[i]?.org || plugin[i]?.author}/${plugin[i]?.name}`
          const installedPayload = installedInfo[orgAndName]
          const isInstalled = !!installedPayload
          let uniqueIdentifier = ''
          let taskId = ''
          let isFinishedInstallation = false

          if (item.type === 'github') {
            const data = item as GitHubItemAndMarketPlaceDependency
            // From local bundle don't have data.value.github_plugin_unique_identifier
            uniqueIdentifier = data.value.github_plugin_unique_identifier!
            if (!uniqueIdentifier) {
              const { unique_identifier } = await uploadGitHubPackage({
                repo: data.value.repo!,
                version: data.value.release! || data.value.version!,
                package: data.value.packages! || data.value.package!,
              })
              uniqueIdentifier = data.value.github_plugin_unique_identifier! || unique_identifier
              // has the same version, but not installed
              if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
                return {
                  status: TaskStatus.success,
                  taskId: '',
                  uniqueIdentifier: '',
                }
              }
            }
            if (!isInstalled) {
              const { task_id, all_installed } = await installPackageFromGitHub({
                repoUrl: data.value.repo!,
                selectedVersion: data.value.release! || data.value.version!,
                selectedPackage: data.value.packages! || data.value.package!,
                uniqueIdentifier,
              })
              taskId = task_id
              isFinishedInstallation = all_installed
            }
          }
          if (item.type === 'marketplace') {
            const data = item as GitHubItemAndMarketPlaceDependency
            uniqueIdentifier = data.value.marketplace_plugin_unique_identifier! || plugin[i]?.plugin_id
            if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
              return {
                status: TaskStatus.success,
                taskId: '',
                uniqueIdentifier: '',
              }
            }
            if (!isInstalled) {
              const { task_id, all_installed } = await installPackageFromMarketplace(uniqueIdentifier)
              taskId = task_id
              isFinishedInstallation = all_installed
            }
          }
          if (item.type === 'package') {
            const data = item as PackageDependency
            uniqueIdentifier = data.value.unique_identifier
            if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
              return {
                status: TaskStatus.success,
                taskId: '',
                uniqueIdentifier: '',
              }
            }
            if (!isInstalled) {
              const { task_id, all_installed } = await installPackageFromLocal(uniqueIdentifier)
              taskId = task_id
              isFinishedInstallation = all_installed
            }
          }
          if (isInstalled) {
            if (item.type === 'package') {
              await uninstallPlugin(installedPayload.installedId)
              const { task_id, all_installed } = await installPackageFromLocal(uniqueIdentifier)
              taskId = task_id
              isFinishedInstallation = all_installed
            }
            else {
              const { task_id, all_installed } = await updatePackageFromMarketPlace({
                original_plugin_unique_identifier: installedPayload?.uniqueIdentifier,
                new_plugin_unique_identifier: uniqueIdentifier,
              })
              taskId = task_id
              isFinishedInstallation = all_installed
            }
          }
          if (isFinishedInstallation) {
            return {
              status: TaskStatus.success,
              taskId: '',
              uniqueIdentifier: '',
            }
          }
          else {
            return {
              status: TaskStatus.running,
              taskId,
              uniqueIdentifier,
            }
          }
        }
        // eslint-disable-next-line unused-imports/no-unused-vars
        catch (e) {
          return Promise.resolve({ status: TaskStatus.failed, taskId: '', uniqueIdentifier: '' })
        }
      }))
    },
    onSuccess,
  })
}

export const useDebugKey = () => {
  return useQuery<DebugInfoTypes>({
    queryKey: [NAME_SPACE, 'debugKey'],
    queryFn: () => fetchDebugKey(),
  })
}

const useReferenceSettingKey = [NAME_SPACE, 'referenceSettings']
export const useReferenceSettings = () => {
  return useQuery({
    queryKey: useReferenceSettingKey,
    queryFn: () => fetchReferenceSettings(),
  })
}

export const useInvalidateReferenceSettings = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: useReferenceSettingKey,
      },
    )
  }
}

export const useMutationReferenceSettings = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationFn: (payload: ReferenceSetting) => {
      return updateReferenceSettings(payload)
    },
    onSuccess,
  })
}

export const useRemoveAutoUpgrade = () => {
  return useMutation({
    mutationFn: (payload: { plugin_id: string }) => {
      return excludeAutoUpgrade(payload)
    },
  })
}

export const useMutationPluginsFromMarketplace = () => {
  return useMutation({
    mutationFn: (pluginsSearchParams: PluginsSearchParams) => {
      return searchMarketplacePlugins(pluginsSearchParams)
    },
  })
}

export const useFetchPluginsInMarketPlaceByIds = (unique_identifiers: string[], options?: QueryOptions<{ data: PluginsFromMarketplaceResponse }>) => {
  return useQuery({
    ...options,
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByIds', unique_identifiers],
    queryFn: () => fetchMarketplacePluginsByIds(unique_identifiers),
    enabled: unique_identifiers?.filter(i => !!i).length > 0,
    retry: 0,
  })
}

export const useFetchPluginListOrBundleList = (pluginsSearchParams: PluginsSearchParams) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'fetchPluginListOrBundleList', pluginsSearchParams],
    queryFn: () => {
      return searchMarketplacePlugins(pluginsSearchParams)
    },
  })
}

export const useFetchPluginsInMarketPlaceByInfo = (infos: Record<string, any>[]) => {
  return useQuery<{ data: PluginsFromMarketplaceByInfoResponse }>({
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByInfo', infos],
    queryFn: () => fetchMarketplacePluginsByInfo(infos),
    enabled: infos?.filter(i => !!i).length > 0,
    retry: 0,
  })
}

const usePluginTaskListKey = [NAME_SPACE, 'pluginTaskList']
export const usePluginTaskList = (category?: PluginCategoryEnum | string) => {
  const [initialized, setInitialized] = useState(false)
  const {
    canManagement,
  } = useReferenceSetting()
  const { refreshPluginList } = useRefreshPluginList()
  const {
    data,
    isFetched,
    isRefetching,
    refetch,
    ...rest
  } = useQuery<{ tasks: PluginTask[] }>({
    enabled: canManagement,
    queryKey: usePluginTaskListKey,
    queryFn: () => fetchPluginTaskList(),
    refetchInterval: (lastQuery) => {
      const lastData = lastQuery.state.data
      const taskDone = lastData?.tasks.every(task => task.status === TaskStatus.success || task.status === TaskStatus.failed)
      return taskDone ? false : 5000
    },
  })

  useEffect(() => {
    // After first fetch, refresh plugin list each time all tasks are done
    // Skip initialization period, because the query cache is not updated yet
    if (!initialized || isRefetching)
      return

    const lastData = cloneDeep(data)
    const taskDone = lastData?.tasks.every(task => task.status === TaskStatus.success || task.status === TaskStatus.failed)
    const taskAllFailed = lastData?.tasks.every(task => task.status === TaskStatus.failed)
    if (taskDone && lastData?.tasks.length && !taskAllFailed)
      refreshPluginList(category ? { category } as any : undefined, !category)
  }, [isRefetching])

  useEffect(() => {
    setInitialized(true)
  }, [])

  const handleRefetch = useCallback(() => {
    refetch()
  }, [refetch])

  return {
    data,
    pluginTasks: data?.tasks || [],
    isFetched,
    handleRefetch,
    ...rest,
  }
}

export const useMutationClearTaskPlugin = () => {
  return useMutation({
    mutationFn: ({ taskId, pluginId }: { taskId: string, pluginId: string }) => {
      return deletePluginTask(taskId, pluginId)
    },
  })
}

export const useMutationClearAllTaskPlugin = () => {
  return useMutation({
    mutationFn: () => {
      return deleteAllPluginTasks()
    },
  })
}

export const usePluginManifestInfo = (pluginUID: string) => {
  return useQuery({
    enabled: !!pluginUID,
    queryKey: [[NAME_SPACE, 'manifest', pluginUID]],
    queryFn: () => fetchPluginManifestInfo(pluginUID),
    retry: 0,
  })
}

export const useDownloadPlugin = (info: { organization: string, pluginName: string, version: string }, needDownload: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'downloadPlugin', info],
    queryFn: () => downloadPlugin(info),
    enabled: needDownload,
    retry: 0,
  })
}

export const useMutationCheckDependencies = () => {
  return useMutation({
    mutationFn: (appId: string) => {
      return checkImportDependencies(appId)
    },
  })
}

export const useModelInList = (currentProvider?: ModelProvider, modelId?: string) => {
  const provider = currentProvider?.provider
  return useQuery({
    queryKey: ['modelInList', provider, modelId],
    queryFn: async () => {
      if (!modelId || !provider)
        return false
      try {
        const modelsData = await fetchModelProviderModelList(`/workspaces/current/model-providers/${provider}/models`)
        return !!modelId && !!modelsData.data.find(item => item.model === modelId)
      }
      catch {
        return false
      }
    },
    enabled: !!modelId && !!provider,
  })
}

export const usePluginInfo = (providerName?: string) => {
  return useQuery({
    queryKey: ['pluginInfo', providerName],
    queryFn: async () => {
      if (!providerName)
        return null
      const parts = providerName.split('/')
      const org = parts[0]
      const name = parts[1]
      try {
        const response = await fetchPluginInfoFromMarketPlace({ org, name })
        return response.data.plugin.category === PluginCategoryEnum.model ? response.data.plugin : null
      }
      catch {
        return null
      }
    },
    enabled: !!providerName,
  })
}

export const useFetchDynamicOptions = (plugin_id: string, provider: string, action: string, parameter: string, provider_type?: string, extra?: Record<string, any>) => {
  return useMutation({
    mutationFn: () => fetchPluginDynamicOptions({ plugin_id, provider, action, parameter, provider_type, extra }),
  })
}

export const usePluginReadme = ({ plugin_unique_identifier, language }: { plugin_unique_identifier: string, language?: string }) => {
  return useQuery({
    queryKey: ['pluginReadme', plugin_unique_identifier, language],
    queryFn: () => fetchPluginReadme({ plugin_unique_identifier, language }),
    enabled: !!plugin_unique_identifier,
    retry: 0,
  })
}

export const usePluginReadmeAsset = ({ file_name, plugin_unique_identifier }: { file_name?: string, plugin_unique_identifier?: string }) => {
  const normalizedFileName = file_name?.replace(/(^\.\/_assets\/|^_assets\/)/, '')
  return useQuery({
    queryKey: ['pluginReadmeAsset', plugin_unique_identifier, normalizedFileName],
    queryFn: () => fetchPluginAsset({ plugin_unique_identifier: plugin_unique_identifier || '', file_name: normalizedFileName || '' }),
    enabled: !!plugin_unique_identifier && !!file_name && /(^\.\/_assets|^_assets)/.test(file_name),
  })
}
