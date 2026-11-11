import type {
  ExternalAgentWorkflowPreviewAgent,
  ExternalAgentWorkflowPreviewDefaultValue,
} from './types'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

export const externalAgentExampleTask =
  'Review this contract against the company’s payment policy. Identify risks and suggest safer wording.\nPolicy: {{#policy.result#}}\nContract: {{#input.contract_text#}}'

export const externalAgentDefaultOutputs = [
  {
    name: 'text',
    type: 'string' as const,
    required: false,
    description: 'Text returned by the agent',
  },
]

// The external-agent workflow contract is not available yet. Keep this selection on the
// current canvas only; draft serialization excludes temporary nodes and their edges.
export function createExternalAgentWorkflowPreviewData(
  agent: ExternalAgentWorkflowPreviewAgent,
): ExternalAgentWorkflowPreviewDefaultValue {
  return {
    title: agent.name,
    agent_node_kind: 'external_agent',
    version: '2',
    agent_binding: undefined,
    _isTempNode: true,
    _externalAgentPreview: { ...agent },
    agent_task: externalAgentExampleTask,
    agent_declared_outputs: externalAgentDefaultOutputs.map((output) => ({ ...output })),
    _externalAgentWaitLimit: { enabled: true, minutes: 10 },
    error_strategy: ErrorHandleTypeEnum.failBranch,
  }
}
