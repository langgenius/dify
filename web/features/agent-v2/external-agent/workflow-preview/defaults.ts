import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type {
  ExternalAgentWorkflowPreviewAgent,
  ExternalAgentWorkflowPreviewDefaultValue,
  ExternalAgentWorkflowWaitLimit,
} from './types'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

export const externalAgentDefaultWaitLimit: Readonly<ExternalAgentWorkflowWaitLimit> = {
  enabled: true,
  wait_seconds: 600,
  on_timeout: 'end_waiting',
  additional_retries: 1,
  retry_interval_seconds: 5,
}

export const externalAgentDefaultOutputs: DeclaredOutputConfig[] = [
  { name: 'text', type: 'string', required: true },
]

export function createExternalAgentWorkflowPreviewData(
  agent: ExternalAgentWorkflowPreviewAgent,
): ExternalAgentWorkflowPreviewDefaultValue {
  return {
    title: agent.name,
    agent_node_kind: 'external_a2a',
    version: '2',
    agent_binding: { binding_type: 'roster_agent', agent_id: agent.id },
    agent_task: '',
    agent_declared_outputs: externalAgentDefaultOutputs.map((output) => ({ ...output })),
    external_wait: { ...externalAgentDefaultWaitLimit },
    error_strategy: ErrorHandleTypeEnum.failBranch,
  }
}
