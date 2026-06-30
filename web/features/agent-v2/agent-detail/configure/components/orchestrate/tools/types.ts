import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  AgentProviderTool,
  AgentToolAction,
} from '@/features/agent-v2/agent-composer/form-state'

export type AgentProviderToolDefaultValue = ToolDefaultValue & {
  allowDelete?: boolean
  credentialRequired?: boolean
}

export type ToolSettingTarget = {
  action: AgentToolAction
  tool: AgentProviderTool
}
