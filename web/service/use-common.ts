import type { FileTypesRes } from './datasets'
import type {
  Model,
  ModelParameterRule,
  ModelProvider,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  AccountIntegrate,
  ApiBasedExtension,
  CodeBasedExtension,
  CommonResponse,
  DataSourceNotion,
  FileUploadConfigResponse,
  ICurrentWorkspace,
  IWorkspace,
  LangGeniusVersionResponse,
  Member,
  PluginProvider,
  StructuredOutputRulesRequestBody,
  StructuredOutputRulesResponse,
  UserProfileResponse,
} from '@/models/common'
import type { RETRIEVE_METHOD } from '@/types/app'
import { useMutation, useQuery } from '@tanstack/react-query'
import { IS_DEV } from '@/config'
import { get, post } from './base'
import { useInvalid } from './use-base'

const NAME_SPACE = 'common'

export const commonQueryKeys = {
  fileUploadConfig: [NAME_SPACE, 'file-upload-config'] as const,
  userProfile: [NAME_SPACE, 'user-profile'] as const,
  currentWorkspace: [NAME_SPACE, 'current-workspace'] as const,
  workspaces: [NAME_SPACE, 'workspaces'] as const,
  members: [NAME_SPACE, 'members'] as const,
  filePreview: (fileID: string) => [NAME_SPACE, 'file-preview', fileID] as const,
  schemaDefinitions: [NAME_SPACE, 'schema-type-definitions'] as const,
  isLogin: [NAME_SPACE, 'is-login'] as const,
  modelProviders: [NAME_SPACE, 'model-providers'] as const,
  modelList: (type: ModelTypeEnum) => [NAME_SPACE, 'model-list', type] as const,
  defaultModel: (type: ModelTypeEnum) => [NAME_SPACE, 'default-model', type] as const,
  retrievalMethods: [NAME_SPACE, 'support-retrieval-methods'] as const,
  accountIntegrates: [NAME_SPACE, 'account-integrates'] as const,
  pluginProviders: [NAME_SPACE, 'plugin-providers'] as const,
  notionConnection: [NAME_SPACE, 'notion-connection'] as const,
  apiBasedExtensions: [NAME_SPACE, 'api-based-extensions'] as const,
  codeBasedExtensions: (module?: string) => [NAME_SPACE, 'code-based-extensions', module] as const,
  invitationCheck: (params?: { workspace_id?: string, email?: string, token?: string }) => [
    NAME_SPACE,
    'invitation-check',
    params?.workspace_id ?? '',
    params?.email ?? '',
    params?.token ?? '',
  ] as const,
  notionBinding: (code?: string | null) => [NAME_SPACE, 'notion-binding', code] as const,
  modelParameterRules: (provider?: string, model?: string) => [NAME_SPACE, 'model-parameter-rules', provider, model] as const,
  langGeniusVersion: (currentVersion?: string | null) => [NAME_SPACE, 'langgenius-version', currentVersion] as const,
  forgotPasswordValidity: (token?: string | null) => [NAME_SPACE, 'forgot-password-validity', token] as const,
  dataSourceIntegrates: [NAME_SPACE, 'data-source-integrates'] as const,
}

export const useFileUploadConfig = () => {
  return useQuery<FileUploadConfigResponse>({
    queryKey: commonQueryKeys.fileUploadConfig,
    queryFn: () => get<FileUploadConfigResponse>('/files/upload'),
  })
}

type UserProfileWithMeta = {
  profile: UserProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

export const useUserProfile = () => {
  return useQuery<UserProfileWithMeta>({
    queryKey: commonQueryKeys.userProfile,
    queryFn: async () => {
      const response = await get<Response>('/account/profile', {}, { needAllResponseContent: true }) as Response
      const profile = await response.clone().json() as UserProfileResponse
      return {
        profile,
        meta: {
          currentVersion: response.headers.get('x-version'),
          currentEnv: IS_DEV
            ? 'DEVELOPMENT'
            : response.headers.get('x-env'),
        },
      }
    },
    staleTime: 0,
    gcTime: 0,
  })
}

export const useLangGeniusVersion = (currentVersion?: string | null, enabled?: boolean) => {
  return useQuery<LangGeniusVersionResponse>({
    queryKey: commonQueryKeys.langGeniusVersion(currentVersion || undefined),
    queryFn: () => get<LangGeniusVersionResponse>('/version', { params: { current_version: currentVersion } }),
    enabled: !!currentVersion && (enabled ?? true),
  })
}

export const useCurrentWorkspace = () => {
  return useQuery<ICurrentWorkspace>({
    queryKey: commonQueryKeys.currentWorkspace,
    queryFn: () => post<ICurrentWorkspace>('/workspaces/current', { body: {} }),
  })
}

export const useWorkspaces = () => {
  return useQuery<{ workspaces: IWorkspace[] }>({
    queryKey: commonQueryKeys.workspaces,
    queryFn: () => get<{ workspaces: IWorkspace[] }>('/workspaces'),
  })
}

export const useGenerateStructuredOutputRules = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'generate-structured-output-rules'],
    mutationFn: (body: StructuredOutputRulesRequestBody) => {
      return post<StructuredOutputRulesResponse>(
        '/rule-structured-output-generate',
        { body },
      )
    },
  })
}

export type MailSendResponse = { data: string, result: string }
export const useSendMail = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-send'],
    mutationFn: (body: { email: string, language: string }) => {
      return post<MailSendResponse>('/email-register/send-email', { body })
    },
  })
}

export type MailValidityResponse = { is_valid: boolean, token: string }

export const useMailValidity = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-validity'],
    mutationFn: (body: { email: string, code: string, token: string }) => {
      return post<MailValidityResponse>('/email-register/validity', { body })
    },
  })
}

export type MailRegisterResponse = { result: string, data: {} }

export const useMailRegister = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-register'],
    mutationFn: (body: { token: string, new_password: string, password_confirm: string }) => {
      return post<MailRegisterResponse>('/email-register', { body })
    },
  })
}

export const useFileSupportTypes = () => {
  return useQuery<FileTypesRes>({
    queryKey: [NAME_SPACE, 'file-types'],
    queryFn: () => get<FileTypesRes>('/files/support-type'),
  })
}

type MemberResponse = {
  accounts: Member[] | null
}

export const useMembers = () => {
  return useQuery<MemberResponse>({
    queryKey: commonQueryKeys.members,
    queryFn: () => get<MemberResponse>('/workspaces/current/members', { params: {} }),
  })
}

type FilePreviewResponse = {
  content: string
}

export const useFilePreview = (fileID: string) => {
  return useQuery<FilePreviewResponse>({
    queryKey: commonQueryKeys.filePreview(fileID),
    queryFn: () => get<FilePreviewResponse>(`/files/${fileID}/preview`),
    enabled: !!fileID,
  })
}

export type SchemaTypeDefinition = {
  name: string
  schema: {
    properties: Record<string, any>
  }
}

export const useSchemaTypeDefinitions = () => {
  return useQuery<SchemaTypeDefinition[]>({
    queryKey: commonQueryKeys.schemaDefinitions,
    queryFn: () => get<SchemaTypeDefinition[]>('/spec/schema-definitions'),
  })
}

type isLogin = {
  logged_in: boolean
}

export const useIsLogin = () => {
  return useQuery<isLogin>({
    queryKey: commonQueryKeys.isLogin,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<isLogin> => {
      try {
        await get('/account/profile', {}, {
          silent: true,
        })
        return { logged_in: true }
      }
      catch {
        // Any error (401, 500, network error, etc.) means not logged in
        return { logged_in: false }
      }
    },
  })
}

export const useLogout = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'logout'],
    mutationFn: () => post('/logout'),
  })
}

type ForgotPasswordValidity = CommonResponse & { is_valid: boolean, email: string }
export const useVerifyForgotPasswordToken = (token?: string | null) => {
  return useQuery<ForgotPasswordValidity>({
    queryKey: commonQueryKeys.forgotPasswordValidity(token),
    queryFn: () => post<ForgotPasswordValidity>('/forgot-password/validity', { body: { token } }),
    enabled: !!token,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

type OneMoreStepPayload = {
  invitation_code: string
  interface_language: string
  timezone: string
}
export const useOneMoreStep = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'one-more-step'],
    mutationFn: (body: OneMoreStepPayload) => post<CommonResponse>('/account/init', { body }),
  })
}

export const useModelProviders = () => {
  return useQuery<{ data: ModelProvider[] }>({
    queryKey: commonQueryKeys.modelProviders,
    queryFn: () => get<{ data: ModelProvider[] }>('/workspaces/current/model-providers'),
  })
}

export const useModelListByType = (type: ModelTypeEnum, enabled = true) => {
  return useQuery<{ data: Model[] }>({
    queryKey: commonQueryKeys.modelList(type),
    queryFn: () => get<{ data: Model[] }>(`/workspaces/current/models/model-types/${type}`),
    enabled,
  })
}

export const useDefaultModelByType = (type: ModelTypeEnum, enabled = true) => {
  return useQuery({
    queryKey: commonQueryKeys.defaultModel(type),
    queryFn: () => get(`/workspaces/current/default-model?model_type=${type}`),
    enabled,
  })
}

export const useSupportRetrievalMethods = () => {
  return useQuery<{ retrieval_method: RETRIEVE_METHOD[] }>({
    queryKey: commonQueryKeys.retrievalMethods,
    queryFn: () => get<{ retrieval_method: RETRIEVE_METHOD[] }>('/datasets/retrieval-setting'),
  })
}

export const useAccountIntegrates = () => {
  return useQuery<{ data: AccountIntegrate[] | null }>({
    queryKey: commonQueryKeys.accountIntegrates,
    queryFn: () => get<{ data: AccountIntegrate[] | null }>('/account/integrates'),
  })
}

type DataSourceIntegratesOptions = {
  enabled?: boolean
  initialData?: { data: DataSourceNotion[] }
}

export const useDataSourceIntegrates = (options: DataSourceIntegratesOptions = {}) => {
  const { enabled = true, initialData } = options
  return useQuery<{ data: DataSourceNotion[] }>({
    queryKey: commonQueryKeys.dataSourceIntegrates,
    queryFn: () => get<{ data: DataSourceNotion[] }>('/data-source/integrates'),
    enabled,
    initialData,
  })
}

export const useInvalidDataSourceIntegrates = () => {
  return useInvalid(commonQueryKeys.dataSourceIntegrates)
}

export const usePluginProviders = () => {
  return useQuery<PluginProvider[] | null>({
    queryKey: commonQueryKeys.pluginProviders,
    queryFn: () => get<PluginProvider[] | null>('/workspaces/current/tool-providers'),
  })
}

export const useCodeBasedExtensions = (module: string) => {
  return useQuery<CodeBasedExtension>({
    queryKey: commonQueryKeys.codeBasedExtensions(module),
    queryFn: () => get<CodeBasedExtension>(`/code-based-extension?module=${module}`),
  })
}

export const useNotionConnection = (enabled: boolean) => {
  return useQuery<{ data: string }>({
    queryKey: commonQueryKeys.notionConnection,
    queryFn: () => get<{ data: string }>('/oauth/data-source/notion'),
    enabled,
  })
}

export const useApiBasedExtensions = () => {
  return useQuery<ApiBasedExtension[]>({
    queryKey: commonQueryKeys.apiBasedExtensions,
    queryFn: () => get<ApiBasedExtension[]>('/api-based-extension'),
  })
}

export const useInvitationCheck = (params?: { workspace_id?: string, email?: string, token?: string }, enabled?: boolean) => {
  return useQuery({
    queryKey: commonQueryKeys.invitationCheck(params),
    queryFn: () => get<{
      is_valid: boolean
      data: { workspace_name: string, email: string, workspace_id: string }
      result: string
    }>('/activate/check', { params }),
    enabled: enabled ?? !!params?.token,
    retry: false,
  })
}

export const useNotionBinding = (code?: string | null, enabled?: boolean) => {
  return useQuery({
    queryKey: commonQueryKeys.notionBinding(code),
    queryFn: () => get<{ result: string }>('/oauth/data-source/binding/notion', { params: { code } }),
    enabled: !!code && (enabled ?? true),
  })
}

export const useModelParameterRules = (provider?: string, model?: string, enabled?: boolean) => {
  return useQuery<{ data: ModelParameterRule[] }>({
    queryKey: commonQueryKeys.modelParameterRules(provider, model),
    queryFn: () => get<{ data: ModelParameterRule[] }>(`/workspaces/current/model-providers/${provider}/models/parameter-rules`, { params: { model } }),
    enabled: !!provider && !!model && (enabled ?? true),
  })
}
