import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import { useInvalid } from './use-base'
import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'

const NAME_SPACE = 'data-source-auth'

export const useGetDataSourceListAuth = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'list'],
    queryFn: () => get<{ result: DataSourceAuth[] }>('/auth/plugin/datasource/list'),
    retry: 0,
  })
}

export const useInvalidDataSourceListAuth = (
) => {
  return useInvalid([NAME_SPACE, 'list'])
}

// !This hook is used for fetching the default data source list, which will be legacy and deprecated in the near future.
export const useGetDefaultDataSourceListAuth = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'default-list'],
    queryFn: () => get<{ result: DataSourceAuth[] }>('/auth/plugin/datasource/default-list'),
    retry: 0,
  })
}

export const useInvalidDefaultDataSourceListAuth = (
) => {
  return useInvalid([NAME_SPACE, 'default-list'])
}
