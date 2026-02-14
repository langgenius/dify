import type { App, AppCategory } from '@/models/explore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from './client'
import { fetchAppList, fetchBanners, fetchInstalledAppList, getAppAccessModeByAppId, uninstallApp, updatePinStatus } from './explore'
import { AppSourceType, fetchAppMeta, fetchAppParams } from './share'

type ExploreAppListData = {
  categories: AppCategory[]
  allList: App[]
}

export const useExploreAppList = () => {
  const locale = useLocale()
  const exploreAppsInput = locale
    ? { query: { language: locale } }
    : {}

  return useQuery<ExploreAppListData>({
    queryKey: [...consoleQuery.explore.apps.queryKey({ input: exploreAppsInput }), locale],
    queryFn: async () => {
      const { categories, recommended_apps } = await fetchAppList(locale)
      return {
        categories,
        allList: [...recommended_apps].sort((a, b) => a.position - b.position),
      }
    },
  })
}

export const useGetInstalledApps = () => {
  return useQuery({
    queryKey: consoleQuery.explore.installedApps.queryKey({ input: {} }),
    queryFn: () => {
      return fetchInstalledAppList()
    },
  })
}

export const useUninstallApp = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.explore.uninstallInstalledApp.mutationKey(),
    mutationFn: (appId: string) => uninstallApp(appId),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: consoleQuery.explore.installedApps.queryKey({ input: {} }),
      })
    },
  })
}

export const useUpdateAppPinStatus = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.explore.updateInstalledApp.mutationKey(),
    mutationFn: ({ appId, isPinned }: { appId: string, isPinned: boolean }) => updatePinStatus(appId, isPinned),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: consoleQuery.explore.installedApps.queryKey({ input: {} }),
      })
    },
  })
}

export const useGetInstalledAppAccessModeByAppId = (appId: string | null) => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const appAccessModeInput = { query: { appId: appId ?? '' } }

  return useQuery({
    queryKey: [
      ...consoleQuery.explore.appAccessMode.queryKey({ input: appAccessModeInput }),
      systemFeatures.webapp_auth.enabled,
      appId,
    ],
    queryFn: () => {
      if (systemFeatures.webapp_auth.enabled === false) {
        return {
          accessMode: AccessMode.PUBLIC,
        }
      }
      if (!appId)
        return Promise.reject(new Error('App code is required to get access mode'))

      return getAppAccessModeByAppId(appId)
    },
    enabled: !!appId,
  })
}

export const useGetInstalledAppParams = (appId: string | null) => {
  return useQuery({
    queryKey: ['explore', 'appParams', appId],
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
    queryKey: ['explore', 'appMeta', appId],
    queryFn: () => {
      if (!appId || appId.length === 0)
        return Promise.reject(new Error('App ID is required to get app meta'))
      return fetchAppMeta(AppSourceType.installedApp, appId)
    },
    enabled: !!appId,
  })
}

export const useGetBanners = (locale?: string) => {
  const bannersInput = locale
    ? { query: { language: locale } }
    : {}

  return useQuery({
    queryKey: [...consoleQuery.explore.banners.queryKey({ input: bannersInput }), locale],
    queryFn: () => {
      return fetchBanners(locale)
    },
  })
}
