import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks/use-workflow'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()

  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const [x, y, zoom] = transform
    const {
      pipelineId,
      environmentVariables,
      syncWorkflowDraftHash,
    } = workflowStore.getState()

    if (pipelineId) {
      const nodes = getNodes()

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
        url: `/rag/pipeline/${pipelineId}/workflows/draft`,
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
          hash: syncWorkflowDraftHash,
        },
      }
    }
  }, [store, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    return true
  }, [])

  const doSyncWorkflowDraft = useCallback(async () => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams()

    if (postParams)
      return true
  }, [getPostParams, getNodesReadOnly])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
