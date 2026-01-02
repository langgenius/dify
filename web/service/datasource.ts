import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import { get } from './base'

export const fetchDataSourceListAuth = () => {
  return get<{ result: DataSourceAuth[] }>('/auth/plugin/datasource/list')
}

export const fetchDefaultDataSourceListAuth = () => {
  return get<{ result: DataSourceAuth[] }>('/auth/plugin/datasource/default-list')
}

export const fetchDataSourceOAuthUrl = (provider: string, credentialId?: string) => {
  return get<{
    authorization_url: string
    state: string
    context_id: string
  }>(`/oauth/plugin/${provider}/datasource/get-authorization-url?credential_id=${credentialId}`)
}

export const fetchDataSourceAuth = (pluginId: string, provider: string) => {
  return get<{ result: DataSourceCredential[] }>(`/auth/plugin/datasource/${pluginId}/${provider}`)
}
