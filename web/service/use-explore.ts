import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { getAppAccessModeByAppId } from './explore'
import { fetchAppMeta, fetchAppParams } from './share'

const NAME_SPACE = 'explore'

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
