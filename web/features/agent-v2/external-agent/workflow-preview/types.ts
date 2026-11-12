import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { CommonNodeType } from '@/app/components/workflow/types'
import type { ExternalAgentListItem } from '@/features/agent-v2/roster/components/external-agent-list'
import { BlockEnum } from '@/app/components/workflow/types'

export type ExternalAgentWorkflowPreviewAgent = Pick<
  ExternalAgentListItem,
  'key' | 'name' | 'role' | 'description' | 'icon' | 'enabled'
>

export type ExternalAgentTimeoutAction = 'end-waiting' | 'request-cancellation' | 'cancel-and-retry'

export type ExternalAgentWorkflowWaitLimit = {
  enabled: boolean
  minutes: number
  onTimeout: ExternalAgentTimeoutAction
  maxRetries: number
  retryIntervalSeconds: number
}

export type ExternalAgentWorkflowPreviewDefaultValue = {
  title?: string
  agent_node_kind: 'external_agent'
  version: '2'
  agent_binding: undefined
  external_agent: ExternalAgentWorkflowPreviewAgent
  agent_task?: string
  agent_declared_outputs?: DeclaredOutputConfig[]
  external_agent_wait_limit?: ExternalAgentWorkflowWaitLimit
  error_strategy?: CommonNodeType['error_strategy']
}

export type ExternalAgentWorkflowPreviewNodeData = CommonNodeType &
  ExternalAgentWorkflowPreviewDefaultValue

export function isExternalAgentWorkflowPreviewData(
  data: CommonNodeType,
): data is ExternalAgentWorkflowPreviewNodeData {
  const preview = data as Partial<ExternalAgentWorkflowPreviewNodeData>
  return (
    (data.type === BlockEnum.Agent || data.type === BlockEnum.AgentV2) &&
    preview.agent_node_kind === 'external_agent' &&
    preview.version === '2' &&
    !!preview.external_agent
  )
}
