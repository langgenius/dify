import type { AgentLogResponse, NodeTracing } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowAgentLog = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowAgentLog = useCallback(
    (params: AgentLogResponse) => {
      // The native stream uses id; the shared log panel uses message_id.
      const data = { ...params.data, message_id: params.data.id ?? params.data.message_id }
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          const currentIndex = draft.tracing!.findIndex((item) => item.node_id === data.node_id)
          if (currentIndex > -1) {
            const current = draft.tracing![currentIndex]

            if (current!.execution_metadata) {
              if (current!.execution_metadata.agent_log) {
                const currentLogIndex = current!.execution_metadata.agent_log.findIndex(
                  (log) => (log.id ?? log.message_id) === (data.id ?? data.message_id),
                )
                if (currentLogIndex > -1) {
                  current!.execution_metadata.agent_log[currentLogIndex] = {
                    ...current!.execution_metadata.agent_log[currentLogIndex],
                    ...data,
                  }
                } else {
                  current!.execution_metadata.agent_log.push(data)
                }
              } else {
                current!.execution_metadata.agent_log = [data]
              }
            } else {
              current!.execution_metadata = {
                agent_log: [data],
              } as unknown as NodeTracing['execution_metadata']
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
