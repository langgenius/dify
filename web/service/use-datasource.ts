import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient } from './console'
import { narrowResponse } from './console/narrow-response'
import { useInvalid } from './use-base'

const NAME_SPACE = 'data-source-auth'

export const useGetDataSourceListAuth = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'list'],
    queryFn: () =>
      narrowResponse<{ result: DataSourceAuth[] }>(consoleClient.auth.plugin.datasource.list.get()),
    retry: 0,
  })
}

export const useInvalidDataSourceListAuth = () => {
  return useInvalid([NAME_SPACE, 'list'])
}

// !This hook is used for fetching the default data source list, which will be legacy and deprecated in the near future.
export const useGetDefaultDataSourceListAuth = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'default-list'],
    queryFn: () =>
      narrowResponse<{ result: DataSourceAuth[] }>(
        consoleClient.auth.plugin.datasource.defaultList.get(),
      ),
    retry: 0,
  })
}

export const useInvalidDefaultDataSourceListAuth = () => {
  return useInvalid([NAME_SPACE, 'default-list'])
}

export const useGetDataSourceOAuthUrl = (provider: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'oauth-url', provider],
    mutationFn: (credentialId?: string) => {
      return narrowResponse<{
        authorization_url: string
        state: string
        context_id: string
      }>(
        consoleClient.oauth.plugin.byProviderId.datasource.getAuthorizationUrl.get({
          params: { provider_id: provider },
          query: { credential_id: credentialId },
        }),
      )
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
    queryFn: () =>
      narrowResponse<{ result: DataSourceCredential[] }>(
        consoleClient.auth.plugin.datasource.byProviderId.get({
          params: { provider_id: `${pluginId}/${provider}` },
        }),
      ),
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
