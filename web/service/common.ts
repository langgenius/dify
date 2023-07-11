import type { Fetcher } from 'swr'
import { del, get, patch, post, put } from './base'
import type {
  AccountIntegrate, CommonResponse, DataSourceNotion,
  IWorkspace, LangGeniusVersionResponse, Member,
  OauthResponse, Provider, ProviderAzureToken, TenantInfoResponse,
  UserProfileOriginResponse,
} from '@/models/common'
import type {
  UpdateOpenAIKeyResponse,
  ValidateOpenAIKeyResponse,
} from '@/models/app'

export const login: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse>
}

export const setup: Fetcher<CommonResponse, { body: Record<string, any> }> = ({ body }) => {
  return post('/setup', { body }) as Promise<CommonResponse>
}

export const fetchUserProfile: Fetcher<UserProfileOriginResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, params, { needAllResponseContent: true }) as Promise<UserProfileOriginResponse>
}

export const updateUserProfile: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse>
}

export const fetchTenantInfo: Fetcher<TenantInfoResponse, { url: string }> = ({ url }) => {
  return get(url) as Promise<TenantInfoResponse>
}

export const logout: Fetcher<CommonResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, params) as Promise<CommonResponse>
}

export const fetchLanggeniusVersion: Fetcher<LangGeniusVersionResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<LangGeniusVersionResponse>
}

export const oauth: Fetcher<OauthResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<OauthResponse>
}

export const oneMoreStep: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse>
}

export const fetchMembers: Fetcher<{ accounts: Member[] | null }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<{ accounts: Member[] | null }>
}

export const fetchProviders: Fetcher<Provider[] | null, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<Provider[] | null>
}

export const validateProviderKey: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<ValidateOpenAIKeyResponse>
}
export const updateProviderAIKey: Fetcher<UpdateOpenAIKeyResponse, { url: string; body: { token: string | ProviderAzureToken } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<UpdateOpenAIKeyResponse>
}

export const fetchAccountIntegrates: Fetcher<{ data: AccountIntegrate[] | null }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<{ data: AccountIntegrate[] | null }>
}

export const inviteMember: Fetcher<CommonResponse & { account: Member; invite_url: string }, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse & { account: Member; invite_url: string }>
}

export const updateMemberRole: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return put(url, { body }) as Promise<CommonResponse>
}

export const deleteMemberOrCancelInvitation: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return del(url) as Promise<CommonResponse>
}

export const fetchFilePreview: Fetcher<{ content: string }, { fileID: string }> = ({ fileID }) => {
  return get(`/files/${fileID}/preview`) as Promise<{ content: string }>
}

export const fetchWorkspaces: Fetcher<{ workspaces: IWorkspace[] }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<{ workspaces: IWorkspace[] }>
}

export const switchWorkspace: Fetcher<CommonResponse & { new_tenant: IWorkspace }, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse & { new_tenant: IWorkspace }>
}

export const fetchDataSource: Fetcher<{ data: DataSourceNotion[] }, { url: string }> = ({ url }) => {
  return get(url) as Promise<{ data: DataSourceNotion[] }>
}

export const syncDataSourceNotion: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return get(url) as Promise<CommonResponse>
}

export const updateDataSourceNotionAction: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return patch(url) as Promise<CommonResponse>
}

export const invitationCheck: Fetcher<CommonResponse & { is_valid: boolean; workspace_name: string }, { url: string; params: { workspace_id: string; email: string; token: string } }> = ({ url, params }) => {
  return get(url, { params }) as Promise<CommonResponse & { is_valid: boolean; workspace_name: string }>
}

export const activateMember: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse>
}
