import type { DebugInfo as DebugInfoTypes, InstalledPluginListResponse, Permissions } from '@/app/components/plugins/types'
import { get, post } from './base'
import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  useQuery,
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
