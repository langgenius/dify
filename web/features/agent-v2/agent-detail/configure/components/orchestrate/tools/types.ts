import type { AgentProviderTool } from '@/features/agent-v2/agent-composer/form-state'

export type ToolSettingTarget = {
  actionId: string
  toolId: AgentProviderTool['id']
}
