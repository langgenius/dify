import { useQuery } from '@tanstack/react-query'
import { fetchTryAppInfo } from './try-app'
import { AppSourceType, fetchAppParams } from './share'

const NAME_SPACE = 'try-app'

export const useGetTryAppInfo = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appInfo'],
    queryFn: () => {
      return fetchTryAppInfo(appId)
    },
  })
}

export const useGetTryAppParams = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appParams'],
    queryFn: () => {
      return fetchAppParams(AppSourceType.webApp) // todo: wait api
    },
  })
}
