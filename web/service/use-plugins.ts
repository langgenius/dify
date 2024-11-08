import type { InstalledPluginListResponse } from '@/app/components/plugins/types'
import { get } from './base'
import {
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
