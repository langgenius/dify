import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type {
  ExternalAgentAssetResponse,
  ExternalAgentWaitPolicy,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

export type ExternalAgentWorkflowPreviewAgent = ExternalAgentAssetResponse

export type ExternalAgentTimeoutAction = NonNullable<ExternalAgentWaitPolicy['on_timeout']>

// Editor graph fields are persisted by the existing untyped workflow graph contract.
export type ExternalAgentWorkflowWaitLimit = Omit<
  Required<ExternalAgentWaitPolicy>,
  'wait_seconds'
> & {
  enabled: boolean
  wait_seconds: number
}

export type ExternalAgentWorkflowBinding = {
  binding_type: 'roster_agent'
  agent_id?: string | null
  binding_epoch?: string | null
  original_reference?: Record<string, unknown> | null
  current_snapshot_id?: null
}

export function isExternalAgentWorkflowBinding(
  value: unknown,
): value is ExternalAgentWorkflowBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as Partial<ExternalAgentWorkflowBinding>
  return (
    binding.binding_type === 'roster_agent' &&
    (binding.agent_id == null || typeof binding.agent_id === 'string') &&
    (binding.binding_epoch == null || typeof binding.binding_epoch === 'string') &&
    (binding.original_reference == null ||
      (typeof binding.original_reference === 'object' &&
        !Array.isArray(binding.original_reference))) &&
    binding.current_snapshot_id == null
  )
}

export type ExternalAgentWorkflowPreviewDefaultValue = {
  title?: string
  agent_node_kind: 'external_a2a'
  version: '2'
  agent_binding?: ExternalAgentWorkflowBinding
  agent_task?: string
  agent_declared_outputs?: DeclaredOutputConfig[]
  external_wait?: ExternalAgentWorkflowWaitLimit
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
    preview.agent_node_kind === 'external_a2a' &&
    preview.version === '2'
  )
}
