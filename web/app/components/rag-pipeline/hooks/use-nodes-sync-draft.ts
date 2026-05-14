import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { normalizeNodeDimensionsForReactFlowV12 } from '@/app/components/workflow/utils/workflow-init'
import { API_PREFIX } from '@/config'
import { parseResponseError, postWithKeepalive } from '@/service/fetch'
import { syncWorkflowDraft } from '@/service/workflow'
import { usePipelineRefreshDraft } from '.'

export const useNodesSyncDraft = () => {
  const store = useWorkflowStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()

  const getPostParams = useCallback(() => {
    const {
      nodes,
      edges,
      transform,
    } = store.getState()
    const validNodes = nodes.filter(node => !node.data._isTempNode)
    const [x, y, zoom] = transform
    const {
      pipelineId,
      environmentVariables,
      syncWorkflowDraftHash,
      ragPipelineVariables,
    } = workflowStore.getState()

    if (pipelineId && !!validNodes.length) {
      const producedNodes = produce(validNodes, (draft) => {
        draft.forEach((node) => {
          normalizeNodeDimensionsForReactFlowV12(node)
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          const data = edge.data as typeof edge.data & Record<string, unknown>
          Object.keys(data).forEach((key) => {
            if (key.startsWith('_'))
              delete data[key]
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

    if (postParams)
      postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly])

  const performSync = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
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
        const err = await parseResponseError(error)
        if (err?.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
          handleRefreshWorkflowDraft()
        callback?.onError?.()
      }
      finally {
        callback?.onSettled?.()
      }
    }
  }, [getPostParams, getNodesReadOnly, workflowStore, handleRefreshWorkflowDraft])

  const doSyncWorkflowDraft = useSerialAsyncCallback(performSync, getNodesReadOnly)

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
