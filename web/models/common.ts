import type { I18nText } from '@/i18n/language'

export interface CommonResponse {
  result: 'success' | 'fail'
}

export interface OauthResponse {
  redirect_url: string
}

export interface SetupStatusResponse {
  step: 'finished' | 'not_started'
  setup_at?: Date
}

export interface InitValidateStatusResponse {
  status: 'finished' | 'not_started'
}

export interface UserProfileResponse {
  id: string
  name: string
  email: string
  avatar: string
  avatar_url: string | null
  is_password_set: boolean
  interface_language?: string
  interface_theme?: string
  timezone?: string
  last_login_at?: string
  last_active_at?: string
  last_login_ip?: string
  created_at?: string
}

export interface UserProfileOriginResponse {
  json: () => Promise<UserProfileResponse>
  bodyUsed: boolean
  headers: any
}

export interface LangGeniusVersionResponse {
  current_version: string
  latest_version: string
  version: string
  release_date: string
  release_notes: string
  can_auto_update: boolean
  current_env: string
}

export interface TenantInfoResponse {
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

export type Member = Pick<UserProfileResponse, 'id' | 'name' | 'email' | 'last_login_at' | 'last_active_at' | 'created_at' | 'avatar_url'> & {
  avatar: string
  status: 'pending' | 'active' | 'banned' | 'closed'
  role: 'owner' | 'admin' | 'editor' | 'normal' | 'dataset_operator'
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
export interface ProviderAzureToken {
  openai_api_base?: string
  openai_api_key?: string
}
export interface ProviderAnthropicToken {
  anthropic_api_key?: string
}
export interface ProviderTokenType {
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

export interface AccountIntegrate {
  provider: 'google' | 'github'
  created_at: number
  is_bound: boolean
  link: string
}

export interface IWorkspace {
  id: string
  name: string
  plan: string
  status: string
  created_at: number
  current: boolean
}

export type ICurrentWorkspace = Omit<IWorkspace, 'current'> & {
  role: 'owner' | 'admin' | 'editor' | 'dataset_operator' | 'normal'
  providers: Provider[]
  in_trail: boolean
  trial_end_reason?: string
  custom_config?: {
    remove_webapp_brand?: boolean
    replace_webapp_logo?: string
  }
}

export interface DataSourceNotionPage {
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

export interface DataSourceNotionWorkspace {
  workspace_name: string
  workspace_id: string
  workspace_icon: string | null
  total?: number
  pages: DataSourceNotionPage[]
}

export type DataSourceNotionWorkspaceMap = Record<string, DataSourceNotionWorkspace>

export interface DataSourceNotion {
  id: string
  provider: string
  is_bound: boolean
  source_info: DataSourceNotionWorkspace
}

export enum DataSourceCategory {
  website = 'website',
}
export enum DataSourceProvider {
  fireCrawl = 'firecrawl',
  jinaReader = 'jinareader',
}

export interface FirecrawlConfig {
  api_key: string
  base_url: string
}

export interface DataSourceItem {
  id: string
  category: DataSourceCategory
  provider: DataSourceProvider
  disabled: boolean
  created_at: number
  updated_at: number
}

export interface DataSources {
  sources: DataSourceItem[]
}

export interface GithubRepo {
  stargazers_count: number
}

export interface PluginProvider {
  tool_name: string
  is_enabled: boolean
  credentials: {
    api_key: string
  } | null
}

export interface FileUploadConfigResponse {
  batch_count_limit: number
  image_file_size_limit?: number | string // default is 10MB
  file_size_limit: number // default is 15MB
  audio_file_size_limit?: number // default is 50MB
  video_file_size_limit?: number // default is 100MB
  workflow_file_upload_limit?: number // default is 10
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

export interface ApiBasedExtension {
  id?: string
  name?: string
  api_endpoint?: string
  api_key?: string
}

export interface CodeBasedExtensionForm {
  type: string
  label: I18nText
  variable: string
  required: boolean
  options: { label: I18nText; value: string }[]
  default: string
  placeholder: string
  max_length?: number
}

export interface CodeBasedExtensionItem {
  name: string
  label: any
  form_schema: CodeBasedExtensionForm[]
}
export interface CodeBasedExtension {
  module: string
  data: CodeBasedExtensionItem[]
}

export interface ExternalDataTool {
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

export interface ModerateResponse {
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
