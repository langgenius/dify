import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'

export const useWorkflowRefreshDraft = () => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      appId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
      setConversationVariables,
      setIsWorkflowDataLoaded,
      isWorkflowDataLoaded,
      debouncedSyncWorkflowDraft,
    } = workflowStore.getState()

    if (debouncedSyncWorkflowDraft && typeof (debouncedSyncWorkflowDraft as any).cancel === 'function')
      (debouncedSyncWorkflowDraft as any).cancel()

    const wasLoaded = isWorkflowDataLoaded
    if (wasLoaded)
      setIsWorkflowDataLoaded(false)
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
      .then((response) => {
        // Ensure we have a valid workflow structure with viewport
        const workflowData: WorkflowDataUpdater = {
          nodes: response.graph?.nodes || [],
          edges: response.graph?.edges || [],
          viewport: response.graph?.viewport || { x: 0, y: 0, zoom: 1 },
        }
        handleUpdateWorkflowCanvas(workflowData)
        setSyncWorkflowDraftHash(response.hash)
        setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>))
        setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
        setConversationVariables(response.conversation_variables || [])
        setIsWorkflowDataLoaded(true)
      })
      .catch(() => {
        if (wasLoaded)
          setIsWorkflowDataLoaded(true)
      })
      .finally(() => {
        setIsSyncingWorkflowDraft(false)
      })
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
