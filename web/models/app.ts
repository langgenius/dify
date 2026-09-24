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
import type { App } from '@/types/app'

export const DSLImportMode = {
  YAML_CONTENT: 'yaml-content',
  YAML_URL: 'yaml-url',
} as const
export type DSLImportMode = (typeof DSLImportMode)[keyof typeof DSLImportMode]

export const DSLImportStatus = {
  COMPLETED: 'completed',
  COMPLETED_WITH_WARNINGS: 'completed-with-warnings',
  PENDING: 'pending',
  FAILED: 'failed',
} as const
export type DSLImportStatus = (typeof DSLImportStatus)[keyof typeof DSLImportStatus]

export type AppDetailResponse = App

export type UpdateAppModelConfigResponse = { result: string }

export type WorkflowOnlineUser = {
  user_id?: string
  username?: string
  avatar?: string | null
  sid?: string
}

export type WorkflowOnlineUsersResponse = {
  data:
    | Record<string, WorkflowOnlineUser[]>
    | Array<{
        app_id: string
        users: WorkflowOnlineUser[]
      }>
}

export type TracingStatus = {
  enabled: boolean
  tracing_provider: TracingProvider | null
}

export type TracingConfig = {
  tracing_provider: TracingProvider
  tracing_config:
    | ArizeConfig
    | PhoenixConfig
    | LangSmithConfig
    | LangFuseConfig
    | DatabricksConfig
    | MLflowConfig
    | OpikConfig
    | WeaveConfig
    | AliyunConfig
    | TencentConfig
}

export type WebhookTriggerResponse = {
  id: string
  webhook_id: string
  webhook_url: string
  webhook_debug_url: string
  node_id: string
  created_at: string
}
