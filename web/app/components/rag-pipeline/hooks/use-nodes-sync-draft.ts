import type { SyncDraftCallback, SyncDraftResult } from '@/app/components/workflow/hooks-store'
import { safe } from '@orpc/client'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import { API_PREFIX } from '@/config'
import { consoleClient } from '@/service/console'
import { postWithKeepalive } from '@/service/fetch'
import { useRagPipelineStore } from '../store'
import { usePipelineRefreshDraft } from './use-pipeline-refresh-draft'

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const store = useStoreApi()
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useRagPipelineStore()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()

  const getPostParams = useCallback(() => {
    const { getNodes, edges, transform } = store.getState()
    const nodesOriginal = getNodes()
    const nodes = nodesOriginal.filter((node) => !node.data._isTempNode)
    const [x, y, zoom] = transform
    const {
      environmentVariables,
      syncWorkflowDraftHash,
      ragPipelineVariables,
      pipelineDraftGeneration,
    } = workflowStore.getState()

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
        generation: pipelineDraftGeneration,
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
    ): Promise<SyncDraftResult | null> => {
      if (
        getNodesReadOnly() ||
        baseParams.generation !== workflowStore.getState().pipelineDraftGeneration ||
        workflowStore.getState().isSyncingWorkflowDraft
      ) {
        callback?.onSettled?.()
        return null
      }

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
        if (baseParams.generation !== workflowStore.getState().pipelineDraftGeneration) return null
        if (error) {
          if (isDefined && error.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
            handleRefreshWorkflowDraft()
          callback?.onError?.()
          return null
        }
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at }
      } finally {
        callback?.onSettled?.()
      }
    },
    [getNodesReadOnly, workflowStore, handleRefreshWorkflowDraft],
  )

  const doSyncWorkflowDraft = useCallback(
    (notRefreshWhenSyncError?: boolean, callback?: SyncDraftCallback) => {
      if (getNodesReadOnly() || workflowStore.getState().isSyncingWorkflowDraft)
        return Promise.resolve(null)

      // Capture before ReactFlow resets its store during route unmount.
      const postParams = getPostParams()
      if (!postParams) return Promise.resolve(null)

      return workflowStore
        .getState()
        .enqueuePipelineDraftOperation(() =>
          performSync(postParams, notRefreshWhenSyncError, callback),
        )
    },
    [getNodesReadOnly, getPostParams, performSync, workflowStore],
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
