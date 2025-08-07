import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { get } from './base'
import { useInvalid } from './use-base'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'

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

export const useGetDataSourceOAuthUrl = (
  provider: string,
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'oauth-url', provider],
    mutationFn: (credentialId?: string) => {
      return get<
        {
          authorization_url: string
          state: string
          context_id: string
        }>(`/oauth/plugin/${provider}/datasource/get-authorization-url?credential_id=${credentialId}`)
    },
  })
}

export const useGetDataSourceAuth = ({
  pluginId,
  provider,
}: {
  pluginId: string
  provider: string
}) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'specific-data-source', pluginId, provider],
    queryFn: () => get<{ result: DataSourceCredential[] }>(`/auth/plugin/datasource/${pluginId}/${provider}`),
    retry: 0,
  })
}

export const useInvalidDataSourceAuth = ({
  pluginId,
  provider,
}: {
  pluginId: string
  provider: string
}) => {
  return useInvalid([NAME_SPACE, 'specific-data-source', pluginId, provider])
}
