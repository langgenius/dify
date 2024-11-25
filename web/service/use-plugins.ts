import { useCallback, useState } from 'react'
import type {
  DebugInfo as DebugInfoTypes,
  Dependency,
  GitHubItemAndMarketPlaceDependency,
  InstallPackageResponse,
  InstalledPluginListResponse,
  PackageDependency,
  Permissions,
  Plugin,
  PluginTask,
  PluginsFromMarketplaceByInfoResponse,
  PluginsFromMarketplaceResponse,
  VersionListResponse,
  uploadGitHubResponse,
} from '@/app/components/plugins/types'
import { TaskStatus } from '@/app/components/plugins/types'
import type {
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import { get, getMarketplace, post, postMarketplace } from './base'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useStore as usePluginDependencyStore } from '@/app/components/workflow/plugin-dependency/store'
import { useInvalidateAllBuiltInTools } from './use-tools'

const NAME_SPACE = 'plugins'

const useInstalledPluginListKey = [NAME_SPACE, 'installedPluginList']
export const useInstalledPluginList = () => {
  return useQuery<InstalledPluginListResponse>({
    queryKey: useInstalledPluginListKey,
    queryFn: () => get<InstalledPluginListResponse>('/workspaces/current/plugin/list'),
  })
}

export const useInvalidateInstalledPluginList = () => {
  const queryClient = useQueryClient()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: useInstalledPluginListKey,
      })
    invalidateAllBuiltInTools()
  }
}

export const useInstallPackageFromMarketPlace = () => {
  return useMutation({
    mutationFn: (uniqueIdentifier: string) => {
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/marketplace', { body: { plugin_unique_identifiers: [uniqueIdentifier] } })
    },
  })
}

export const useVersionListOfPlugin = (pluginID: string) => {
  return useQuery<{ data: VersionListResponse }>({
    queryKey: [NAME_SPACE, 'versions', pluginID],
    queryFn: () => getMarketplace<{ data: VersionListResponse }>(`/plugins/${pluginID}/versions`, { params: { page: 1, page_size: 100 } }),
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
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/pkg', {
        body: { plugin_unique_identifiers: [uniqueIdentifier] },
      })
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
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
        body: {
          repo: repoUrl,
          version: selectedVersion,
          package: selectedPackage,
          plugin_unique_identifier: uniqueIdentifier,
        },
      })
    },
  })
}

export const useUploadGitHub = (payload: {
  repo: string
  version: string
  package: string
}) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'uploadGitHub', payload],
    queryFn: () => post<uploadGitHubResponse>('/workspaces/current/plugin/upload/github', {
      body: payload,
    }),
  })
}

export const useInstallFromMarketplaceAndGitHub = ({
  onSuccess,
}: {
  onSuccess?: (res: { success: boolean }[]) => void
}) => {
  return useMutation({
    mutationFn: (data: {
      payload: Dependency[],
      plugin: Plugin[],
    }) => {
      const { payload, plugin } = data
      return Promise.all(payload.map(async (item, i) => {
        try {
          if (item.type === 'github') {
            const data = item as GitHubItemAndMarketPlaceDependency
            let pluginId = ''
            // From local bundle don't have data.value.github_plugin_unique_identifier
            if (!data.value.github_plugin_unique_identifier) {
              const { unique_identifier } = await post<uploadGitHubResponse>('/workspaces/current/plugin/upload/github', {
                body: {
                  repo: data.value.repo!,
                  version: data.value.release! || data.value.version!,
                  package: data.value.packages! || data.value.package!,
                },
              })
              pluginId = unique_identifier
            }
            await post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
              body: {
                repo: data.value.repo!,
                version: data.value.release! || data.value.version!,
                package: data.value.packages! || data.value.package!,
                plugin_unique_identifier: data.value.github_plugin_unique_identifier! || pluginId,
              },
            })
          }
          if (item.type === 'marketplace') {
            const data = item as GitHubItemAndMarketPlaceDependency

            await post<InstallPackageResponse>('/workspaces/current/plugin/install/marketplace', {
              body: {
                plugin_unique_identifiers: [data.value.plugin_unique_identifier! || plugin[i]?.plugin_id],
              },
            })
          }
          if (item.type === 'package') {
            const data = item as PackageDependency
            await post<InstallPackageResponse>('/workspaces/current/plugin/install/pkg', {
              body: {
                plugin_unique_identifiers: [data.value.unique_identifier],
              },
            })
          }
          return ({ success: true })
        }
        // eslint-disable-next-line unused-imports/no-unused-vars
        catch (e) {
          return Promise.resolve({ success: false })
        }
      }))
    },
    onSuccess,
  })
}

export const useDebugKey = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'debugKey'],
    queryFn: () => get<DebugInfoTypes>('/workspaces/current/plugin/debugging-key'),
  })
}

const usePermissionsKey = [NAME_SPACE, 'permissions']
export const usePermissions = () => {
  return useQuery({
    queryKey: usePermissionsKey,
    queryFn: () => get<Permissions>('/workspaces/current/plugin/permission/fetch'),
  })
}

export const useInvalidatePermissions = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: usePermissionsKey,
      })
  }
}

export const useMutationPermissions = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationFn: (payload: Permissions) => {
      return post('/workspaces/current/plugin/permission/change', { body: payload })
    },
    onSuccess,
  })
}

export const useMutationPluginsFromMarketplace = () => {
  return useMutation({
    mutationFn: (pluginsSearchParams: PluginsSearchParams) => {
      const {
        query,
        sortBy,
        sortOrder,
        category,
        tags,
      } = pluginsSearchParams
      return postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/search/basic', {
        body: {
          page: 1,
          page_size: 10,
          query,
          sort_by: sortBy,
          sort_order: sortOrder,
          category: category !== 'all' ? category : '',
          tags,
        },
      })
    },
  })
}

export const useFetchPluginsInMarketPlaceByIds = (unique_identifiers: string[]) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByIds', unique_identifiers],
    queryFn: () => postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/identifier/batch', {
      body: {
        unique_identifiers,
      },
    }),
    enabled: unique_identifiers?.filter(i => !!i).length > 0,
    retry: 0,
  })
}

export const useFetchPluginsInMarketPlaceByInfo = (infos: Record<string, any>[]) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByInfo', infos],
    queryFn: () => postMarketplace<{ data: PluginsFromMarketplaceByInfoResponse }>('/plugins/versions/batch', {
      body: {
        plugin_tuples: infos.map(info => ({
          org: info.organization,
          name: info.plugin,
          version: info.version,
        })),
      },
    }),
    enabled: infos?.filter(i => !!i).length > 0,
    retry: 0,
  })
}

const usePluginTaskListKey = [NAME_SPACE, 'pluginTaskList']
export const usePluginTaskList = () => {
  const [enabled, setEnabled] = useState(true)
  const {
    data,
    isFetched,
    refetch,
    ...rest
  } = useQuery({
    queryKey: usePluginTaskListKey,
    queryFn: async () => {
      const currentData = await get<{ tasks: PluginTask[] }>('/workspaces/current/plugin/tasks?page=1&page_size=100')
      const taskDone = currentData.tasks.every(task => task.status === TaskStatus.success)

      if (taskDone)
        setEnabled(false)

      return currentData
    },
    refetchInterval: 5000,
    enabled,
  })
  const handleRefetch = useCallback(() => {
    setEnabled(true)
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
    mutationFn: ({ taskId, pluginId }: { taskId: string; pluginId: string }) => {
      return post<{ success: boolean }>(`/workspaces/current/plugin/tasks/${taskId}/delete/${pluginId}`)
    },
  })
}

export const useMutationClearAllTaskPlugin = () => {
  return useMutation({
    mutationFn: () => {
      return post<{ success: boolean }>('/workspaces/current/plugin/tasks/delete_all')
    },
  })
}

export const useMutationCheckDependenciesBeforeImportDSL = () => {
  const mutation = useMutation({
    mutationFn: ({ dslString, url }: { dslString?: string, url?: string }) => {
      if (url) {
        return post<{ leaked: Dependency[] }>(
          '/apps/import/url/dependencies/check',
          {
            body: {
              url,
            },
          },
        )
      }
      return post<{ leaked: Dependency[] }>(
        '/apps/import/dependencies/check',
        {
          body: {
            data: dslString,
          },
        })
    },
    onSuccess: (data) => {
      const { setDependencies } = usePluginDependencyStore.getState()
      setDependencies(data.leaked || [])
    },
  })

  return mutation
}

export const useDownloadPlugin = (info: { organization: string; pluginName: string; version: string }, needDownload: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'downloadPlugin', info],
    queryFn: () => getMarketplace<Blob>(`/plugins/${info.organization}/${info.pluginName}/${info.version}/download`),
    enabled: needDownload,
    retry: 0,
  })
}
