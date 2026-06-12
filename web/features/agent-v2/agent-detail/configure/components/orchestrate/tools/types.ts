import type { EnvVariable } from '../advanced/env'
import type { I18nKeysWithPrefix } from '@/types/i18n'

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

export type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  iconClassName: string
  credentialKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialVariant: 'authorized' | 'endUser'
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
