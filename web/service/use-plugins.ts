import { useCallback, useState } from 'react'
import type {
  DebugInfo as DebugInfoTypes,
  Dependency,
  InstallPackageResponse,
  InstalledPluginListResponse,
  Permissions,
  PluginTask,
  PluginsFromMarketplaceResponse,
  uploadGitHubResponse,
} from '@/app/components/plugins/types'
import type {
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import { get, post, postMarketplace } from './base'
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
    mutationFn: (payload: Dependency[]) => {
      return Promise.all(payload.map(async (item) => {
        try {
          if (item.type === 'github') {
            await post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
              body: {
                repo: item.value.repo!,
                version: item.value.version!,
                package: item.value.package!,
                plugin_unique_identifier: item.value.github_plugin_unique_identifier!,
              },
            })
            return ({ success: true })
          }
          await post<InstallPackageResponse>('/workspaces/current/plugin/install/marketplace', {
            body: {
              plugin_unique_identifiers: [item.value.plugin_unique_identifier!],
            },
          })
          return ({ success: true })
        }
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
      const taskDone = currentData.tasks.every(task => task.total_plugins === task.completed_plugins)

      if (taskDone)
        setEnabled(false)

      return currentData
    },
    // refetchInterval: 5000,
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
