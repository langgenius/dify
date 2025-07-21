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
