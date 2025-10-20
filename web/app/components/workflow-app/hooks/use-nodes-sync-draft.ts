import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useParams } from 'next/navigation'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks/use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { API_PREFIX } from '@/config'
import { useWorkflowRefreshDraft } from '.'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const params = useParams()

  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const nodes = getNodes()
    const [x, y, zoom] = transform
    const {
      appId,
      conversationVariables,
      environmentVariables,
      syncWorkflowDraftHash,
    } = workflowStore.getState()

    if (appId && !!nodes.length) {
      const hasStartNode = nodes.find(node => node.data.type === BlockEnum.Start)

      if (!hasStartNode)
        return

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
          _is_collaborative: true,
        },
      }
    }
  }, [store, featuresStore, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return

    // Check leader status at sync time
    const currentIsLeader = collaborationManager.getIsLeader()

    // Only allow leader to sync data
    if (!currentIsLeader) {
      console.log('Not leader, skipping sync on page close')
      return
    }

    const postParams = getPostParams()

    if (postParams) {
      console.log('Leader syncing workflow draft on page close')
      navigator.sendBeacon(
        `${API_PREFIX}/apps/${params.appId}/workflows/draft`,
        JSON.stringify(postParams.params),
      )
    }
  }, [getPostParams, params.appId, getNodesReadOnly])

  const doSyncWorkflowDraft = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    },
    forceUpload?: boolean,
  ) => {
    if (getNodesReadOnly())
      return

    // Check leader status at sync time
    const currentIsLeader = collaborationManager.getIsLeader()

    // If not leader and not forcing upload, request the leader to sync
    if (!currentIsLeader && !forceUpload) {
      console.log('Not leader, requesting leader to sync workflow draft')
      collaborationManager.emitSyncRequest()
      callback?.onSettled?.()
      return
    }

    console.log(forceUpload ? 'Force uploading workflow draft' : 'Leader performing workflow draft sync')
    const postParams = getPostParams()

    if (postParams) {
      const {
        setSyncWorkflowDraftHash,
        setDraftUpdatedAt,
      } = workflowStore.getState()

      // Add force_upload parameter if needed
      const finalParams = {
        ...postParams.params,
        ...(forceUpload && { force_upload: true }),
      }

      try {
        const res = await syncWorkflowDraft({
          url: postParams.url,
          params: finalParams,
        })
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)

        console.log('Leader successfully synced workflow draft')
        callback?.onSuccess?.()
      }
      catch (error: any) {
        console.error('Leader failed to sync workflow draft:', error)
        if (error && error.json && !error.bodyUsed) {
          error.json().then((err: any) => {
            if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError) {
              console.error('draft_workflow_not_sync', err)
              handleRefreshWorkflowDraft()
            }
          })
        }
        callback?.onError?.()
      }
      finally {
        callback?.onSettled?.()
      }
    }
  }, [workflowStore, getPostParams, getNodesReadOnly, handleRefreshWorkflowDraft])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
