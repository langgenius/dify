import { useSuspenseQuery } from '@tanstack/react-query'
import { useStore as useAtomStore, useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

export type WorkflowDraftRefreshResult = 'refreshed' | 'superseded' | 'failed'

const MAX_DRAFT_REFRESH_ATTEMPTS = 3

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
  syncToCollaboration?: boolean
  resolveConflict?: boolean
  builderRefresh?: boolean
  preserveViewport?: boolean
  background?: boolean
}

export const useWorkflowRefreshDraft = () => {
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const workflowStore = useWorkflowStore()
  const atomStore = useAtomStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (
      notUpdateCanvas?: boolean,
      options?: RefreshWorkflowDraftOptions,
    ): Promise<WorkflowDraftRefreshResult> => {
      if (workflowStore.getState().workflowDraftSyncPhase !== 'idle' && !options?.builderRefresh)
        return Promise.resolve('superseded')
      if (options?.shouldApply && !options.shouldApply()) return Promise.resolve('superseded')
      // Background refreshes must not discard the local edits preserved after a conflict.
      if (workflowStore.getState().hasWorkflowDraftConflict && !options?.resolveConflict)
        return Promise.resolve('superseded')
      // A visibility-triggered metadata refresh must not cancel a full graph reload.
      if (notUpdateCanvas && workflowStore.getState().isSyncingWorkflowDraft)
        return Promise.resolve('superseded')

      const {
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

      // Background reads wait for accepted saves before replacing their baseline.
      // They must leave pending edits and successful save acknowledgments intact.
      const background = !!notUpdateCanvas || options?.background === true
      const variablesAtRequest = workflowStore.getState()
      const variablesUnchanged = () => {
        const state = workflowStore.getState()
        return (
          state.environmentVariables === variablesAtRequest.environmentVariables &&
          state.conversationVariables === variablesAtRequest.conversationVariables
        )
      }
      let generation = background
        ? workflowStore.getState().workflowDraftGeneration
        : invalidateWorkflowDraftSync()
      let refreshingGraph = !notUpdateCanvas && !background
      const isCurrent = () => {
        const state = workflowStore.getState()
        return (
          atomStore.get(workflowAppIdentityAtom).appId === appId &&
          state.workflowDraftGeneration === generation &&
          (!background ||
            (state.workflowDraftSyncPhase === 'idle' && !state.hasWorkflowDraftConflict)) &&
          (options?.shouldApply?.() ?? true)
        )
      }
      if (refreshingGraph) setIsSyncingWorkflowDraft(true)
      return workflowStore
        .getState()
        .enqueueWorkflowDraftOperation<WorkflowDraftRefreshResult>(async () => {
          try {
            if (!isCurrent()) return 'superseded'
            const baseline = workflowStore.getState()
            // A variable patch can be accepted while this read waits for an older save.
            if (
              background &&
              (baseline.workflowDraftLocalRevision > baseline.workflowDraftSavedRevision ||
                !variablesUnchanged())
            )
              return 'superseded'
            if (background && !notUpdateCanvas) {
              generation = invalidateWorkflowDraftSync()
              refreshingGraph = true
              setIsSyncingWorkflowDraft(true)
            }
            const canApply = () => {
              if (!isCurrent()) return false
              if (!background) return true
              const state = workflowStore.getState()
              return (
                state.workflowDraftLocalRevision === baseline.workflowDraftLocalRevision &&
                variablesUnchanged()
              )
            }
            for (let attempt = 0; attempt < MAX_DRAFT_REFRESH_ATTEMPTS; attempt += 1) {
              if (!canApply()) return 'superseded'
              const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
              if (!canApply()) return 'superseded'

              if (!notUpdateCanvas) {
                // An explicit reload can restore the local draft while collaboration
                // reconnects. Its graph recovery will restore the shared baseline.
                const syncToCollaboration =
                  options?.syncToCollaboration ??
                  (!options?.resolveConflict || collaborationManager.canRestoreGraphFromCrdt())
                const useServerWriter = syncToCollaboration && collaborationManager.isConnected()
                let graph = getWorkflowDraftGraphForCanvas(response.graph)
                if (useServerWriter) {
                  const synced = await collaborationManager.requestServerDraftSync()
                  if (!canApply()) return 'superseded'
                  // The socket may already have accepted a newer committed draft.
                  // Read matching metadata before applying either graph or hash.
                  if (synced.hash !== response.hash) continue
                  graph = {
                    ...graph,
                    nodes: collaborationManager.getNodes(),
                    edges: collaborationManager.getEdges(),
                  }
                }
                const applied = handleUpdateWorkflowCanvas(graph, {
                  syncToCollaboration: syncToCollaboration && !useServerWriter,
                  features: response.features,
                  preserveViewport:
                    options?.preserveViewport ??
                    (options?.builderRefresh &&
                      workflowStore.getState().builderViewportManuallyChanged),
                })
                if (!applied) return 'failed'
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
                if (options?.builderRefresh)
                  workflowStore.getState().setWorkflowDraftSyncPhase('idle')
              }
              return 'refreshed'
            }
            return 'failed'
          } catch {
            return isCurrent() ? 'failed' : 'superseded'
          } finally {
            if (refreshingGraph && workflowStore.getState().workflowDraftGeneration === generation)
              setIsSyncingWorkflowDraft(false)
          }
        })
    },
    [appId, atomStore, getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
