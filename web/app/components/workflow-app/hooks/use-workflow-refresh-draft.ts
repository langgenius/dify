import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { useFormatMemoryVariables } from '@/app/components/workflow/hooks'

export const useWorkflowRefreshDraft = () => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { formatMemoryVariables } = useFormatMemoryVariables()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      appId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
      setConversationVariables,
      setMemoryVariables,
    } = workflowStore.getState()
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`).then((response) => {
      handleUpdateWorkflowCanvas(response.graph as WorkflowDataUpdater)
      setSyncWorkflowDraftHash(response.hash)
      setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
        acc[env.id] = env.value
        return acc
      }, {} as Record<string, string>))
      setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
      setConversationVariables(response.conversation_variables || [])
      setMemoryVariables(formatMemoryVariables((response.memory_blocks || []), response.graph.nodes))
    }).finally(() => setIsSyncingWorkflowDraft(false))
  }, [handleUpdateWorkflowCanvas, workflowStore, formatMemoryVariables])

  return {
    handleRefreshWorkflowDraft,
  }
}
