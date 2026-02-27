import type { App, AppCategory } from '@/models/explore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from './client'
import { fetchAppList, fetchBanners, fetchInstalledAppList, fetchInstalledAppMeta, fetchInstalledAppParams, getAppAccessModeByAppId, uninstallApp, updatePinStatus } from './explore'

type ExploreAppListData = {
  categories: AppCategory[]
  allList: App[]
}

export const useExploreAppList = () => {
  const locale = useLocale()
  const exploreAppsInput = locale
    ? { query: { language: locale } }
    : {}
  const exploreAppsLanguage = exploreAppsInput?.query?.language

  return useQuery<ExploreAppListData>({
    queryKey: [...consoleQuery.explore.apps.queryKey({ input: exploreAppsInput }), exploreAppsLanguage],
    queryFn: async () => {
      const { categories, recommended_apps } = await fetchAppList(exploreAppsLanguage)
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
  const installedAppId = appAccessModeInput.query.appId

  return useQuery({
    queryKey: [
      ...consoleQuery.explore.appAccessMode.queryKey({ input: appAccessModeInput }),
      systemFeatures.webapp_auth.enabled,
      installedAppId,
    ],
    queryFn: () => {
      if (systemFeatures.webapp_auth.enabled === false) {
        return {
          accessMode: AccessMode.PUBLIC,
        }
      }
      if (!installedAppId)
        return Promise.reject(new Error('App ID is required to get access mode'))

      return getAppAccessModeByAppId(installedAppId)
    },
    enabled: !!installedAppId,
  })
}

export const useGetInstalledAppParams = (appId: string | null) => {
  const installedAppParamsInput = { params: { appId: appId ?? '' } }
  const installedAppId = installedAppParamsInput.params.appId

  return useQuery({
    queryKey: [...consoleQuery.explore.installedAppParameters.queryKey({ input: installedAppParamsInput }), installedAppId],
    queryFn: () => {
      if (!installedAppId)
        return Promise.reject(new Error('App ID is required to get app params'))
      return fetchInstalledAppParams(installedAppId)
    },
    enabled: !!installedAppId,
  })
}

export const useGetInstalledAppMeta = (appId: string | null) => {
  const installedAppMetaInput = { params: { appId: appId ?? '' } }
  const installedAppId = installedAppMetaInput.params.appId

  return useQuery({
    queryKey: [...consoleQuery.explore.installedAppMeta.queryKey({ input: installedAppMetaInput }), installedAppId],
    queryFn: () => {
      if (!installedAppId)
        return Promise.reject(new Error('App ID is required to get app meta'))
      return fetchInstalledAppMeta(installedAppId)
    },
    enabled: !!installedAppId,
  })
}

export const useGetBanners = (locale?: string) => {
  const bannersInput = locale
    ? { query: { language: locale } }
    : {}
  const bannersLanguage = bannersInput?.query?.language

  return useQuery({
    queryKey: [...consoleQuery.explore.banners.queryKey({ input: bannersInput }), bannersLanguage],
    queryFn: () => {
      return fetchBanners(bannersLanguage)
    },
  })
}
