import type { Fetcher } from 'swr'
import { get, post, del, put } from './base'
import type {
  CommonResponse, LangGeniusVersionResponse, OauthResponse,
  TenantInfoResponse, UserProfileOriginResponse, Member,
  AccountIntegrate, Provider, ProviderAzureToken, IWorkspace
} from '@/models/common'
import type {
  ValidateOpenAIKeyResponse,
  UpdateOpenAIKeyResponse
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

export const inviteMember: Fetcher<CommonResponse & { account: Member }, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse & { account: Member }>
}

export const updateMemberRole: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return put(url, { body }) as Promise<CommonResponse>
}

export const deleteMemberOrCancelInvitation: Fetcher<CommonResponse, { url: string; }> = ({ url }) => {
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

