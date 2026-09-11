import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
  syncToCollaboration?: boolean
}

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore((s) => s.appDetail)
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
      if (options?.shouldApply && !options.shouldApply()) return Promise.resolve(false)
      // A visibility-triggered metadata refresh must not cancel a full graph reload.
      if (notUpdateCanvas && workflowStore.getState().isSyncingWorkflowDraft)
        return Promise.resolve(false)

      const {
        appId,
        setSyncWorkflowDraftHash,
        setIsSyncingWorkflowDraft,
        setEnvironmentVariables,
        setEnvSecrets,
        setConversationVariables,
        setIsWorkflowDataLoaded,
        invalidateWorkflowDraftSync,
      } = workflowStore.getState()

      const generation = invalidateWorkflowDraftSync()
      const isCurrent = () => {
        const state = workflowStore.getState()
        return (
          state.appId === appId &&
          state.workflowDraftGeneration === generation &&
          (options?.shouldApply?.() ?? true)
        )
      }
      setIsSyncingWorkflowDraft(true)
      return fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
        .then((response) => {
          if (!isCurrent()) return false

          if (!notUpdateCanvas) {
            const applied = handleUpdateWorkflowCanvas(
              getWorkflowDraftGraphForCanvas(response.graph),
              {
                syncToCollaboration: options?.syncToCollaboration ?? true,
                features: response.features,
              },
            )
            if (!applied) return false
            // The hash is a baseline for this graph, never for a metadata-only refresh.
            setSyncWorkflowDraftHash(response.hash)
          }
          setEnvSecrets(
            (response.environment_variables || [])
              .filter((env) => env.value_type === 'secret')
              .reduce(
                (acc, env) => {
                  if (typeof env.value === 'string') acc[env.id] = env.value
                  return acc
                },
                {} as Record<string, string>,
              ),
          )
          setEnvironmentVariables(
            response.environment_variables?.map((env) =>
              env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
            ) || [],
          )
          setConversationVariables(response.conversation_variables || [])
          if (!notUpdateCanvas) setIsWorkflowDataLoaded(true)
          return true
        })
        .catch(() => false)
        .finally(() => {
          if (workflowStore.getState().workflowDraftGeneration === generation)
            setIsSyncingWorkflowDraft(false)
        })
    },
    [getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
