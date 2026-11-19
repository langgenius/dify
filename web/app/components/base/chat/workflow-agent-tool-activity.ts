import type { ChatItem, WorkflowAgentToolActivity, WorkflowAgentToolActivityStatus } from './types'
import type { AgentLogStreamData } from '@/types/workflow'

const WORKFLOW_TOOL_ACTIVITY_STATUSES = new Set<WorkflowAgentToolActivityStatus>([
  'started',
  'running',
  'succeeded',
  'failed',
  'cancelled',
])

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

export function isWorkflowAgentToolLog(event: AgentLogStreamData): boolean {
  const metadata = asRecord(event.metadata)
  return metadata?.agent_node_version === '2' && metadata?.kind === 'tool'
}

export function upsertWorkflowToolActivity(item: ChatItem, event: AgentLogStreamData): void {
  if (!isWorkflowAgentToolLog(event)) return

  const id = event.id
  const nodeExecutionId = event.node_execution_id
  const status = WORKFLOW_TOOL_ACTIVITY_STATUSES.has(
    event.status as WorkflowAgentToolActivityStatus,
  )
    ? (event.status as WorkflowAgentToolActivityStatus)
    : null
  if (!id || !nodeExecutionId || !status) return

  const data = asRecord(event.data)
  const toolCallId = asString(data?.tool_call_id)
  const toolName = asString(data?.tool_name)
  if (!toolCallId || !toolName) return

  const activity: WorkflowAgentToolActivity = {
    id,
    node_id: asString(event.node_id),
    node_execution_id: nodeExecutionId,
    label: asString(event.label) || toolName,
    status,
    error: typeof event.error === 'string' && event.error ? event.error : null,
    data: {
      tool_call_id: toolCallId,
      tool_name: toolName,
      tool_input: asString(data?.tool_input),
      tool_output: asString(data?.tool_output),
      node_title: asString(data?.node_title),
    },
  }

  const activities = item.workflowAgentActivities ?? []
  const index = activities.findIndex(
    (existing) => existing.node_execution_id === nodeExecutionId && existing.id === id,
  )
  item.workflowAgentActivities =
    index > -1
      ? activities.map((existing, i) => (i === index ? activity : existing))
      : [...activities, activity]
}
