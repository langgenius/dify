import type { App, AppCategory } from '@/models/explore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode } from '@/models/access-control'
import { fetchAppList, fetchBanners, fetchInstalledAppList, getAppAccessModeByAppId, uninstallApp, updatePinStatus } from './explore'
import { AppSourceType, fetchAppMeta, fetchAppParams } from './share'

const NAME_SPACE = 'explore'

type ExploreAppListData = {
  categories: AppCategory[]
  allList: App[]
}

export const useExploreAppList = () => {
  return useQuery<ExploreAppListData>({
    queryKey: [NAME_SPACE, 'appList'],
    queryFn: async () => {
      const { categories, recommended_apps } = await fetchAppList()
      return {
        categories,
        allList: [...recommended_apps].sort((a, b) => a.position - b.position),
      }
    },
  })
}

export const useGetInstalledApps = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'installedApps'],
    queryFn: () => {
      return fetchInstalledAppList()
    },
  })
}

export const useUninstallApp = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'uninstallApp'],
    mutationFn: (appId: string) => uninstallApp(appId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [NAME_SPACE, 'installedApps'] })
    },
  })
}

export const useUpdateAppPinStatus = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'updateAppPinStatus'],
    mutationFn: ({ appId, isPinned }: { appId: string, isPinned: boolean }) => updatePinStatus(appId, isPinned),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [NAME_SPACE, 'installedApps'] })
    },
  })
}

export const useGetInstalledAppAccessModeByAppId = (appId: string | null) => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  return useQuery({
    queryKey: [NAME_SPACE, 'appAccessMode', appId, systemFeatures.webapp_auth.enabled],
    queryFn: () => {
      if (systemFeatures.webapp_auth.enabled === false) {
        return {
          accessMode: AccessMode.PUBLIC,
        }
      }
      if (!appId || appId.length === 0)
        return Promise.reject(new Error('App code is required to get access mode'))

      return getAppAccessModeByAppId(appId)
    },
    enabled: !!appId,
  })
}

export const useGetInstalledAppParams = (appId: string | null) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appParams', appId],
    queryFn: () => {
      if (!appId || appId.length === 0)
        return Promise.reject(new Error('App ID is required to get app params'))
      return fetchAppParams(AppSourceType.installedApp, appId)
    },
    enabled: !!appId,
  })
}

export const useGetInstalledAppMeta = (appId: string | null) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appMeta', appId],
    queryFn: () => {
      if (!appId || appId.length === 0)
        return Promise.reject(new Error('App ID is required to get app meta'))
      return fetchAppMeta(AppSourceType.installedApp, appId)
    },
    enabled: !!appId,
  })
}

export const useGetBanners = (locale?: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'banners', locale],
    queryFn: () => {
      return fetchBanners(locale)
    },
  })
}
