import type {
  AliyunConfig,
  ArizeConfig,
  DatabricksConfig,
  LangFuseConfig,
  LangSmithConfig,
  MLflowConfig,
  OpikConfig,
  PhoenixConfig,
  TencentConfig,
  TracingProvider,
  WeaveConfig,
} from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/type'
import type { Dependency } from '@/app/components/plugins/types'
import type { App, AppModeEnum, AppTemplate, SiteConfig } from '@/types/app'

export enum DSLImportMode {
  YAML_CONTENT = 'yaml-content',
  YAML_URL = 'yaml-url',
}

export enum DSLImportStatus {
  COMPLETED = 'completed',
  COMPLETED_WITH_WARNINGS = 'completed-with-warnings',
  PENDING = 'pending',
  FAILED = 'failed',
}

export type AppListResponse = {
  data: App[]
  has_more: boolean
  limit: number
  page: number
  total: number
}

export type AppDetailResponse = App

export type DSLImportResponse = {
  id: string
  status: DSLImportStatus
  app_mode: AppModeEnum
  app_id?: string
  current_dsl_version?: string
  imported_dsl_version?: string
  error: string
  leaked_dependencies: Dependency[]
}

export type AppTemplatesResponse = {
  data: AppTemplate[]
}

export type CreateAppResponse = App

export type UpdateAppSiteCodeResponse = { app_id: string } & SiteConfig

export type AppDailyMessagesResponse = {
  data: Array<{ date: string, message_count: number }>
}

export type AppDailyConversationsResponse = {
  data: Array<{ date: string, conversation_count: number }>
}

export type WorkflowDailyConversationsResponse = {
  data: Array<{ date: string, runs: number }>
}

export type AppStatisticsResponse = {
  data: Array<{ date: string }>
}

export type AppDailyEndUsersResponse = {
  data: Array<{ date: string, terminal_count: number }>
}

export type AppTokenCostsResponse = {
  data: Array<{ date: string, token_count: number, total_price: number, currency: number }>
}

export type UpdateAppModelConfigResponse = { result: string }

export type ApiKeyItemResponse = {
  id: string
  token: string
  last_used_at: string
  created_at: string
}

export type ApiKeysListResponse = {
  data: ApiKeyItemResponse[]
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

export type TracingStatus = {
  enabled: boolean
  tracing_provider: TracingProvider | null
}

export type TracingConfig = {
  tracing_provider: TracingProvider
  tracing_config: ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | DatabricksConfig | MLflowConfig | OpikConfig | WeaveConfig | AliyunConfig | TencentConfig
}

export type WebhookTriggerResponse = {
  id: string
  webhook_id: string
  webhook_url: string
  webhook_debug_url: string
  node_id: string
  created_at: string
}

export type Banner = {
  id: string
  content: {
    'category': string
    'title': string
    'description': string
    'img-src': string
  }
  link: string
  sort: number
  status: string
  created_at: string
}
