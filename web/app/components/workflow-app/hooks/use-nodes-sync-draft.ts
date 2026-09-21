import type {
  SyncDraftCallback,
  SyncDraftOptions,
  SyncDraftResult,
} from '@/app/components/workflow/hooks-store'
import type { WorkflowDraftFeaturesPayload } from '@/service/workflow'
import { useSuspenseQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
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
import { syncWorkflowDraft } from '@/service/workflow'

const shouldSkipDraftSync = (
  appId: string | undefined,
  isWorkflowDataLoaded: boolean,
  isSyncingWorkflowDraft: boolean,
  hasWorkflowDraftConflict: boolean,
) =>
  !appId ||
  !isWorkflowDataLoaded ||
  isSyncingWorkflowDraft ||
  hasWorkflowDraftConflict ||
  isAppDeletingOrDeleted(appId)

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const { t } = useTranslation('workflow')
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { data: isCollaborationEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_collaboration_mode,
  })

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
    const {
      appId,
      conversationVariables,
      syncWorkflowDraftHash,
      isWorkflowDataLoaded,
      isSyncingWorkflowDraft,
      hasWorkflowDraftConflict,
      workflowDraftGeneration,
    } = workflowStore.getState()

    if (
      !appId ||
      shouldSkipDraftSync(
        appId,
        isWorkflowDataLoaded,
        isSyncingWorkflowDraft,
        hasWorkflowDraftConflict,
      )
    )
      return null

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
      appId,
      generation: workflowDraftGeneration,
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
    if (getNodesReadOnly() || workflowStore.getState().workflowDraftSyncPhase !== 'idle') return

    const canPersistOnPageClose =
      !isCollaborationEnabled ||
      collaborationManager.canFlushGraphOnPageClose() ||
      collaborationManager.canUseLocalDraftFallback()
    if (!canPersistOnPageClose) return

    const postParams = getPostParams()

    if (postParams) postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly, isCollaborationEnabled, workflowStore])

  const performLocalSync = useCallback(
    async (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
      preparingBuilder = false,
    ): Promise<SyncDraftResult | null> => {
      if (
        !preparingBuilder &&
        (getNodesReadOnly() || workflowStore.getState().workflowDraftSyncPhase !== 'idle')
      ) {
        callback?.onSettled?.()
        return null
      }
      const isCurrent = () => {
        const state = workflowStore.getState()
        return (
          state.appId === baseParams.appId &&
          state.workflowDraftGeneration === baseParams.generation &&
          !shouldSkipDraftSync(
            state.appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
            state.hasWorkflowDraftConflict,
          )
        )
      }
      if (!isCurrent()) {
        callback?.onSettled?.()
        return null
      }

      if (isCollaborationEnabled && !collaborationManager.canPersistLocalGraph()) {
        callback?.onSettled?.()
        return null
      }

      const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()

      try {
        const currentHash = workflowStore.getState().syncWorkflowDraftHash
        const lastSave = workflowStore.getState().lastSavedWorkflowDraft
        // Only a successful save from this queue may advance a captured graph's
        // hash. A server refresh must never lend its hash to an older graph.
        const canUseLastSave =
          lastSave !== null &&
          lastSave.appId === baseParams.appId &&
          lastSave.generation === baseParams.generation &&
          lastSave.hash === currentHash
        if (currentHash !== baseParams.params.hash && !canUseLastSave) return null

        const postParams = {
          url: baseParams.url,
          params: {
            ...baseParams.params,
            hash: (canUseLastSave ? lastSave.hash : baseParams.params.hash) || null,
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
        if (!isCurrent() || workflowStore.getState().syncWorkflowDraftHash !== currentHash)
          return null
        workflowStore.getState().setLastSavedWorkflowDraft({
          appId: baseParams.appId,
          generation: baseParams.generation,
          hash: res.hash,
        })
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at }
      } catch (error: unknown) {
        if (!isCurrent()) return null

        const responseError = error as {
          status?: number
          bodyUsed?: boolean
          json?: () => Promise<{ code?: string }>
        }
        if (responseError.json && !responseError.bodyUsed) {
          try {
            const err = await responseError.json()
            if (
              isCurrent() &&
              responseError.status === 409 &&
              err.code === 'draft_workflow_not_sync'
            )
              workflowStore.getState().setWorkflowDraftConflict(true)
          } catch {
            // Non-JSON upstream errors should not surface as unhandled promise rejections.
          }
        }
        callback?.onError?.()
        return null
      } finally {
        callback?.onSettled?.()
      }
    },
    [workflowStore, getNodesReadOnly, isCollaborationEnabled],
  )

  const doSyncWorkflowDraftLocally = useCallback(
    (...args: Parameters<typeof performLocalSync>) =>
      workflowStore.getState().enqueueWorkflowDraftOperation(() => {
        // Saves accepted before the barrier must finish, including variable
        // patches that cannot be reconstructed from the final canvas snapshot.
        const drainingForBuilder = workflowStore.getState().workflowDraftSyncPhase !== 'idle'
        return performLocalSync(args[0], args[1], args[2], args[3] || drainingForBuilder)
      }),
    [performLocalSync, workflowStore],
  )
  const doSyncWorkflowDraft = useCallback(
    async (
      _notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
    ): Promise<SyncDraftResult | null> => {
      const {
        appId,
        isWorkflowDataLoaded,
        isSyncingWorkflowDraft,
        workflowDraftGeneration,
        hasWorkflowDraftConflict,
        workflowDraftSyncPhase,
      } = workflowStore.getState()
      // A follower awaiting the selected saver's ACK must still be able to
      // serve a directed save request. This wait never occupies the queue.
      const preparingBuilder =
        workflowDraftSyncPhase === 'preparing' && options?.forceLocal === true
      if (
        (!preparingBuilder && (getNodesReadOnly() || workflowDraftSyncPhase !== 'idle')) ||
        shouldSkipDraftSync(
          appId,
          isWorkflowDataLoaded,
          isSyncingWorkflowDraft,
          hasWorkflowDraftConflict,
        )
      ) {
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

        return doSyncWorkflowDraftLocally(baseParams, callback, options, preparingBuilder)
      }

      try {
        const result = await collaborationManager.requestWorkflowSync()
        if (
          workflowStore.getState().appId !== appId ||
          workflowStore.getState().workflowDraftGeneration !== workflowDraftGeneration
        )
          return null
        const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()
        setSyncWorkflowDraftHash(result.hash)
        setDraftUpdatedAt(result.updatedAt)
        callback?.onSuccess?.()
        return result
      } catch (error) {
        const state = workflowStore.getState()
        if (
          state.appId === appId &&
          state.workflowDraftGeneration === workflowDraftGeneration &&
          !shouldSkipDraftSync(
            state.appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
            state.hasWorkflowDraftConflict,
          )
        ) {
          if (error instanceof Error && error.message === 'draft_workflow_not_sync')
            state.setWorkflowDraftConflict(true)
          callback?.onError?.()
        }
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
      workflowStore,
    ],
  )

  const prepareWorkflowDraftForBuilder = useCallback(
    async (saveDraft: boolean, signal: AbortSignal) => {
      const state = workflowStore.getState()
      const appId = state.appId
      signal.throwIfAborted()
      // A replacement restore may take over a canceled request's barrier.
      if (saveDraft && state.workflowDraftSyncPhase !== 'idle')
        throw new Error(t(($) => $['common.syncingData']))
      if (state.hasWorkflowDraftConflict) throw new Error(t(($) => $['draftConflict.message']))

      const shouldSave = saveDraft && !state.canvasReadOnly
      if (shouldSave && getNodesReadOnly()) throw new Error(t(($) => $['common.draftSaveFailed']))
      const requestLeader =
        shouldSave &&
        isCollaborationEnabled &&
        collaborationManager.isConnected() &&
        !collaborationManager.getIsLeader()
      // Lock editing around this snapshot and retain it if ReactFlow unmounts
      // while older saves drain. An accepted save still finishes on cancellation.
      const snapshot = shouldSave ? getPostParams() : null
      state.debouncedSyncWorkflowDraft.cancel?.()
      state.setWorkflowDraftSyncPhase(shouldSave ? 'preparing' : 'builder')
      try {
        let saved: SyncDraftResult | null = null
        if (shouldSave && !requestLeader) {
          saved = await state.enqueueWorkflowDraftOperation(async () =>
            snapshot ? performLocalSync(snapshot, undefined, undefined, true) : null,
          )
        } else {
          await state.enqueueWorkflowDraftOperation(async () => undefined)
          signal.throwIfAborted()
          if (workflowStore.getState().appId !== appId)
            throw new Error(t(($) => $['common.draftSaveFailed']))
          if (requestLeader) {
            const generation = workflowStore.getState().workflowDraftGeneration
            saved = await collaborationManager.requestWorkflowSync()
            signal.throwIfAborted()
            if (
              workflowStore.getState().appId !== appId ||
              workflowStore.getState().workflowDraftGeneration !== generation
            )
              throw new Error(t(($) => $['common.draftSaveFailed']))
            state.setSyncWorkflowDraftHash(saved.hash)
            state.setDraftUpdatedAt(saved.updatedAt)
          }
        }
        signal.throwIfAborted()
        if (workflowStore.getState().appId !== appId)
          throw new Error(t(($) => $['common.draftSaveFailed']))
        if (workflowStore.getState().hasWorkflowDraftConflict)
          throw new Error(t(($) => $['draftConflict.message']))
        if (shouldSave && !saved) throw new Error(t(($) => $['common.draftSaveFailed']))
        state.invalidateWorkflowDraftSync()
        state.setWorkflowDraftSyncPhase('builder')
      } catch (error) {
        if (workflowStore.getState().appId === appId) {
          state.setWorkflowDraftSyncPhase(signal.aborted ? 'builder' : 'idle')
          if (error instanceof Error && error.message === 'draft_workflow_not_sync') {
            state.setWorkflowDraftConflict(true)
            throw new Error(t(($) => $['draftConflict.message']))
          }
        }
        throw error
      }
    },
    [getNodesReadOnly, getPostParams, isCollaborationEnabled, performLocalSync, t, workflowStore],
  )

  return {
    doSyncWorkflowDraft,
    prepareWorkflowDraftForBuilder,
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
