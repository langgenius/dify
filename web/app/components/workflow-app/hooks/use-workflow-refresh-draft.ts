import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
  syncToCollaboration?: boolean
  resolveConflict?: boolean
  builderRefresh?: boolean
}

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore((s) => s.appDetail)
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
      if (workflowStore.getState().workflowDraftSyncPhase !== 'idle' && !options?.builderRefresh)
        return Promise.resolve(false)
      if (options?.shouldApply && !options.shouldApply()) return Promise.resolve(false)
      // Background refreshes must not discard the local edits preserved after a conflict.
      if (workflowStore.getState().hasWorkflowDraftConflict && !options?.resolveConflict)
        return Promise.resolve(false)
      // A visibility-triggered metadata refresh must not cancel a full graph reload.
      if (notUpdateCanvas && workflowStore.getState().isSyncingWorkflowDraft)
        return Promise.resolve(false)

      const {
        appId,
        setSyncWorkflowDraftHash,
        setDraftUpdatedAt,
        setWorkflowDraftConflict,
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
      return workflowStore.getState().enqueueWorkflowDraftOperation(async () => {
        try {
          if (!isCurrent()) return false
          const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
          if (!isCurrent()) return false

          if (!notUpdateCanvas) {
            // An explicit reload can restore the local draft while collaboration
            // reconnects. Its graph recovery will restore the shared baseline.
            const syncToCollaboration =
              options?.syncToCollaboration ??
              (!options?.resolveConflict || collaborationManager.canApplyLocalGraphMutation())
            const applied = handleUpdateWorkflowCanvas(
              getWorkflowDraftGraphForCanvas(response.graph),
              {
                syncToCollaboration,
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
          if (!notUpdateCanvas) {
            setDraftUpdatedAt(response.updated_at)
            setIsWorkflowDataLoaded(true)
            setWorkflowDraftConflict(false)
            if (options?.builderRefresh) workflowStore.getState().setWorkflowDraftSyncPhase('idle')
          }
          return true
        } catch {
          return false
        } finally {
          if (workflowStore.getState().workflowDraftGeneration === generation)
            setIsSyncingWorkflowDraft(false)
        }
      })
    },
    [getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
