import type { FormSchema } from '@/app/components/base/form/types'
import type { Credential, CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { del, get, post } from './base'

export const fetchPluginCredentialInfo = (url: string) => {
  return get<{
    allow_custom_token?: boolean
    supported_credential_types: string[]
    credentials: Credential[]
    is_oauth_custom_client_enabled: boolean
  }>(url)
}

export const setPluginDefaultCredential = (url: string, id: string) => {
  return post(url, { body: { id } })
}

export const fetchPluginCredentialList = (url: string) => {
  return get(url)
}

export const addPluginCredential = (url: string, params: { credentials: Record<string, any>, type: CredentialTypeEnum, name?: string }) => {
  return post(url, { body: params })
}

export const updatePluginCredential = (url: string, params: { credential_id: string, credentials?: Record<string, any>, name?: string }) => {
  return post(url, { body: params })
}

export const deletePluginCredential = (url: string, params: { credential_id: string }) => {
  return post(url, { body: params })
}

export const fetchPluginCredentialSchema = (url: string) => {
  return get<FormSchema[]>(url)
}

export const fetchPluginOAuthUrl = (url: string) => {
  return get<{
    authorization_url: string
    state: string
    context_id: string
  }>(url)
}

export const fetchPluginOAuthClientSchema = (url: string) => {
  return get<{
    schema: FormSchema[]
    is_oauth_custom_client_enabled: boolean
    is_system_oauth_params_exists?: boolean
    client_params?: Record<string, any>
    redirect_uri?: string
  }>(url)
}

export const setPluginOAuthCustomClient = (url: string, params: { client_params: Record<string, any>, enable_oauth_custom_client: boolean }) => {
  return post<{ result: string }>(url, { body: params })
}

export const deletePluginOAuthCustomClient = (url: string) => {
  return del<{ result: string }>(url)
}
