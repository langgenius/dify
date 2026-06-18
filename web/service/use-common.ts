import type { FileTypesRes } from './datasets'
import type {
  Model,
  ModelParameterRule,
  ModelProvider,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  AccountIntegrate,
  CodeBasedExtension,
  CommonResponse,
  FileUploadConfigResponse,
  LangGeniusVersionResponse,
  Member,
  StructuredOutputRulesRequestBody,
  StructuredOutputRulesResponse,
} from '@/models/common'
import type { RETRIEVE_METHOD } from '@/types/app'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from './base'

const NAME_SPACE = 'common'

export const commonQueryKeys = {
  fileUploadConfig: [NAME_SPACE, 'file-upload-config'] as const,
  members: [NAME_SPACE, 'members'] as const,
  filePreview: (fileID: string) => [NAME_SPACE, 'file-preview', fileID] as const,
  schemaDefinitions: [NAME_SPACE, 'schema-type-definitions'] as const,
  modelProviders: [NAME_SPACE, 'model-providers'] as const,
  modelList: (type: ModelTypeEnum) => [NAME_SPACE, 'model-list', type] as const,
  defaultModel: (type: ModelTypeEnum) => [NAME_SPACE, 'default-model', type] as const,
  retrievalMethods: [NAME_SPACE, 'support-retrieval-methods'] as const,
  accountIntegrates: [NAME_SPACE, 'account-integrates'] as const,
  notionConnection: [NAME_SPACE, 'notion-connection'] as const,
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

export const useLangGeniusVersion = (currentVersion?: string | null, enabled?: boolean) => {
  return useQuery<LangGeniusVersionResponse>({
    queryKey: commonQueryKeys.langGeniusVersion(currentVersion || undefined),
    queryFn: () => get<LangGeniusVersionResponse>('/version', { params: { current_version: currentVersion } }),
    enabled: !!currentVersion && (enabled ?? true),
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
    mutationFn: (body: {
      token: string
      new_password: string
      password_confirm: string
      language?: string
      timezone?: string
    }) => {
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

export const useMembers = (language?: AccessControlTemplateLanguage) => {
  return useQuery<MemberResponse>({
    queryKey: [...commonQueryKeys.members, language],
    queryFn: () => get<MemberResponse>('/workspaces/current/members', {
      params: {
        language,
      },
    }),
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

export const useLogout = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'logout'],
    mutationFn: () => post('/logout'),
    onSuccess: () => {
      // Drop all cached queries so the post-logout /signin probe doesn't read
      // the previous user's profile (the userProfile queryKey is shared with
      // the (commonLayout) tree, which keeps observing it during React's
      // concurrent transition — gcTime: 0 is not enough on its own).
      // Nuclear over targeted: every new user-scoped query would otherwise
      // need to be remembered here. systemFeatures (user-agnostic) just
      // refetches once on the way to /signin, which is cheap.
      queryClient.clear()
    },
  })
}

type ForgotPasswordValidity = CommonResponse & { is_valid: boolean, email: string, token: string }
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

export const useCodeBasedExtensions = (module: string) => {
  return useQuery<CodeBasedExtension>({
    queryKey: commonQueryKeys.codeBasedExtensions(module),
    queryFn: () => get<CodeBasedExtension>(`/code-based-extension?module=${module}`),
  })
}

export const useInvitationCheck = (params?: { workspace_id?: string, email?: string, token?: string }, enabled?: boolean) => {
  return useQuery({
    queryKey: commonQueryKeys.invitationCheck(params),
    queryFn: () => get<{
      is_valid: boolean
      data: { workspace_name: string, email: string, workspace_id: string, account_status?: string, requires_setup?: boolean }
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
    queryFn: () => get<{ data: ModelParameterRule[] }>(`/workspaces/current/model-providers/${provider}/models/parameter-rules`, { params: { model }, silent: true }),
    enabled: !!provider && !!model && (enabled ?? true),
  })
}
