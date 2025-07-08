import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { fetchAppInfo, fetchAppMeta, fetchAppParams, getAppAccessModeByAppCode } from './share'

const NAME_SPACE = 'webapp'

export const useGetWebAppAccessModeByCode = (code: string | null) => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  return useQuery({
    queryKey: [NAME_SPACE, 'appAccessMode', code],
    queryFn: () => {
      if (systemFeatures.webapp_auth.enabled === false) {
        return {
          accessMode: AccessMode.PUBLIC,
        }
      }
      if (!code || code.length === 0)
        return Promise.reject(new Error('App code is required to get access mode'))

      return getAppAccessModeByAppCode(code)
    },
    enabled: !!code,
  })
}

export const useGetWebAppInfo = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appInfo'],
    queryFn: () => {
      return fetchAppInfo()
    },
  })
}

export const useGetWebAppParams = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appParams'],
    queryFn: () => {
      return fetchAppParams(false)
    },
  })
}

export const useGetWebAppMeta = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appMeta'],
    queryFn: () => {
      return fetchAppMeta(false)
    },
  })
}
