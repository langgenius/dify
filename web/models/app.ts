import type { App, AppTemplate, SiteConfig } from '@/types/app'

/* export type App = {
  id: string
  name: string
  decription: string
  mode: AppMode
  enable_site: boolean
  enable_api: boolean
  api_rpm: number
  api_rph: number
  is_demo: boolean
  model_config: AppModelConfig
  providers: Array<{ provider: string; token_is_set: boolean }>
  site: SiteConfig
  created_at: string
}

export type AppModelConfig = {
  provider: string
  model_id: string
  configs: {
    prompt_template: string
    prompt_variables: Array<PromptVariable>
    completion_params: CompletionParam
  }
}

export type PromptVariable = {
  key: string
  name: string
  description: string
  type: string | number
  default: string
  options: string[]
}

export type CompletionParam = {
  max_tokens: number
  temperature: number
  top_p: number
  echo: boolean
  stop: string[]
  presence_penalty: number
  frequency_penalty: number
}

export type SiteConfig = {
  access_token: string
  title: string
  author: string
  support_email: string
  default_language: string
  customize_domain: string
  theme: string
  customize_token_strategy: 'must' | 'allow' | 'not_allow'
  prompt_public: boolean
} */

export type AppListResponse = {
  data: App[]
  has_more: boolean
  limit: number
  page: number
  total: number
}

export type AppDetailResponse = App

export type AppTemplatesResponse = {
  data: AppTemplate[]
}

export type CreateAppResponse = App

export type UpdateAppSiteCodeResponse = { app_id: string } & SiteConfig

export type AppDailyConversationsResponse = {
  data: Array<{ date: string; conversation_count: number }>
}

export type WorkflowDailyConversationsResponse = {
  data: Array<{ date: string; runs: number }>
}

export type AppStatisticsResponse = {
  data: Array<{ date: string }>
}

export type AppDailyEndUsersResponse = {
  data: Array<{ date: string; terminal_count: number }>
}

export type AppTokenCostsResponse = {
  data: Array<{ date: string; token_count: number; total_price: number; currency: number }>
}

export type UpdateAppModelConfigResponse = { result: string }

export type ApikeyItemResponse = {
  id: string
  token: string
  last_used_at: string
  created_at: string
}

export type ApikeysListResponse = {
  data: ApikeyItemResponse[]
}

export type CreateApiKeyResponse = {
  id: string
  token: string
  created_at: string
}

export type ValidateOpenAIKeyResponse = {
  result: string
  error?: string
}

export type UpdateOpenAIKeyResponse = ValidateOpenAIKeyResponse

export type GenerationIntroductionResponse = {
  introduction: string
}

export type AppVoicesListResponse = [{
  name: string
  value: string
}]
