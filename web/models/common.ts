export type CommonResponse = {
  result: 'success' | 'fail'
}

export type OauthResponse = {
  redirect_url: string
}

export type UserProfileResponse = {
  id: string
  name: string
  email: string
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
}
export type ProviderAzureToken = {
  openai_api_base?: string
  openai_api_key?: string
}
export type ProviderTokenType = {
  [ProviderName.OPENAI]: string
  [ProviderName.AZURE_OPENAI]: ProviderAzureToken
}
export type Provider = {
  [Name in ProviderName]: {
    provider_name: Name
  } & {
    provider_type: 'custom' | 'system'
    is_valid: boolean
    is_enabled: boolean
    last_used: string
    token?: ProviderTokenType[Name]
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
