import type { AgentLogItem, AgentLogStreamData } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { isWorkflowAgentToolLog } from '@/app/components/base/chat/workflow-agent-tool-activity'
import { useWorkflowStore } from '@/app/components/workflow/store'

const agentLogMetadata = (
  metadata: Record<string, unknown> | undefined,
): AgentLogItem['metadata'] => {
  if (!metadata) return undefined
  const narrowed: NonNullable<AgentLogItem['metadata']> = {}
  if (typeof metadata.elapsed_time === 'number') narrowed.elapsed_time = metadata.elapsed_time
  if (typeof metadata.provider === 'string') narrowed.provider = metadata.provider
  if (typeof metadata.icon === 'string') narrowed.icon = metadata.icon
  return Object.keys(narrowed).length > 0 ? narrowed : undefined
}

export const agentLogItemFromStream = (data: AgentLogStreamData): AgentLogItem => ({
  node_execution_id: data.node_execution_id,
  message_id: data.id,
  node_id: data.node_id,
  parent_id: data.parent_id ?? undefined,
  label: data.label,
  data: data.data,
  error: data.error ?? undefined,
  status: data.status,
  metadata: agentLogMetadata(data.metadata),
})

export const useWorkflowAgentLog = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowAgentLog = useCallback(
    (params: { data: AgentLogStreamData }) => {
      const { data } = params
      if (isWorkflowAgentToolLog(data)) return
      const item = agentLogItemFromStream(data)
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          const currentIndex = draft.tracing!.findIndex((node) => node.node_id === data.node_id)
          if (currentIndex > -1) {
            const current = draft.tracing![currentIndex]

            if (current!.execution_metadata) {
              if (current!.execution_metadata.agent_log) {
                const currentLogIndex = current!.execution_metadata.agent_log.findIndex(
                  (log) => log.message_id === item.message_id,
                )
                if (currentLogIndex > -1) {
                  current!.execution_metadata.agent_log[currentLogIndex] = {
                    ...current!.execution_metadata.agent_log[currentLogIndex],
                    ...item,
                  }
                } else {
                  current!.execution_metadata.agent_log.push(item)
                }
              } else {
                current!.execution_metadata.agent_log = [item]
              }
            } else {
              current!.execution_metadata = {
                agent_log: [item],
              } as any
            }
          }
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowAgentLog,
  }
}
