import type { App, AppCategory } from '@/models/explore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from './client'
import {
  fetchAppList,
  fetchInstalledAppList,
  fetchInstalledAppMeta,
  fetchInstalledAppParams,
  fetchLearnDifyAppList,
  getAppAccessModeByAppId,
  uninstallApp,
  updatePinStatus,
} from './explore'

type ExploreAppListData = {
  categories: AppCategory[]
  allList: App[]
}

export const useExploreAppList = (options: { enabled?: boolean } = {}) => {
  const locale = useLocale()
  const exploreAppsInput = locale ? { query: { language: locale } } : {}
  const exploreAppsLanguage = exploreAppsInput?.query?.language

  return useQuery<ExploreAppListData>({
    queryKey: [
      ...consoleQuery.explore.apps.get.queryKey({ input: exploreAppsInput }),
      exploreAppsLanguage,
    ],
    queryFn: async () => {
      const { categories, recommended_apps } = await fetchAppList(exploreAppsLanguage)
      return {
        categories,
        allList: [...recommended_apps].sort((a, b) => a.position - b.position),
      }
    },
    enabled: options.enabled,
  })
}

export const useLearnDifyAppList = () => {
  const locale = useLocale()
  const learnDifyAppsInput = locale ? { query: { language: locale } } : {}
  const learnDifyAppsLanguage = learnDifyAppsInput?.query?.language

  return useQuery({
    queryKey: [
      ...consoleQuery.explore.apps.learnDify.get.queryKey({ input: learnDifyAppsInput }),
      learnDifyAppsLanguage,
    ],
    queryFn: async () => {
      const { recommended_apps } = await fetchLearnDifyAppList(learnDifyAppsLanguage)
      return [...recommended_apps].sort((a, b) => a.position - b.position)
    },
  })
}

export const useGetInstalledApps = () => {
  return useQuery({
    queryKey: consoleQuery.installedApps.get.queryKey({ input: {} }),
    queryFn: () => {
      return fetchInstalledAppList()
    },
  })
}

export const useUninstallApp = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.installedApps.byInstalledAppId.delete.mutationKey(),
    mutationFn: (appId: string) => uninstallApp(appId),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: consoleQuery.installedApps.get.queryKey({ input: {} }),
      })
    },
  })
}

export const useUpdateAppPinStatus = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.installedApps.byInstalledAppId.patch.mutationKey(),
    mutationFn: ({ appId, isPinned }: { appId: string; isPinned: boolean }) =>
      updatePinStatus(appId, isPinned),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: consoleQuery.installedApps.get.queryKey({ input: {} }),
      })
    },
  })
}

export const useGetInstalledAppAccessModeByAppId = (appId: string | null) => {
  // useQuery (not useSuspenseQuery) to keep this service hook's call contract
  // unchanged from the zustand era: callers should not need a Suspense boundary.
  // First-fetch undefined is bridged via `?? false` so the inner queryKey is stable.
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const webappAuthEnabled = systemFeatures?.webapp_auth.enabled ?? false
  const appAccessModeInput = { query: { appId: appId ?? '' } }
  const installedAppId = appAccessModeInput.query.appId

  return useQuery({
    queryKey: [
      ...consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.queryKey({
        input: appAccessModeInput,
      }),
      webappAuthEnabled,
      installedAppId,
    ],
    queryFn: () => {
      if (webappAuthEnabled === false) {
        return {
          accessMode: AccessMode.PUBLIC,
        }
      }
      if (!installedAppId) return Promise.reject(new Error('App ID is required to get access mode'))

      return getAppAccessModeByAppId(installedAppId)
    },
    enabled: !!installedAppId,
  })
}

export const useGetInstalledAppParams = (appId: string | null) => {
  const installedAppParamsInput = { params: { installed_app_id: appId ?? '' } }
  const installedAppId = installedAppParamsInput.params.installed_app_id

  return useQuery({
    queryKey: [
      ...consoleQuery.installedApps.byInstalledAppId.parameters.get.queryKey({
        input: installedAppParamsInput,
      }),
      installedAppId,
    ],
    queryFn: () => {
      if (!installedAppId) return Promise.reject(new Error('App ID is required to get app params'))
      return fetchInstalledAppParams(installedAppId)
    },
    enabled: !!installedAppId,
  })
}

export const useGetInstalledAppMeta = (appId: string | null) => {
  const installedAppMetaInput = { params: { installed_app_id: appId ?? '' } }
  const installedAppId = installedAppMetaInput.params.installed_app_id

  return useQuery({
    queryKey: [
      ...consoleQuery.installedApps.byInstalledAppId.meta.get.queryKey({
        input: installedAppMetaInput,
      }),
      installedAppId,
    ],
    queryFn: () => {
      if (!installedAppId) return Promise.reject(new Error('App ID is required to get app meta'))
      return fetchInstalledAppMeta(installedAppId)
    },
    enabled: !!installedAppId,
  })
}
