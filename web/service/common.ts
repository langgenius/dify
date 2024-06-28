import type { Fetcher } from 'swr'
import { del, get, patch, post, put } from './base'
import type {
  AccountIntegrate,
  ApiBasedExtension,
  CodeBasedExtension,
  CommonResponse,
  DataSourceNotion,
  FileUploadConfigResponse,
  ICurrentWorkspace,
  IWorkspace,
  InitValidateStatusResponse,
  InvitationResponse,
  LangGeniusVersionResponse,
  Member,
  ModerateResponse,
  OauthResponse,
  PluginProvider,
  Provider,
  ProviderAnthropicToken,
  ProviderAzureToken,
  SetupStatusResponse,
  UserProfileOriginResponse,
} from '@/models/common'
import type {
  UpdateOpenAIKeyResponse,
  ValidateOpenAIKeyResponse,
} from '@/models/app'
import type {
  DefaultModelResponse,
  Model,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelParameterRule,
  ModelProvider,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import type { SystemFeatures } from '@/types/feature'

export const login: Fetcher<CommonResponse & { data: string }, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse & { data: string }>
}

export const setup: Fetcher<CommonResponse, { body: Record<string, any> }> = ({ body }) => {
  return post<CommonResponse>('/setup', { body })
}

export const initValidate: Fetcher<CommonResponse, { body: Record<string, any> }> = ({ body }) => {
  return post<CommonResponse>('/init', { body })
}

export const fetchInitValidateStatus = () => {
  return get<InitValidateStatusResponse>('/init')
}

export const fetchSetupStatus = () => {
  return get<SetupStatusResponse>('/setup')
}

export const fetchUserProfile: Fetcher<UserProfileOriginResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<UserProfileOriginResponse>(url, params, { needAllResponseContent: true })
}

export const updateUserProfile: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const logout: Fetcher<CommonResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<CommonResponse>(url, params)
}

export const fetchLanggeniusVersion: Fetcher<LangGeniusVersionResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<LangGeniusVersionResponse>(url, { params })
}

export const oauth: Fetcher<OauthResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<OauthResponse>(url, { params })
}

export const oneMoreStep: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const fetchMembers: Fetcher<{ accounts: Member[] | null }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<{ accounts: Member[] | null }>(url, { params })
}

export const fetchProviders: Fetcher<Provider[] | null, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<Provider[] | null>(url, { params })
}

export const validateProviderKey: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}
export const updateProviderAIKey: Fetcher<UpdateOpenAIKeyResponse, { url: string; body: { token: string | ProviderAzureToken | ProviderAnthropicToken } }> = ({ url, body }) => {
  return post<UpdateOpenAIKeyResponse>(url, { body })
}

export const fetchAccountIntegrates: Fetcher<{ data: AccountIntegrate[] | null }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<{ data: AccountIntegrate[] | null }>(url, { params })
}

export const inviteMember: Fetcher<InvitationResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<InvitationResponse>(url, { body })
}

export const updateMemberRole: Fetcher<CommonResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return put<CommonResponse>(url, { body })
}

export const deleteMemberOrCancelInvitation: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return del<CommonResponse>(url)
}

export const fetchFilePreview: Fetcher<{ content: string }, { fileID: string }> = ({ fileID }) => {
  return get<{ content: string }>(`/files/${fileID}/preview`)
}

export const fetchCurrentWorkspace: Fetcher<ICurrentWorkspace, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<ICurrentWorkspace>(url, { params })
}

export const updateCurrentWorkspace: Fetcher<ICurrentWorkspace, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<ICurrentWorkspace>(url, { body })
}

export const fetchWorkspaces: Fetcher<{ workspaces: IWorkspace[] }, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<{ workspaces: IWorkspace[] }>(url, { params })
}

export const switchWorkspace: Fetcher<CommonResponse & { new_tenant: IWorkspace }, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<CommonResponse & { new_tenant: IWorkspace }>(url, { body })
}

export const fetchDataSource: Fetcher<{ data: DataSourceNotion[] }, { url: string }> = ({ url }) => {
  return get<{ data: DataSourceNotion[] }>(url)
}

export const syncDataSourceNotion: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return get<CommonResponse>(url)
}

export const updateDataSourceNotionAction: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return patch<CommonResponse>(url)
}

export const fetchPluginProviders: Fetcher<PluginProvider[] | null, string> = (url) => {
  return get<PluginProvider[] | null>(url)
}

export const validatePluginProviderKey: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: { credentials: any } }> = ({ url, body }) => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}
export const updatePluginProviderAIKey: Fetcher<UpdateOpenAIKeyResponse, { url: string; body: { credentials: any } }> = ({ url, body }) => {
  return post<UpdateOpenAIKeyResponse>(url, { body })
}

export const invitationCheck: Fetcher<CommonResponse & { is_valid: boolean; workspace_name: string }, { url: string; params: { workspace_id: string; email: string; token: string } }> = ({ url, params }) => {
  return get<CommonResponse & { is_valid: boolean; workspace_name: string }>(url, { params })
}

export const activateMember: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const fetchModelProviders: Fetcher<{ data: ModelProvider[] }, string> = (url) => {
  return get<{ data: ModelProvider[] }>(url)
}

export type ModelProviderCredentials = {
  credentials?: Record<string, string | undefined | boolean>
  load_balancing: ModelLoadBalancingConfig
}
export const fetchModelProviderCredentials: Fetcher<ModelProviderCredentials, string> = (url) => {
  return get<ModelProviderCredentials>(url)
}

export const fetchModelLoadBalancingConfig: Fetcher<{
  credentials?: Record<string, string | undefined | boolean>
  load_balancing: ModelLoadBalancingConfig
}, string> = (url) => {
  return get<{
    credentials?: Record<string, string | undefined | boolean>
    load_balancing: ModelLoadBalancingConfig
  }>(url)
}

export const fetchModelProviderModelList: Fetcher<{ data: ModelItem[] }, string> = (url) => {
  return get<{ data: ModelItem[] }>(url)
}

export const fetchModelList: Fetcher<{ data: Model[] }, string> = (url) => {
  return get<{ data: Model[] }>(url)
}

export const validateModelProvider: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}

export const validateModelLoadBalancingCredentials: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}

export const setModelProvider: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const deleteModelProvider: Fetcher<CommonResponse, { url: string; body?: any }> = ({ url, body }) => {
  return del<CommonResponse>(url, { body })
}

export const changeModelProviderPriority: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const setModelProviderModel: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const deleteModelProviderModel: Fetcher<CommonResponse, { url: string }> = ({ url }) => {
  return del<CommonResponse>(url)
}

export const getPayUrl: Fetcher<{ url: string }, string> = (url) => {
  return get<{ url: string }>(url)
}

export const fetchDefaultModal: Fetcher<{ data: DefaultModelResponse }, string> = (url) => {
  return get<{ data: DefaultModelResponse }>(url)
}

export const updateDefaultModel: Fetcher<CommonResponse, { url: string; body: any }> = ({ url, body }) => {
  return post<CommonResponse>(url, { body })
}

export const fetchModelParameterRules: Fetcher<{ data: ModelParameterRule[] }, string> = (url) => {
  return get<{ data: ModelParameterRule[] }>(url)
}

export const fetchFileUploadConfig: Fetcher<FileUploadConfigResponse, { url: string }> = ({ url }) => {
  return get<FileUploadConfigResponse>(url)
}

export const fetchFreeQuotaVerify: Fetcher<{ result: string; flag: boolean; reason: string }, string> = (url) => {
  return get(url) as Promise<{ result: string; flag: boolean; reason: string }>
}

export const fetchNotionConnection: Fetcher<{ data: string }, string> = (url) => {
  return get(url) as Promise<{ data: string }>
}

export const fetchDataSourceNotionBinding: Fetcher<{ result: string }, string> = (url) => {
  return get(url) as Promise<{ result: string }>
}

export const fetchApiBasedExtensionList: Fetcher<ApiBasedExtension[], string> = (url) => {
  return get(url) as Promise<ApiBasedExtension[]>
}

export const fetchApiBasedExtensionDetail: Fetcher<ApiBasedExtension, string> = (url) => {
  return get(url) as Promise<ApiBasedExtension>
}

export const addApiBasedExtension: Fetcher<ApiBasedExtension, { url: string; body: ApiBasedExtension }> = ({ url, body }) => {
  return post(url, { body }) as Promise<ApiBasedExtension>
}

export const updateApiBasedExtension: Fetcher<ApiBasedExtension, { url: string; body: ApiBasedExtension }> = ({ url, body }) => {
  return post(url, { body }) as Promise<ApiBasedExtension>
}

export const deleteApiBasedExtension: Fetcher<{ result: string }, string> = (url) => {
  return del(url) as Promise<{ result: string }>
}

export const fetchCodeBasedExtensionList: Fetcher<CodeBasedExtension, string> = (url) => {
  return get(url) as Promise<CodeBasedExtension>
}

export const moderate = (url: string, body: { app_id: string; text: string }) => {
  return post(url, { body }) as Promise<ModerateResponse>
}

type RetrievalMethodsRes = {
  'retrieval_method': RETRIEVE_METHOD[]
}
export const fetchSupportRetrievalMethods: Fetcher<RetrievalMethodsRes, string> = (url) => {
  return get<RetrievalMethodsRes>(url)
}

export const getSystemFeatures = () => {
  return get<SystemFeatures>('/system-features')
}

export const enableModel = (url: string, body: { model: string; model_type: ModelTypeEnum }) =>
  patch<CommonResponse>(url, { body })

export const disableModel = (url: string, body: { model: string; model_type: ModelTypeEnum }) =>
  patch<CommonResponse>(url, { body })

export const sendForgotPasswordEmail: Fetcher<CommonResponse, { url: string; body: { email: string } }> = ({ url, body }) =>
  post<CommonResponse>(url, { body })

export const verifyForgotPasswordToken: Fetcher<CommonResponse & { is_valid: boolean; email: string }, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<CommonResponse & { is_valid: boolean; email: string }>
}

export const changePasswordWithToken: Fetcher<CommonResponse, { url: string; body: { token: string; new_password: string; password_confirm: string } }> = ({ url, body }) =>
  post<CommonResponse>(url, { body })
