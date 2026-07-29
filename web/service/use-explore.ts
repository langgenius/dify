import type { App, AppCategory } from '@/models/explore'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from './client'
import {
  fetchAppList,
  fetchInstalledAppMeta,
  fetchInstalledAppParams,
  fetchLearnDifyAppList,
  getAppAccessModeByAppId,
  normalizeInstalledApp,
  normalizeInstalledAppsResponse,
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

export const useGetInstalledApps = (name = '') => {
  const normalizedName = name.trim()
  const query = useInfiniteQuery({
    ...consoleQuery.installedApps.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: 20,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          ...(normalizedName ? { name: normalizedName } : {}),
        },
      }),
      getNextPageParam: (lastPage) =>
        lastPage.has_more && lastPage.next_cursor ? lastPage.next_cursor : undefined,
      initialPageParam: null as string | null,
    }),
    select: (data) => ({
      ...data,
      pages: data.pages.map(normalizeInstalledAppsResponse),
    }),
  })

  return {
    installedApps: query.data?.pages.flatMap((page) => page.installed_apps) ?? [],
    isPending: query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
  }
}

export const useGetInstalledApp = (installedAppId: string) => {
  return useQuery({
    ...consoleQuery.installedApps.byInstalledAppId.get.queryOptions({
      input: {
        params: {
          installed_app_id: installedAppId,
        },
      },
    }),
    select: normalizeInstalledApp,
  })
}

export const useUninstallApp = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.installedApps.byInstalledAppId.delete.mutationKey(),
    mutationFn: (appId: string) => uninstallApp(appId),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: consoleQuery.installedApps.get.key(),
      })
      client.invalidateQueries({
        queryKey: consoleQuery.installedApps.byInstalledAppId.get.key(),
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
        queryKey: consoleQuery.installedApps.get.key(),
      })
      client.invalidateQueries({
        queryKey: consoleQuery.installedApps.byInstalledAppId.get.key(),
      })
    },
  })
}

export const useGetInstalledAppAccessModeByAppId = (appId: string | null) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const webappAuthEnabled = systemFeatures.webapp_auth.enabled
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
