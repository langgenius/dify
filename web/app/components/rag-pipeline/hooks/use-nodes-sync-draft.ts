import { useCallback } from 'react'
import { produce } from 'immer'
import { useStoreApi } from 'reactflow'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks/use-workflow'
import { API_PREFIX } from '@/config'
import { syncWorkflowDraft } from '@/service/workflow'
import { usePipelineRefreshDraft } from '.'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()

  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const nodesOriginal = getNodes()
    const nodes = nodesOriginal.filter(node => !node.data._isTempNode)
    const [x, y, zoom] = transform
    const {
      pipelineId,
      environmentVariables,
      syncWorkflowDraftHash,
      ragPipelineVariables,
    } = workflowStore.getState()

    if (pipelineId && !!nodes.length) {
      const producedNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_'))
              delete edge.data[key]
          })
        })
      })
      return {
        url: `/rag/pipelines/${pipelineId}/workflows/draft`,
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
          environment_variables: environmentVariables,
          rag_pipeline_variables: ragPipelineVariables,
          hash: syncWorkflowDraftHash,
        },
      }
    }
  }, [store, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams()

    if (postParams) {
      navigator.sendBeacon(
        `${API_PREFIX}${postParams.url}`,
        JSON.stringify(postParams.params),
      )
    }
  }, [getPostParams, getNodesReadOnly])

  const doSyncWorkflowDraft = useCallback(async (
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
  }, [getPostParams, getNodesReadOnly, workflowStore, handleRefreshWorkflowDraft])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
