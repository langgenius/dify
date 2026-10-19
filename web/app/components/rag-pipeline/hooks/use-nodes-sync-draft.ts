import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { safe } from '@orpc/client'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { consoleClient } from '@/service/console'
import { postWithKeepalive } from '@/service/fetch'
import { usePipelineRefreshDraft } from './use-pipeline-refresh-draft'

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const store = useStoreApi()
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useWorkflowStore()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()

  const getPostParams = useCallback(() => {
    const { getNodes, edges, transform } = store.getState()
    const nodesOriginal = getNodes()
    const nodes = nodesOriginal.filter((node) => !node.data._isTempNode)
    const [x, y, zoom] = transform
    const { environmentVariables, syncWorkflowDraftHash, ragPipelineVariables } =
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
        pipelineId,
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
  }, [store, workflowStore, pipelineId])

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
      const [error, res, isDefined] = await safe(
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.post(
          {
            params: { pipeline_id: baseParams.pipelineId },
            body: { ...baseParams.params, hash: syncWorkflowDraftHash },
          },
          { context: { silent: true } },
        ),
      )
      try {
        if (error) {
          if (isDefined && error.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
            handleRefreshWorkflowDraft()
          callback?.onError?.()
          return
        }
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
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
