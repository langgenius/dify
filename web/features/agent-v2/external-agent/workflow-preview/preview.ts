import type {
  ExternalAgentWorkflowPreviewAgent,
  ExternalAgentWorkflowPreviewDefaultValue,
  ExternalAgentWorkflowWaitLimit,
} from './types'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

export const externalAgentDefaultWaitLimit: Readonly<ExternalAgentWorkflowWaitLimit> = {
  enabled: true,
  minutes: 10,
  onTimeout: 'end-waiting',
  maxRetries: 2,
  retryIntervalSeconds: 30,
}

export const externalAgentDefaultOutputs = [
  {
    name: 'text',
    type: 'string' as const,
    required: false,
    description: 'Text returned by the agent',
  },
]

// These UI settings belong to the workflow draft. External-agent execution will use its
// own contract once available; this summary contains no endpoint or credentials.
export function createExternalAgentWorkflowPreviewData(
  agent: ExternalAgentWorkflowPreviewAgent,
): ExternalAgentWorkflowPreviewDefaultValue {
  return {
    title: agent.name,
    agent_node_kind: 'external_agent',
    version: '2',
    agent_binding: undefined,
    external_agent: { ...agent },
    agent_task: '',
    agent_declared_outputs: externalAgentDefaultOutputs.map((output) => ({ ...output })),
    external_agent_wait_limit: { ...externalAgentDefaultWaitLimit },
    error_strategy: ErrorHandleTypeEnum.failBranch,
  }
}
