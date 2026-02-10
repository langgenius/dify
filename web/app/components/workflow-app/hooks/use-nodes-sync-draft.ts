import type { WorkflowDraftFeaturesPayload } from '@/service/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { postWithKeepalive } from '@/service/fetch'
import { syncWorkflowDraft } from '@/service/workflow'
import { useWorkflowRefreshDraft } from '.'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)

  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const nodes = getNodes().filter(node => !node.data?._isTempNode)
    const [x, y, zoom] = transform
    const {
      appId,
      conversationVariables,
      environmentVariables,
      syncWorkflowDraftHash,
      isWorkflowDataLoaded,
    } = workflowStore.getState()

    if (!appId || !isWorkflowDataLoaded)
      return null

    const features = featuresStore!.getState().features
    const producedNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        Object.keys(node.data).forEach((key) => {
          if (key.startsWith('_'))
            delete node.data[key]
        })
      })
    })
    const producedEdges = produce(edges.filter(edge => !edge.data?._isTemp), (draft) => {
      draft.forEach((edge) => {
        Object.keys(edge.data).forEach((key) => {
          if (key.startsWith('_'))
            delete edge.data[key]
        })
      })
    })
    const featuresPayload: WorkflowDraftFeaturesPayload = {
      opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
      suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
      sandbox: features.sandbox,
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
        environment_variables: environmentVariables,
        conversation_variables: conversationVariables,
        hash: syncWorkflowDraftHash,
        _is_collaborative: isCollaborationEnabled,
      },
    }
  }, [store, featuresStore, workflowStore, isCollaborationEnabled])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return

    // Check leader status at sync time
    const currentIsLeader = isCollaborationEnabled ? collaborationManager.getIsLeader() : true

    // Only allow leader to sync data
    if (isCollaborationEnabled && !currentIsLeader)
      return

    const postParams = getPostParams()

    if (postParams)
      postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly, isCollaborationEnabled])

  const performSync = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    },
  ) => {
    if (getNodesReadOnly())
      return

    // Check leader status at sync time
    const currentIsLeader = isCollaborationEnabled ? collaborationManager.getIsLeader() : true

    // If not leader, request the leader to sync
    if (isCollaborationEnabled && !currentIsLeader) {
      collaborationManager.emitSyncRequest()
      callback?.onSettled?.()
      return
    }

    const baseParams = getPostParams()
    if (!baseParams)
      return

    const {
      setSyncWorkflowDraftHash,
      setDraftUpdatedAt,
    } = workflowStore.getState()

    try {
      // IMPORTANT: Get the LATEST hash right before sending the request
      // This ensures that even if queued, each request uses the most recent hash
      const latestHash = workflowStore.getState().syncWorkflowDraftHash

      const postParams = {
        ...baseParams,
        params: {
          ...baseParams.params,
          hash: latestHash || null, // null for first-time, otherwise use latest hash
        },
      }

      const res = await syncWorkflowDraft({
        ...postParams,
        canNotSaveEmpty: true,
      })
      setSyncWorkflowDraftHash(res.hash)
      setDraftUpdatedAt(res.updated_at)
      callback?.onSuccess?.()
    }
    catch (error: any) {
      if (error && error.json && !error.bodyUsed) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
            handleRefreshWorkflowDraft()
        })
      }
      callback?.onError?.()
    }
    finally {
      callback?.onSettled?.()
    }
  }, [workflowStore, getPostParams, getNodesReadOnly, handleRefreshWorkflowDraft, isCollaborationEnabled])

  const doSyncWorkflowDraft = useSerialAsyncCallback(performSync, getNodesReadOnly)
  const syncWorkflowDraftImmediately = useCallback((
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    },
  ) => {
    return performSync(notRefreshWhenSyncError, callback)
  }, [performSync])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
    syncWorkflowDraftImmediately,
  }
}
