import type {
  DefaultModelResponse,
  Model,
  ModelItem,
  ModelParameterRule,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  CommonResponse,
  ICurrentWorkspace,
  InitValidateStatusResponse,
  InvitationResponse,
  SetupStatusResponse,
} from '@/models/common'
import { del, get, patch, post } from './base'

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
export const updateUserProfile = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>(url, { body })
}

export const inviteMember = ({ url, body }: { url: string, body: Record<string, any> }): Promise<InvitationResponse> => {
  return post<InvitationResponse>(url, { body })
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
export const updateCurrentWorkspace = ({ url, body }: { url: string, body: Record<string, any> }): Promise<ICurrentWorkspace> => {
  return post<ICurrentWorkspace>(url, { body })
}

export const updateWorkspaceInfo = ({ url, body }: { url: string, body: Record<string, any> }): Promise<ICurrentWorkspace> => {
  return post<ICurrentWorkspace>(url, { body })
}

type InvitationCheckData = {
  workspace_name: string
  email: string
  workspace_id: string
  account_status?: string
  requires_setup?: boolean
}

type ActivateMemberBody = {
  token: string
  name?: string
  interface_language?: string
  timezone?: string
}

export const invitationCheck = ({ url, params }: { url: string, params: { workspace_id?: string, email?: string, token: string } }): Promise<CommonResponse & { is_valid: boolean, data: InvitationCheckData }> => {
  return get<CommonResponse & { is_valid: boolean, data: InvitationCheckData }>(url, { params })
}

export const activateMember = ({ url, body }: { url: string, body: ActivateMemberBody }): Promise<LoginResponse> => {
  return post<LoginResponse>(url, { body })
}

export const fetchModelProviderModelList = (url: string): Promise<{ data: ModelItem[] }> => {
  return get<{ data: ModelItem[] }>(url)
}

export const fetchModelList = (url: string): Promise<{ data: Model[] }> => {
  return get<{ data: Model[] }>(url)
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

export const enableModel = (url: string, body: { model: string, model_type: ModelTypeEnum }): Promise<CommonResponse> =>
  patch<CommonResponse>(url, { body })

export const disableModel = (url: string, body: { model: string, model_type: ModelTypeEnum }): Promise<CommonResponse> =>
  patch<CommonResponse>(url, { body })

export const sendForgotPasswordEmail = ({ url, body }: { url: string, body: { email: string } }): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>(url, { body })
export const changePasswordWithToken = ({ url, body }: { url: string, body: { token: string, new_password: string, password_confirm: string } }): Promise<CommonResponse> =>
  post<CommonResponse>(url, { body })
export const changeWebAppPasswordWithToken = ({ url, body }: { url: string, body: { token: string, new_password: string, password_confirm: string } }): Promise<CommonResponse> =>
  post<CommonResponse>(url, { body }, { isPublicAPI: true })

export const uploadRemoteFileInfo = (url: string, isPublic?: boolean, silent?: boolean): Promise<{ id: string, name: string, size: number, mime_type: string, url: string }> => {
  return post<{ id: string, name: string, size: number, mime_type: string, url: string }>('/remote-files/upload', { body: { url } }, { isPublicAPI: isPublic, silent })
}

export const sendEMailLoginCode = (email: string, language = 'en-US'): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>('/email-code-login', { body: { email, language } })

export const emailLoginWithCode = (data: {
  email: string
  code: string
  token: string
  language: string
  timezone?: string
}): Promise<LoginResponse> =>
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

export const getAvatar = async ({ avatar }: { avatar: string }): Promise<{ avatar_url: string }> => {
  const { consoleClient } = await import('./client')
  return consoleClient.account.avatar.get({ query: { avatar } })
}
