import type { I18nText } from '@/i18n/language'

export type CommonResponse = {
  result: 'success' | 'fail'
}

export type OauthResponse = {
  redirect_url: string
}

export type SetupStatusResponse = {
  step: 'finished' | 'not_started'
  setup_at?: Date
}

export type InitValidateStatusResponse = {
  status: 'finished' | 'not_started'
}

export type UserProfileResponse = {
  id: string
  name: string
  email: string
  avatar: string
  is_password_set: boolean
  interface_language?: string
  interface_theme?: string
  timezone?: string
  last_login_at?: string
  last_login_ip?: string
  created_at?: string
}

export type UserProfileOriginResponse = {
  json: () => Promise<UserProfileResponse>
  bodyUsed: boolean
  headers: any
}

export type LangGeniusVersionResponse = {
  current_version: string
  latest_version: string
  version: string
  release_date: string
  release_notes: string
  can_auto_update: boolean
  current_env: string
}

export type TenantInfoResponse = {
  name: string
  created_at: string
  providers: Array<{
    provider: string
    provider_name: string
    token_is_set: boolean
    is_valid: boolean
    token_is_valid: boolean
  }>
  in_trail: boolean
  trial_end_reason: null | 'trial_exceeded' | 'using_custom'
}

export type Member = Pick<UserProfileResponse, 'id' | 'name' | 'email' | 'last_login_at' | 'created_at'> & {
  avatar: string
  status: 'pending' | 'active' | 'banned' | 'closed'
  role: 'owner' | 'admin' | 'normal'
}

export enum ProviderName {
  OPENAI = 'openai',
  AZURE_OPENAI = 'azure_openai',
  ANTHROPIC = 'anthropic',
  Replicate = 'replicate',
  HuggingfaceHub = 'huggingface_hub',
  MiniMax = 'minimax',
  Spark = 'spark',
  Tongyi = 'tongyi',
  ChatGLM = 'chatglm',
}
export type ProviderAzureToken = {
  openai_api_base?: string
  openai_api_key?: string
}
export type ProviderAnthropicToken = {
  anthropic_api_key?: string
}
export type ProviderTokenType = {
  [ProviderName.OPENAI]: string
  [ProviderName.AZURE_OPENAI]: ProviderAzureToken
  [ProviderName.ANTHROPIC]: ProviderAnthropicToken
}
export type Provider = {
  [Name in ProviderName]: {
    provider_name: Name
  } & {
    provider_type: 'custom' | 'system'
    is_valid: boolean
    is_enabled: boolean
    last_used: string
    token?: string | ProviderAzureToken | ProviderAnthropicToken
  }
}[ProviderName]

export type ProviderHosted = Provider & {
  quota_type: string
  quota_limit: number
  quota_used: number
}

export type AccountIntegrate = {
  provider: 'google' | 'github'
  created_at: number
  is_bound: boolean
  link: string
}

export type IWorkspace = {
  id: string
  name: string
  plan: string
  status: string
  created_at: number
  current: boolean
}

export type ICurrentWorkspace = Omit<IWorkspace, 'current'> & {
  role: 'normal' | 'admin' | 'owner'
  providers: Provider[]
  in_trail: boolean
  trial_end_reason?: string
  custom_config?: {
    remove_webapp_brand?: boolean
    replace_webapp_logo?: string
  }
}

export type DataSourceNotionPage = {
  page_icon: null | {
    type: string | null
    url: string | null
    emoji: string | null
  }
  page_id: string
  page_name: string
  parent_id: string
  type: string
  is_bound: boolean
}

export type NotionPage = DataSourceNotionPage & {
  workspace_id: string
}

export type DataSourceNotionPageMap = Record<string, DataSourceNotionPage & { workspace_id: string }>

export type DataSourceNotionWorkspace = {
  workspace_name: string
  workspace_id: string
  workspace_icon: string | null
  total?: number
  pages: DataSourceNotionPage[]
}

export type DataSourceNotionWorkspaceMap = Record<string, DataSourceNotionWorkspace>

export type DataSourceNotion = {
  id: string
  provider: string
  is_bound: boolean
  source_info: DataSourceNotionWorkspace
}

export type GithubRepo = {
  stargazers_count: number
}

export type PluginProvider = {
  tool_name: string
  is_enabled: boolean
  credentials: {
    api_key: string
  } | null
}

export type FileUploadConfigResponse = {
  file_size_limit: number
  batch_count_limit: number
  image_file_size_limit?: number | string
}

export type InvitationResult = {
  status: 'success'
  email: string
  url: string
} | {
  status: 'failed'
  email: string
  message: string
}

export type InvitationResponse = CommonResponse & {
  invitation_results: InvitationResult[]
}

export type ApiBasedExtension = {
  id?: string
  name?: string
  api_endpoint?: string
  api_key?: string
}

export type CodeBasedExtensionForm = {
  type: string
  label: I18nText
  variable: string
  required: boolean
  options: { label: I18nText; value: string }[]
  default: string
  placeholder: string
  max_length?: number
}

export type CodeBasedExtensionItem = {
  name: string
  label: any
  form_schema: CodeBasedExtensionForm[]
}
export type CodeBasedExtension = {
  module: string
  data: CodeBasedExtensionItem[]
}

export type ExternalDataTool = {
  type?: string
  label?: string
  icon?: string
  icon_background?: string
  variable?: string
  enabled?: boolean
  config?: {
    api_based_extension_id?: string
  } & Partial<Record<string, any>>
}

export type ModerateResponse = {
  flagged: boolean
  text: string
}

export type ModerationService = (
  url: string,
  body: {
    app_id: string
    text: string
  }
) => Promise<ModerateResponse>
