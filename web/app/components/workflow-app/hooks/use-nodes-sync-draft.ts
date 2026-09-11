import type {
  SyncDraftCallback,
  SyncDraftOptions,
  SyncDraftResult,
} from '@/app/components/workflow/hooks-store'
import type { WorkflowDraftFeaturesPayload } from '@/service/workflow'
import { useSuspenseQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
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
import { syncWorkflowDraft } from '@/service/workflow'
import { useWorkflowRefreshDraft } from './use-workflow-refresh-draft'

const shouldSkipDraftSync = (
  appId: string | undefined,
  isWorkflowDataLoaded: boolean,
  isSyncingWorkflowDraft: boolean,
) => !appId || !isWorkflowDataLoaded || isSyncingWorkflowDraft || isAppDeletingOrDeleted(appId)

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const lastLocalSaveRef = useRef<{ appId: string; generation: number; hash: string } | null>(null)
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
      workflowDraftGeneration,
    } = workflowStore.getState()

    if (!appId || shouldSkipDraftSync(appId, isWorkflowDataLoaded, isSyncingWorkflowDraft))
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
    if (getNodesReadOnly()) return

    const canPersistOnPageClose =
      !isCollaborationEnabled ||
      collaborationManager.canFlushGraphOnPageClose() ||
      collaborationManager.canUseLocalDraftFallback()
    if (!canPersistOnPageClose) return

    const postParams = getPostParams()

    if (postParams) postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly, isCollaborationEnabled])

  const performLocalSync = useCallback(
    async (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
    ): Promise<SyncDraftResult | null> => {
      if (getNodesReadOnly()) return null
      const isCurrent = () => {
        const state = workflowStore.getState()
        return (
          state.appId === baseParams.appId &&
          state.workflowDraftGeneration === baseParams.generation &&
          !shouldSkipDraftSync(
            state.appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
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
        const lastSave = lastLocalSaveRef.current
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
        lastLocalSaveRef.current = {
          appId: baseParams.appId,
          generation: baseParams.generation,
          hash: res.hash,
        }
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at }
      } catch (error: unknown) {
        if (!isCurrent()) return null

        const responseError = error as {
          bodyUsed?: boolean
          json?: () => Promise<{ code?: string }>
        }
        if (responseError.json && !responseError.bodyUsed) {
          try {
            const err = await responseError.json()
            if (isCurrent() && err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
              handleRefreshWorkflowDraft(true)
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
    [workflowStore, getNodesReadOnly, handleRefreshWorkflowDraft, isCollaborationEnabled],
  )

  const doSyncWorkflowDraftLocally = useSerialAsyncCallback(performLocalSync, getNodesReadOnly)
  const doSyncWorkflowDraft = useCallback(
    async (
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
    ): Promise<SyncDraftResult | null> => {
      if (getNodesReadOnly()) return null
      const { appId, isWorkflowDataLoaded, isSyncingWorkflowDraft, workflowDraftGeneration } =
        workflowStore.getState()
      if (shouldSkipDraftSync(appId, isWorkflowDataLoaded, isSyncingWorkflowDraft)) {
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

        return doSyncWorkflowDraftLocally(baseParams, notRefreshWhenSyncError, callback, options)
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
      } catch {
        const state = workflowStore.getState()
        if (
          state.appId === appId &&
          state.workflowDraftGeneration === workflowDraftGeneration &&
          !shouldSkipDraftSync(
            state.appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
          )
        )
          callback?.onError?.()
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
