import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchInstalledAppList, getAppAccessModeByAppId, uninstallApp, updatePinStatus } from './explore'
import { fetchAppMeta, fetchAppParams } from './share'

const NAME_SPACE = 'explore'

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
    mutationFn: ({ appId, isPinned }: { appId: string; isPinned: boolean }) => updatePinStatus(appId, isPinned),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [NAME_SPACE, 'installedApps'] })
    },
  })
}

export const useGetInstalledAppAccessModeByAppId = (appId: string | null) => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  return useQuery({
    queryKey: [NAME_SPACE, 'appAccessMode', appId],
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
      return fetchAppParams(true, appId)
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
      return fetchAppMeta(true, appId)
    },
    enabled: !!appId,
  })
}
