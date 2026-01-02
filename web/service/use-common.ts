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
  UserProfileResponse,
} from '@/models/common'
import type { RETRIEVE_METHOD } from '@/types/app'
import { useMutation, useQuery } from '@tanstack/react-query'
import { IS_DEV } from '@/config'
import {
  fetchAccountIntegratesList,
  fetchAccountProfile,
  fetchApiBasedExtensions,
  fetchCodeBasedExtension,
  fetchCurrentWorkspaceInfo,
  fetchDataSourceIntegrates,
  fetchDefaultModelByType,
  fetchFilePreview,
  fetchFileSupportTypes,
  fetchFileUploadConfig,
  fetchInvitationCheck,
  fetchLangGeniusVersionInfo,
  fetchModelListByType,
  fetchModelParameterRules,
  fetchModelProviders,
  fetchNotionBinding,
  fetchNotionConnection,
  fetchPluginProvidersList,
  fetchSchemaDefinitions,
  fetchSupportRetrievalMethods,
  fetchUserProfileResponse,
  fetchWorkspaceMembers,
  fetchWorkspacesList,
  generateStructuredOutputRules,
  initAccount,
  logoutAccount,
  registerEmail,
  sendRegisterEmail,
  validateRegisterEmail,
  verifyForgotPasswordToken,
} from './common'
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
    queryFn: () => fetchFileUploadConfig(),
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
      const response = await fetchUserProfileResponse()
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
    queryFn: () => fetchLangGeniusVersionInfo(currentVersion),
    enabled: !!currentVersion && (enabled ?? true),
  })
}

export const useCurrentWorkspace = () => {
  return useQuery<ICurrentWorkspace>({
    queryKey: commonQueryKeys.currentWorkspace,
    queryFn: () => fetchCurrentWorkspaceInfo(),
  })
}

export const useWorkspaces = () => {
  return useQuery<{ workspaces: IWorkspace[] }>({
    queryKey: commonQueryKeys.workspaces,
    queryFn: () => fetchWorkspacesList(),
  })
}

export const useGenerateStructuredOutputRules = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'generate-structured-output-rules'],
    mutationFn: (body: StructuredOutputRulesRequestBody) => {
      return generateStructuredOutputRules(body)
    },
  })
}

export type MailSendResponse = { data: string, result: string }
export const useSendMail = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-send'],
    mutationFn: (body: { email: string, language: string }) => {
      return sendRegisterEmail(body)
    },
  })
}

export type MailValidityResponse = { is_valid: boolean, token: string }

export const useMailValidity = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-validity'],
    mutationFn: (body: { email: string, code: string, token: string }) => {
      return validateRegisterEmail(body)
    },
  })
}

export type MailRegisterResponse = { result: string, data: {} }

export const useMailRegister = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-register'],
    mutationFn: (body: { token: string, new_password: string, password_confirm: string }) => {
      return registerEmail(body)
    },
  })
}

export const useFileSupportTypes = () => {
  return useQuery<FileTypesRes>({
    queryKey: [NAME_SPACE, 'file-types'],
    queryFn: () => fetchFileSupportTypes(),
  })
}

type MemberResponse = {
  accounts: Member[] | null
}

export const useMembers = () => {
  return useQuery<MemberResponse>({
    queryKey: commonQueryKeys.members,
    queryFn: () => fetchWorkspaceMembers(),
  })
}

type FilePreviewResponse = {
  content: string
}

export const useFilePreview = (fileID: string) => {
  return useQuery<FilePreviewResponse>({
    queryKey: commonQueryKeys.filePreview(fileID),
    queryFn: () => fetchFilePreview({ fileID }),
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
    queryFn: () => fetchSchemaDefinitions(),
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
        await fetchAccountProfile()
      }
      catch (e: any) {
        if (e.status === 401)
          return { logged_in: false }
        return { logged_in: true }
      }
      return { logged_in: true }
    },
  })
}

export const useLogout = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'logout'],
    mutationFn: () => logoutAccount(),
  })
}

type ForgotPasswordValidity = CommonResponse & { is_valid: boolean, email: string }
export const useVerifyForgotPasswordToken = (token?: string | null) => {
  return useQuery<ForgotPasswordValidity>({
    queryKey: commonQueryKeys.forgotPasswordValidity(token),
    queryFn: () => verifyForgotPasswordToken({ url: '/forgot-password/validity', body: { token: token || '' } }) as Promise<ForgotPasswordValidity>,
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
    mutationFn: (body: OneMoreStepPayload) => initAccount(body),
  })
}

export const useModelProviders = () => {
  return useQuery<{ data: ModelProvider[] }>({
    queryKey: commonQueryKeys.modelProviders,
    queryFn: () => fetchModelProviders('/workspaces/current/model-providers'),
  })
}

export const useModelListByType = (type: ModelTypeEnum, enabled = true) => {
  return useQuery<{ data: Model[] }>({
    queryKey: commonQueryKeys.modelList(type),
    queryFn: () => fetchModelListByType(type),
    enabled,
  })
}

export const useDefaultModelByType = (type: ModelTypeEnum, enabled = true) => {
  return useQuery({
    queryKey: commonQueryKeys.defaultModel(type),
    queryFn: () => fetchDefaultModelByType(type),
    enabled,
  })
}

export const useSupportRetrievalMethods = () => {
  return useQuery<{ retrieval_method: RETRIEVE_METHOD[] }>({
    queryKey: commonQueryKeys.retrievalMethods,
    queryFn: () => fetchSupportRetrievalMethods(),
  })
}

export const useAccountIntegrates = () => {
  return useQuery<{ data: AccountIntegrate[] | null }>({
    queryKey: commonQueryKeys.accountIntegrates,
    queryFn: () => fetchAccountIntegratesList(),
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
    queryFn: () => fetchDataSourceIntegrates(),
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
    queryFn: () => fetchPluginProvidersList(),
  })
}

export const useCodeBasedExtensions = (module: string) => {
  return useQuery<CodeBasedExtension>({
    queryKey: commonQueryKeys.codeBasedExtensions(module),
    queryFn: () => fetchCodeBasedExtension(module),
  })
}

export const useNotionConnection = (enabled: boolean) => {
  return useQuery<{ data: string }>({
    queryKey: commonQueryKeys.notionConnection,
    queryFn: () => fetchNotionConnection(),
    enabled,
  })
}

export const useApiBasedExtensions = () => {
  return useQuery<ApiBasedExtension[]>({
    queryKey: commonQueryKeys.apiBasedExtensions,
    queryFn: () => fetchApiBasedExtensions(),
  })
}

export const useInvitationCheck = (params?: { workspace_id?: string, email?: string, token?: string }, enabled?: boolean) => {
  return useQuery({
    queryKey: commonQueryKeys.invitationCheck(params),
    queryFn: () => fetchInvitationCheck(params),
    enabled: enabled ?? !!params?.token,
    retry: false,
  })
}

export const useNotionBinding = (code?: string | null, enabled?: boolean) => {
  return useQuery({
    queryKey: commonQueryKeys.notionBinding(code),
    queryFn: () => fetchNotionBinding(code),
    enabled: !!code && (enabled ?? true),
  })
}

export const useModelParameterRules = (provider?: string, model?: string, enabled?: boolean) => {
  return useQuery<{ data: ModelParameterRule[] }>({
    queryKey: commonQueryKeys.modelParameterRules(provider, model),
    queryFn: () => fetchModelParameterRules(provider, model),
    enabled: !!provider && !!model && (enabled ?? true),
  })
}
