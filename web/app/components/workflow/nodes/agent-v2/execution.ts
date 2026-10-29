import type { WorkflowRunNodeExecutionResponse } from '@dify/contracts/api/console/apps/types.gen'

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
