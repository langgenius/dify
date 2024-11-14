import { get } from './base'
import type { App } from '@/types/app'
import { useInvalid } from './use-base'
import { useQuery } from '@tanstack/react-query'

const NAME_SPACE = 'apps'

// TODO paging for list
const useAppFullListKey = [NAME_SPACE, 'full-list']
export const useAppFullList = () => {
  return useQuery<App[]>({
    queryKey: useAppFullListKey,
    queryFn: () => get<App[]>('/apps', { params: { page: 1, limit: 100 } }),
  })
}

export const useInvalidateAppFullList = () => {
  return useInvalid(useAppFullListKey)
}

export const useAppDetail = (appID: string) => {
  return useQuery<App>({
    queryKey: [NAME_SPACE, 'detail', appID],
    queryFn: () => get<App>(`/apps/${appID}`),
  })
}
