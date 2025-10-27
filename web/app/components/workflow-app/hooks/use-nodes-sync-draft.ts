import {
  useCallback,
  useRef,
} from 'react'
import { produce } from 'immer'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { API_PREFIX } from '@/config'
import { useWorkflowRefreshDraft } from '.'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())

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
    const viewport = { x, y, zoom }

    return {
      url: `/apps/${appId}/workflows/draft`,
      params: {
        graph: {
          nodes: producedNodes,
          edges: producedEdges,
          viewport,
        },
        features: {
          opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
          suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
          suggested_questions_after_answer: features.suggested,
          text_to_speech: features.text2speech,
          speech_to_text: features.speech2text,
          retriever_resource: features.citation,
          sensitive_word_avoidance: features.moderation,
          file_upload: features.file,
        },
        environment_variables: environmentVariables,
        conversation_variables: conversationVariables,
        hash: syncWorkflowDraftHash,
      },
    }
  }, [store, featuresStore, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams()

    if (postParams)
      navigator.sendBeacon(`${API_PREFIX}${postParams.url}`, JSON.stringify(postParams.params))
  }, [getPostParams, getNodesReadOnly])

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
    const postParams = getPostParams()

    if (postParams) {
      const {
        setSyncWorkflowDraftHash,
        setDraftUpdatedAt,
      } = workflowStore.getState()
      try {
        const res = await syncWorkflowDraft(postParams)
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
    }
  }, [workflowStore, getPostParams, getNodesReadOnly, handleRefreshWorkflowDraft])

  const doSyncWorkflowDraft = useCallback((notRefreshWhenSyncError?: boolean, callback?: {
    onSuccess?: () => void
    onError?: () => void
    onSettled?: () => void
  }) => {
    if (getNodesReadOnly())
      return Promise.resolve()

    const lastPromise = syncQueueRef.current.catch(() => undefined)
    const nextPromise = lastPromise.then(() => performSync(notRefreshWhenSyncError, callback))
    syncQueueRef.current = nextPromise

    return nextPromise
  }, [getNodesReadOnly, performSync])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
