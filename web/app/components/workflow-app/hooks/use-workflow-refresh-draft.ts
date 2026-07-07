import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  const handleRefreshWorkflowDraft = useCallback((notUpdateCanvas?: boolean) => {
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
        if (!notUpdateCanvas)
          handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph))
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
  }, [getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
