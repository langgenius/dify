import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { CommonNodeType } from '@/app/components/workflow/types'
import type { ExternalAgentListItem } from '@/features/agent-v2/roster/components/external-agent-list'
import { BlockEnum } from '@/app/components/workflow/types'

export type ExternalAgentWorkflowPreviewAgent = Pick<
  ExternalAgentListItem,
  'key' | 'name' | 'role' | 'description' | 'icon' | 'enabled'
>

export type ExternalAgentWorkflowPreviewDefaultValue = {
  title?: string
  agent_node_kind: 'external_agent'
  version: '2'
  agent_binding: undefined
  _isTempNode: true
  _externalAgentPreview: ExternalAgentWorkflowPreviewAgent
  agent_task?: string
  agent_declared_outputs?: DeclaredOutputConfig[]
  _externalAgentWaitLimit?: { enabled: boolean; minutes: number }
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
    preview._isTempNode === true &&
    !!preview._externalAgentPreview
  )
}
