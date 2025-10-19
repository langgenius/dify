import { useQuery } from '@tanstack/react-query'
import { fetchAppInfo, fetchAppMeta, fetchAppParams, getAppAccessModeByAppCode } from './share'

const NAME_SPACE = 'webapp'

export const useGetWebAppAccessModeByCode = (code: string | null) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appAccessMode', code],
    queryFn: () => getAppAccessModeByAppCode(code!),
    enabled: !!code,
    staleTime: 0, // backend change the access mode may cause the logic error. Because /permission API is no cached.
    gcTime: 0,
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
