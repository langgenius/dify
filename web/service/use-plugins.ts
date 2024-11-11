import type {
  DebugInfo as DebugInfoTypes,
  InstallPackageResponse,
  InstalledPluginListResponse,
  Permissions,
  PluginsFromMarketplaceResponse,
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
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: useInstalledPluginListKey,
      })
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
