import type {
  DefaultModelResponse,
  Model,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelParameterRule,
  ModelProvider,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  UpdateOpenAIKeyResponse,
  ValidateOpenAIKeyResponse,
} from '@/models/app'
import type {
  AccountIntegrate,
  ApiBasedExtension,
  CodeBasedExtension,
  CommonResponse,
  DataSourceNotion,
  FileUploadConfigResponse,
  ICurrentWorkspace,
  InitValidateStatusResponse,
  InvitationResponse,
  IWorkspace,
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
import type { RETRIEVE_METHOD } from '@/types/app'
import { del, get, patch, post, put } from './base'

type LoginSuccess = {
  result: 'success'
  data?: { access_token?: string }
}
type LoginFail = {
  result: 'fail'
  data: string
  code: string
  message: string
}
type LoginResponse = LoginSuccess | LoginFail
export const login = ({ url, body }: { url: string, body: Record<string, any> }): Promise<LoginResponse> => {
  return post<LoginResponse>(url, { body })
}
export const webAppLogin = ({ url, body }: { url: string, body: Record<string, any> }): Promise<LoginResponse> => {
  return post<LoginResponse>(url, { body }, { isPublicAPI: true })
}

export const setup = ({ body }: { body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>('/setup', { body })
}

export const initValidate = ({ body }: { body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>('/init', { body })
}

export const fetchInitValidateStatus = (): Promise<InitValidateStatusResponse> => {
  return get<InitValidateStatusResponse>('/init')
}

export const fetchSetupStatus = (): Promise<SetupStatusResponse> => {
  return get<SetupStatusResponse>('/setup')
}

export const fetchUserProfile = ({ url, params }: { url: string, params: Record<string, any> }): Promise<UserProfileOriginResponse> => {
  return get<UserProfileOriginResponse>(url, params, { needAllResponseContent: true })
}

export const updateUserProfile = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const fetchLangGeniusVersion = ({ url, params }: { url: string, params: Record<string, any> }): Promise<LangGeniusVersionResponse> => {
  return get<LangGeniusVersionResponse>(url, { params })
}

export const oauth = ({ url, params }: { url: string, params: Record<string, any> }): Promise<OauthResponse> => {
  return get<OauthResponse>(url, { params })
}

export const oneMoreStep = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const fetchMembers = ({ url, params }: { url: string, params: Record<string, any> }): Promise<{ accounts: Member[] | null }> => {
  return get<{ accounts: Member[] | null }>(url, { params })
}

export const fetchProviders = ({ url, params }: { url: string, params: Record<string, any> }): Promise<Provider[] | null> => {
  return get<Provider[] | null>(url, { params })
}

export const validateProviderKey = ({ url, body }: { url: string, body: { token: string } }): Promise<ValidateOpenAIKeyResponse> => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}
export const updateProviderAIKey = ({ url, body }: { url: string, body: { token: string | ProviderAzureToken | ProviderAnthropicToken } }): Promise<UpdateOpenAIKeyResponse> => {
  return post<UpdateOpenAIKeyResponse>(url, { body })
}

export const fetchAccountIntegrates = ({ url, params }: { url: string, params: Record<string, any> }): Promise<{ data: AccountIntegrate[] | null }> => {
  return get<{ data: AccountIntegrate[] | null }>(url, { params })
}

export const inviteMember = ({ url, body }: { url: string, body: Record<string, any> }): Promise<InvitationResponse> => {
  return post<InvitationResponse>(url, { body })
}

export const updateMemberRole = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CommonResponse> => {
  return put<CommonResponse>(url, { body })
}

export const deleteMemberOrCancelInvitation = ({ url }: { url: string }): Promise<CommonResponse> => {
  return del<CommonResponse>(url)
}

export const sendOwnerEmail = (body: { language?: string }): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>('/workspaces/current/members/send-owner-transfer-confirm-email', { body })

export const verifyOwnerEmail = (body: { code: string, token: string }): Promise<CommonResponse & { is_valid: boolean, email: string, token: string }> =>
  post<CommonResponse & { is_valid: boolean, email: string, token: string }>('/workspaces/current/members/owner-transfer-check', { body })

export const ownershipTransfer = (memberID: string, body: { token: string }): Promise<CommonResponse & { is_valid: boolean, email: string, token: string }> =>
  post<CommonResponse & { is_valid: boolean, email: string, token: string }>(`/workspaces/current/members/${memberID}/owner-transfer`, { body })

export const fetchFilePreview = ({ fileID }: { fileID: string }): Promise<{ content: string }> => {
  return get<{ content: string }>(`/files/${fileID}/preview`)
}

export const fetchCurrentWorkspace = ({ url, params }: { url: string, params: Record<string, any> }): Promise<ICurrentWorkspace> => {
  return post<ICurrentWorkspace>(url, { body: params })
}

export const updateCurrentWorkspace = ({ url, body }: { url: string, body: Record<string, any> }): Promise<ICurrentWorkspace> => {
  return post<ICurrentWorkspace>(url, { body })
}

export const fetchWorkspaces = ({ url, params }: { url: string, params: Record<string, any> }): Promise<{ workspaces: IWorkspace[] }> => {
  return get<{ workspaces: IWorkspace[] }>(url, { params })
}

export const switchWorkspace = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CommonResponse & { new_tenant: IWorkspace }> => {
  return post<CommonResponse & { new_tenant: IWorkspace }>(url, { body })
}

export const updateWorkspaceInfo = ({ url, body }: { url: string, body: Record<string, any> }): Promise<ICurrentWorkspace> => {
  return post<ICurrentWorkspace>(url, { body })
}

export const fetchDataSource = ({ url }: { url: string }): Promise<{ data: DataSourceNotion[] }> => {
  return get<{ data: DataSourceNotion[] }>(url)
}

export const syncDataSourceNotion = ({ url }: { url: string }): Promise<CommonResponse> => {
  return get<CommonResponse>(url)
}

export const updateDataSourceNotionAction = ({ url }: { url: string }): Promise<CommonResponse> => {
  return patch<CommonResponse>(url)
}

export const fetchPluginProviders = (url: string): Promise<PluginProvider[] | null> => {
  return get<PluginProvider[] | null>(url)
}

export const validatePluginProviderKey = ({ url, body }: { url: string, body: { credentials: any } }): Promise<ValidateOpenAIKeyResponse> => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}
export const updatePluginProviderAIKey = ({ url, body }: { url: string, body: { credentials: any } }): Promise<UpdateOpenAIKeyResponse> => {
  return post<UpdateOpenAIKeyResponse>(url, { body })
}

export const invitationCheck = ({ url, params }: { url: string, params: { workspace_id?: string, email?: string, token: string } }): Promise<CommonResponse & { is_valid: boolean, data: { workspace_name: string, email: string, workspace_id: string } }> => {
  return get<CommonResponse & { is_valid: boolean, data: { workspace_name: string, email: string, workspace_id: string } }>(url, { params })
}

export const activateMember = ({ url, body }: { url: string, body: any }): Promise<LoginResponse> => {
  return post<LoginResponse>(url, { body })
}

export const fetchModelProviders = (url: string): Promise<{ data: ModelProvider[] }> => {
  return get<{ data: ModelProvider[] }>(url)
}

export type ModelProviderCredentials = {
  credentials?: Record<string, string | undefined | boolean>
  load_balancing: ModelLoadBalancingConfig
}
export const fetchModelProviderCredentials = (url: string): Promise<ModelProviderCredentials> => {
  return get<ModelProviderCredentials>(url)
}

export const fetchModelLoadBalancingConfig = (url: string): Promise<{
  credentials?: Record<string, string | undefined | boolean>
  load_balancing: ModelLoadBalancingConfig
}> => {
  return get<{
    credentials?: Record<string, string | undefined | boolean>
    load_balancing: ModelLoadBalancingConfig
  }>(url)
}

export const fetchModelProviderModelList = (url: string): Promise<{ data: ModelItem[] }> => {
  return get<{ data: ModelItem[] }>(url)
}

export const fetchModelList = (url: string): Promise<{ data: Model[] }> => {
  return get<{ data: Model[] }>(url)
}

export const validateModelProvider = ({ url, body }: { url: string, body: any }): Promise<ValidateOpenAIKeyResponse> => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}

export const validateModelLoadBalancingCredentials = ({ url, body }: { url: string, body: any }): Promise<ValidateOpenAIKeyResponse> => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}

export const setModelProvider = ({ url, body }: { url: string, body: any }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const deleteModelProvider = ({ url, body }: { url: string, body?: any }): Promise<CommonResponse> => {
  return del<CommonResponse>(url, { body })
}

export const changeModelProviderPriority = ({ url, body }: { url: string, body: any }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const setModelProviderModel = ({ url, body }: { url: string, body: any }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const deleteModelProviderModel = ({ url }: { url: string }): Promise<CommonResponse> => {
  return del<CommonResponse>(url)
}

export const getPayUrl = (url: string): Promise<{ url: string }> => {
  return get<{ url: string }>(url)
}

export const fetchDefaultModal = (url: string): Promise<{ data: DefaultModelResponse }> => {
  return get<{ data: DefaultModelResponse }>(url)
}

export const updateDefaultModel = ({ url, body }: { url: string, body: any }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const fetchModelParameterRules = (url: string): Promise<{ data: ModelParameterRule[] }> => {
  return get<{ data: ModelParameterRule[] }>(url)
}

export const fetchFileUploadConfig = ({ url }: { url: string }): Promise<FileUploadConfigResponse> => {
  return get<FileUploadConfigResponse>(url)
}

export const fetchNotionConnection = (url: string): Promise<{ data: string }> => {
  return get<{ data: string }>(url)
}

export const fetchDataSourceNotionBinding = (url: string): Promise<{ result: string }> => {
  return get<{ result: string }>(url)
}

export const fetchApiBasedExtensionList = (url: string): Promise<ApiBasedExtension[]> => {
  return get<ApiBasedExtension[]>(url)
}

export const fetchApiBasedExtensionDetail = (url: string): Promise<ApiBasedExtension> => {
  return get<ApiBasedExtension>(url)
}

export const addApiBasedExtension = ({ url, body }: { url: string, body: ApiBasedExtension }): Promise<ApiBasedExtension> => {
  return post<ApiBasedExtension>(url, { body })
}

export const updateApiBasedExtension = ({ url, body }: { url: string, body: ApiBasedExtension }): Promise<ApiBasedExtension> => {
  return post<ApiBasedExtension>(url, { body })
}

export const deleteApiBasedExtension = (url: string): Promise<{ result: string }> => {
  return del<{ result: string }>(url)
}

export const fetchCodeBasedExtensionList = (url: string): Promise<CodeBasedExtension> => {
  return get<CodeBasedExtension>(url)
}

export const moderate = (url: string, body: { app_id: string, text: string }): Promise<ModerateResponse> => {
  return post<ModerateResponse>(url, { body })
}

type RetrievalMethodsRes = {
  retrieval_method: RETRIEVE_METHOD[]
}
export const fetchSupportRetrievalMethods = (url: string): Promise<RetrievalMethodsRes> => {
  return get<RetrievalMethodsRes>(url)
}

export const enableModel = (url: string, body: { model: string, model_type: ModelTypeEnum }): Promise<CommonResponse> =>
  patch<CommonResponse>(url, { body })

export const disableModel = (url: string, body: { model: string, model_type: ModelTypeEnum }): Promise<CommonResponse> =>
  patch<CommonResponse>(url, { body })

export const sendForgotPasswordEmail = ({ url, body }: { url: string, body: { email: string } }): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>(url, { body })

export const verifyForgotPasswordToken = ({ url, body }: { url: string, body: { token: string } }): Promise<CommonResponse & { is_valid: boolean, email: string }> => {
  return post<CommonResponse & { is_valid: boolean, email: string }>(url, { body })
}

export const changePasswordWithToken = ({ url, body }: { url: string, body: { token: string, new_password: string, password_confirm: string } }): Promise<CommonResponse> =>
  post<CommonResponse>(url, { body })

export const sendWebAppForgotPasswordEmail = ({ url, body }: { url: string, body: { email: string } }): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>(url, { body }, { isPublicAPI: true })

export const verifyWebAppForgotPasswordToken = ({ url, body }: { url: string, body: { token: string } }): Promise<CommonResponse & { is_valid: boolean, email: string }> => {
  return post<CommonResponse & { is_valid: boolean, email: string }>(url, { body }, { isPublicAPI: true })
}

export const changeWebAppPasswordWithToken = ({ url, body }: { url: string, body: { token: string, new_password: string, password_confirm: string } }): Promise<CommonResponse> =>
  post<CommonResponse>(url, { body }, { isPublicAPI: true })

export const uploadRemoteFileInfo = (url: string, isPublic?: boolean, silent?: boolean): Promise<{ id: string, name: string, size: number, mime_type: string, url: string }> => {
  return post<{ id: string, name: string, size: number, mime_type: string, url: string }>('/remote-files/upload', { body: { url } }, { isPublicAPI: isPublic, silent })
}

export const sendEMailLoginCode = (email: string, language = 'en-US'): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>('/email-code-login', { body: { email, language } })

export const emailLoginWithCode = (data: { email: string, code: string, token: string, language: string }): Promise<LoginResponse> =>
  post<LoginResponse>('/email-code-login/validity', { body: data })

export const sendResetPasswordCode = (email: string, language = 'en-US'): Promise<CommonResponse & { data: string, message?: string, code?: string }> =>
  post<CommonResponse & { data: string, message?: string, code?: string }>('/forgot-password', { body: { email, language } })

export const verifyResetPasswordCode = (body: { email: string, code: string, token: string }): Promise<CommonResponse & { is_valid: boolean, token: string }> =>
  post<CommonResponse & { is_valid: boolean, token: string }>('/forgot-password/validity', { body })

export const sendWebAppEMailLoginCode = (email: string, language = 'en-US'): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>('/email-code-login', { body: { email, language } }, { isPublicAPI: true })

export const webAppEmailLoginWithCode = (data: { email: string, code: string, token: string }): Promise<LoginResponse> =>
  post<LoginResponse>('/email-code-login/validity', { body: data }, { isPublicAPI: true })

export const sendWebAppResetPasswordCode = (email: string, language = 'en-US'): Promise<CommonResponse & { data: string, message?: string, code?: string }> =>
  post<CommonResponse & { data: string, message?: string, code?: string }>('/forgot-password', { body: { email, language } }, { isPublicAPI: true })

export const verifyWebAppResetPasswordCode = (body: { email: string, code: string, token: string }): Promise<CommonResponse & { is_valid: boolean, token: string }> =>
  post<CommonResponse & { is_valid: boolean, token: string }>('/forgot-password/validity', { body }, { isPublicAPI: true })

export const sendDeleteAccountCode = (): Promise<CommonResponse & { data: string }> =>
  get<CommonResponse & { data: string }>('/account/delete/verify')

export const verifyDeleteAccountCode = (body: { code: string, token: string }): Promise<CommonResponse & { is_valid: boolean }> =>
  post<CommonResponse & { is_valid: boolean }>('/account/delete', { body })

export const submitDeleteAccountFeedback = (body: { feedback: string, email: string }): Promise<CommonResponse> =>
  post<CommonResponse>('/account/delete/feedback', { body })

export const getDocDownloadUrl = (doc_name: string): Promise<{ url: string }> =>
  get<{ url: string }>('/compliance/download', { params: { doc_name } }, { silent: true })

export const sendVerifyCode = (body: { email: string, phase: string, token?: string }): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>('/account/change-email', { body })

export const verifyEmail = (body: { email: string, code: string, token: string }): Promise<CommonResponse & { is_valid: boolean, email: string, token: string }> =>
  post<CommonResponse & { is_valid: boolean, email: string, token: string }>('/account/change-email/validity', { body })

export const resetEmail = (body: { new_email: string, token: string }): Promise<CommonResponse> =>
  post<CommonResponse>('/account/change-email/reset', { body })

export const checkEmailExisted = (body: { email: string }): Promise<CommonResponse> =>
  post<CommonResponse>('/account/change-email/check-email-unique', { body }, { silent: true })
