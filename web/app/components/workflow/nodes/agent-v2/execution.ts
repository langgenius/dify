import type { WorkflowRunNodeExecutionResponse } from '@dify/contracts/api/console/apps/types.gen'

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function getExternalAgentInvocationId(
  execution: Pick<WorkflowRunNodeExecutionResponse, 'process_data' | 'execution_metadata'>,
): string | undefined {
  const direct = record(execution.process_data)?.external_invocation_id
  const metadata = record(record(execution.execution_metadata)?.agent_log)?.invocation_id
  return typeof direct === 'string' && direct
    ? direct
    : typeof metadata === 'string' && metadata
      ? metadata
      : undefined
}

export function isExternalAgentWaiting(
  execution: Pick<
    WorkflowRunNodeExecutionResponse,
    'status' | 'process_data' | 'execution_metadata'
  >,
): boolean {
  return execution.status === 'paused' && getExternalAgentInvocationId(execution) !== undefined
}

export function hasExternalWaitReason(reasons: readonly unknown[] | undefined): boolean {
  return reasons?.some((reason) => record(reason)?.TYPE === 'external_wait') ?? false
}

export function hasHumanInputWaitReason(reasons: readonly unknown[] | undefined): boolean {
  return (
    reasons?.some((reason) =>
      ['human_input_required', 'hitl_required'].includes(String(record(reason)?.TYPE)),
    ) ?? false
  )
}

export function isBoundAgentV2Execution(
  execution: Pick<WorkflowRunNodeExecutionResponse, 'node_type' | 'process_data'>,
): boolean {
  const processData = execution.process_data
  return (
    execution.node_type === 'agent' &&
    typeof processData === 'object' &&
    processData !== null &&
    'workflow_agent_binding_id' in processData &&
    typeof processData.workflow_agent_binding_id === 'string' &&
    processData.workflow_agent_binding_id.length > 0
  )
}
