import type {
  SyncDraftCallback,
  SyncDraftOptions,
  SyncDraftResult,
} from '@/app/components/workflow/hooks-store'
import type { WorkflowDraftFeaturesPayload } from '@/service/workflow'
import { useSuspenseQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import {
  isAgentV2NodeData,
  needsInlineAgentBindingCreation,
} from '@/app/components/workflow/nodes/agent-v2/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { API_PREFIX } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { isAppDeletingOrDeleted } from '@/service/app-deletion'
import { postWithKeepalive } from '@/service/fetch'
import { fetchAppWorkflowDraft, syncWorkflowDraft } from '@/service/workflow'
import { useWorkflowRefreshDraft } from './use-workflow-refresh-draft'

const shouldSkipDraftSync = (appId: string | undefined, isWorkflowDataLoaded: boolean) =>
  !appId || !isWorkflowDataLoaded || isAppDeletingOrDeleted(appId)

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const { data: isCollaborationEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_collaboration_mode,
  })
  const isAnotherCanvasConnected = useCallback(
    () =>
      isCollaborationEnabled &&
      collaborationManager.isConnected() &&
      !collaborationManager.ownsReactFlowStore(store),
    [isCollaborationEnabled, store],
  )

  const getPostParams = useCallback(() => {
    const { getNodes, edges, transform } = store.getState()
    const allNodes = getNodes()
    const nodes = allNodes.filter((node) => {
      if (node.data?.type === BlockEnum.StartPlaceholder) return false

      if (!node.data?._isTempNode) return true

      return isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data)
    })
    const skippedNodeIds = new Set(
      allNodes
        .filter((node) => {
          if (node.data?.type === BlockEnum.StartPlaceholder) return true

          if (!node.data?._isTempNode) return false

          return !(isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data))
        })
        .map((node) => node.id),
    )
    const [x, y, zoom] = transform
    const { appId, conversationVariables, syncWorkflowDraftHash, isWorkflowDataLoaded } =
      workflowStore.getState()

    if (shouldSkipDraftSync(appId, isWorkflowDataLoaded)) return null

    const features = featuresStore!.getState().features
    const producedNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        Object.keys(node.data).forEach((key) => {
          if (key.startsWith('_')) delete node.data[key]
        })
      })
    })
    const producedEdges = produce(
      edges.filter(
        (edge) =>
          !edge.data?._isTemp &&
          !skippedNodeIds.has(edge.source) &&
          !skippedNodeIds.has(edge.target),
      ),
      (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_')) delete edge.data[key]
          })
        })
      },
    )
    const featuresPayload: WorkflowDraftFeaturesPayload = {
      opening_statement: features.opening?.enabled ? features.opening?.opening_statement || '' : '',
      suggested_questions: features.opening?.enabled
        ? features.opening?.suggested_questions || []
        : [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
    }

    return {
      url: `/apps/${appId}/workflows/draft`,
      params: {
        graph: {
          nodes: producedNodes,
          edges: producedEdges,
          viewport: {
            x,
            y,
            zoom,
          },
        },
        features: featuresPayload,
        conversation_variables: conversationVariables,
        hash: syncWorkflowDraftHash,
        ...(isCollaborationEnabled ? { _is_collaborative: true } : {}),
      },
    }
  }, [store, featuresStore, workflowStore, isCollaborationEnabled])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly() || isAnotherCanvasConnected()) return

    const canPersistOnPageClose =
      !isCollaborationEnabled ||
      collaborationManager.canFlushGraphOnPageClose() ||
      (collaborationManager.canUseLocalDraftFallback() &&
        collaborationManager.canPersistLocalGraph())
    if (!canPersistOnPageClose) return

    const postParams = getPostParams()

    if (postParams) postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly, isCollaborationEnabled, isAnotherCanvasConnected])

  const performLocalSync = useCallback(
    async (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
      capturedReplacementId?: string | null,
      capturedReplacementEpoch?: number,
    ): Promise<SyncDraftResult | null> => {
      if (getNodesReadOnly()) return null
      if (isAnotherCanvasConnected()) {
        callback?.onSettled?.()
        return null
      }
      const { appId, isWorkflowDataLoaded, lastAppliedReplacementId, draftReplacementEpoch } =
        workflowStore.getState()
      if (
        shouldSkipDraftSync(appId, isWorkflowDataLoaded) ||
        capturedReplacementId !== lastAppliedReplacementId ||
        capturedReplacementEpoch !== draftReplacementEpoch
      ) {
        callback?.onSettled?.()
        return null
      }

      if (isCollaborationEnabled && !collaborationManager.canPersistLocalGraph()) {
        callback?.onSettled?.()
        return null
      }

      const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()

      try {
        const latestHash = workflowStore.getState().syncWorkflowDraftHash

        const postParams = {
          ...baseParams,
          params: {
            ...baseParams.params,
            hash: latestHash || null,
            ...(options?.environmentVariablePatch
              ? {
                  environment_variable_patch: {
                    environment_variables: options.environmentVariablePatch.environmentVariables,
                    deleted_environment_variable_ids:
                      options.environmentVariablePatch.deletedEnvironmentVariableIds,
                  },
                }
              : {}),
          },
        }

        const res = await syncWorkflowDraft(postParams)
        if (
          workflowStore.getState().lastAppliedReplacementId !== capturedReplacementId ||
          workflowStore.getState().draftReplacementEpoch !== capturedReplacementEpoch
        )
          return null
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at }
      } catch (error: unknown) {
        const { appId, isWorkflowDataLoaded, lastAppliedReplacementId, draftReplacementEpoch } =
          workflowStore.getState()
        if (
          shouldSkipDraftSync(appId, isWorkflowDataLoaded) ||
          lastAppliedReplacementId !== capturedReplacementId ||
          draftReplacementEpoch !== capturedReplacementEpoch
        )
          return null

        const responseError = error as {
          bodyUsed?: boolean
          json?: () => Promise<{ code?: string }>
        }
        if (responseError.json && !responseError.bodyUsed) {
          let errorCode: string | undefined
          try {
            errorCode = (await responseError.json()).code
          } catch {
            // Non-JSON upstream errors should not surface as unhandled promise rejections.
          }
          if (errorCode === 'draft_workflow_not_sync' && appId) {
            const currentState = workflowStore.getState()
            const replacementIdBeforeRefresh = currentState.lastAppliedReplacementId
            const replacementEpochBeforeRefresh = currentState.draftReplacementEpoch
            const replacementSequenceBeforeRefresh =
              collaborationManager.getWorkflowReplacementSequence(appId)
            const replacementPendingBeforeRefresh =
              collaborationManager.isWorkflowReplacementPending(appId)
            currentState.debouncedSyncWorkflowDraft.cancel?.()
            currentState.setIsWorkflowDataLoaded(false)
            try {
              const draft = await fetchAppWorkflowDraft(appId)
              if (
                workflowStore.getState().lastAppliedReplacementId === replacementIdBeforeRefresh &&
                workflowStore.getState().draftReplacementEpoch === replacementEpochBeforeRefresh &&
                !replacementPendingBeforeRefresh &&
                !collaborationManager.isWorkflowReplacementPending(appId) &&
                collaborationManager.getWorkflowReplacementSequence(appId) ===
                  replacementSequenceBeforeRefresh
              ) {
                if (
                  notRefreshWhenSyncError &&
                  draft.last_replacement_id === replacementIdBeforeRefresh
                ) {
                  currentState.setSyncWorkflowDraftHash(draft.hash)
                } else {
                  const refreshed = await handleRefreshWorkflowDraft(true, {
                    prefetchedDraft: draft,
                    shouldApply: () =>
                      workflowStore.getState().lastAppliedReplacementId ===
                        replacementIdBeforeRefresh &&
                      workflowStore.getState().draftReplacementEpoch ===
                        replacementEpochBeforeRefresh &&
                      !collaborationManager.isWorkflowReplacementPending(appId) &&
                      collaborationManager.getWorkflowReplacementSequence(appId) ===
                        replacementSequenceBeforeRefresh,
                  })
                  if (
                    !refreshed &&
                    workflowStore.getState().lastAppliedReplacementId ===
                      replacementIdBeforeRefresh &&
                    workflowStore.getState().draftReplacementEpoch ===
                      replacementEpochBeforeRefresh &&
                    !collaborationManager.isWorkflowReplacementPending(appId) &&
                    collaborationManager.getWorkflowReplacementSequence(appId) ===
                      replacementSequenceBeforeRefresh
                  )
                    throw new Error('Workflow draft conflict could not be refreshed.')
                }
              }
              workflowStore.getState().setIsWorkflowDataLoaded(true)
            } catch {
              window.location.reload()
            }
          }
        }
        callback?.onError?.()
        return null
      } finally {
        callback?.onSettled?.()
      }
    },
    [
      workflowStore,
      getNodesReadOnly,
      handleRefreshWorkflowDraft,
      isCollaborationEnabled,
      isAnotherCanvasConnected,
    ],
  )

  const doSyncWorkflowDraftLocally = useSerialAsyncCallback(performLocalSync, getNodesReadOnly)
  const doSyncWorkflowDraft = useCallback(
    async (
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
    ): Promise<SyncDraftResult | null> => {
      if (getNodesReadOnly()) return null
      if (isAnotherCanvasConnected()) {
        callback?.onSettled?.()
        return null
      }
      const { appId, isWorkflowDataLoaded, lastAppliedReplacementId, draftReplacementEpoch } =
        workflowStore.getState()
      if (shouldSkipDraftSync(appId, isWorkflowDataLoaded)) {
        callback?.onSettled?.()
        return null
      }

      if (isCollaborationEnabled && !collaborationManager.canPersistLocalGraph()) {
        callback?.onSettled?.()
        return null
      }

      const shouldRequestLeader =
        isCollaborationEnabled &&
        collaborationManager.isConnected() &&
        !collaborationManager.getIsLeader() &&
        !options?.forceLocal

      if (!shouldRequestLeader) {
        // Capture before ReactFlow resets its store during route unmount.
        const baseParams = getPostParams()
        if (!baseParams) {
          callback?.onSettled?.()
          return null
        }

        return doSyncWorkflowDraftLocally(
          baseParams,
          notRefreshWhenSyncError,
          callback,
          options,
          lastAppliedReplacementId,
          draftReplacementEpoch,
        )
      }

      try {
        const result = await collaborationManager.requestWorkflowSync()
        if (
          workflowStore.getState().lastAppliedReplacementId !== lastAppliedReplacementId ||
          workflowStore.getState().draftReplacementEpoch !== draftReplacementEpoch
        )
          return null
        const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()
        setSyncWorkflowDraftHash(result.hash)
        setDraftUpdatedAt(result.updatedAt)
        callback?.onSuccess?.()
        return result
      } catch {
        const { appId, isWorkflowDataLoaded } = workflowStore.getState()
        if (!shouldSkipDraftSync(appId, isWorkflowDataLoaded)) callback?.onError?.()
        return null
      } finally {
        callback?.onSettled?.()
      }
    },
    [
      doSyncWorkflowDraftLocally,
      getNodesReadOnly,
      getPostParams,
      isCollaborationEnabled,
      isAnotherCanvasConnected,
      workflowStore,
    ],
  )

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}

export const useNodesSyncDraftByCanEdit = (canEdit: boolean) => {
  const { getNodesReadOnly } = useNodesReadOnlyByCanEdit(canEdit)

  return useNodesSyncDraftBase(getNodesReadOnly)
}

export const useNodesSyncDraft = () => {
  const { getNodesReadOnly } = useNodesReadOnly()

  return useNodesSyncDraftBase(getNodesReadOnly)
}
