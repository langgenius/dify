import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { postWithKeepalive } from '@/service/fetch'
import { syncWorkflowDraft } from '@/service/workflow'
import { usePipelineRefreshDraft } from './use-pipeline-refresh-draft'

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()

  const getPostParams = useCallback(() => {
    const { getNodes, edges, transform } = store.getState()
    const nodesOriginal = getNodes()
    const nodes = nodesOriginal.filter((node) => !node.data._isTempNode)
    const [x, y, zoom] = transform
    const { pipelineId, environmentVariables, syncWorkflowDraftHash, ragPipelineVariables } =
      workflowStore.getState()

    if (pipelineId && !!nodes.length) {
      const producedNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_')) delete node.data[key]
          })
        })
      })
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_')) delete edge.data[key]
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
    if (getNodesReadOnly()) return
    const postParams = getPostParams()

    if (postParams) postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getPostParams, getNodesReadOnly])

  const performSync = useCallback(
    async (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
    ) => {
      if (getNodesReadOnly()) return

      const { setSyncWorkflowDraftHash, setDraftUpdatedAt, syncWorkflowDraftHash } =
        workflowStore.getState()
      const postParams = {
        ...baseParams,
        params: {
          ...baseParams.params,
          hash: syncWorkflowDraftHash,
        },
      }

      try {
        const res = await syncWorkflowDraft(postParams)
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
      } catch (error: any) {
        if (error && error.json && !error.bodyUsed) {
          error.json().then((err: any) => {
            if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
              handleRefreshWorkflowDraft()
          })
        }
        callback?.onError?.()
      } finally {
        callback?.onSettled?.()
      }
    },
    [getNodesReadOnly, workflowStore, handleRefreshWorkflowDraft],
  )

  const queueSyncWorkflowDraft = useSerialAsyncCallback(performSync, getNodesReadOnly)
  const doSyncWorkflowDraft = useCallback(
    (notRefreshWhenSyncError?: boolean, callback?: SyncDraftCallback) => {
      if (getNodesReadOnly()) return Promise.resolve()

      // Capture before ReactFlow resets its store during route unmount.
      const postParams = getPostParams()
      if (!postParams) return Promise.resolve()

      return queueSyncWorkflowDraft(postParams, notRefreshWhenSyncError, callback)
    },
    [getNodesReadOnly, getPostParams, queueSyncWorkflowDraft],
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
