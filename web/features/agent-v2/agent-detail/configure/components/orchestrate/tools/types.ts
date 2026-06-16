import type { EnvVariable } from '../advanced/env'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export type AgentProviderToolDefaultValue = ToolDefaultValue & {
  allowDelete?: boolean
  credentialRequired?: boolean
}

export type AgentToolBase = {
  id: string
  name: string
}

export type AgentToolAction = {
  id: string
  name: string
  toolName: string
  description: string
}

export type AgentProviderToolCredentialType = 'api-key' | 'oauth2' | 'unauthorized'

export type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  displayName?: string
  iconClassName: string
  icon?: ToolDefaultValue['provider_icon']
  iconDark?: ToolDefaultValue['provider_icon_dark']
  providerType?: string
  allowDelete?: boolean
  credentialId?: string
  credentialKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialType?: AgentProviderToolCredentialType
  credentialVariant: 'authorized' | 'unauthorized' | 'none'
  actions: AgentToolAction[]
}

export type AgentCliTool = AgentToolBase & {
  kind: 'cli'
  action?: 'preAuthorize'
  installCommand?: string
  envVariables?: EnvVariable[]
}

export type AgentTool = AgentProviderTool | AgentCliTool

export type ToolSettingTarget = {
  action: AgentToolAction
  tool: AgentProviderTool
}
