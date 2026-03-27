import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { consoleClient } from '@/service/client'
import { postWithKeepalive } from '@/service/fetch'
import { useSnippetRefreshDraft } from './use-snippet-refresh-draft'

const isSyncConflictError = (error: unknown): error is { bodyUsed: boolean, json: () => Promise<{ code?: string }> } => {
  return !!error
    && typeof error === 'object'
    && 'bodyUsed' in error
    && 'json' in error
    && typeof error.json === 'function'
}

export const useNodesSyncDraft = (snippetId: string) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useSnippetRefreshDraft(snippetId)

  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const nodes = getNodes().filter(node => !node.data?._isTempNode)
    const [x, y, zoom] = transform
    const { syncWorkflowDraftHash } = workflowStore.getState()

    if (!snippetId)
      return null

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
      url: `/snippets/${snippetId}/workflows/draft`,
      params: {
        graph: {
          nodes: producedNodes,
          edges: producedEdges,
          viewport: { x, y, zoom },
        },
        hash: syncWorkflowDraftHash,
      },
    }
  }, [snippetId, store, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return

    const postParams = getPostParams()
    if (postParams)
      postWithKeepalive(`${API_PREFIX}${postParams.url}`, postParams.params)
  }, [getNodesReadOnly, getPostParams])

  const performSync = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
  ) => {
    if (getNodesReadOnly())
      return

    const postParams = getPostParams()
    if (!postParams)
      return

    const {
      setDraftUpdatedAt,
      setSyncWorkflowDraftHash,
    } = workflowStore.getState()

    try {
      const response = await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId },
        body: postParams.params,
      })

      setSyncWorkflowDraftHash(response.hash)
      setDraftUpdatedAt(response.updated_at)
      callback?.onSuccess?.()
    }
    catch (error: unknown) {
      if (isSyncConflictError(error) && !error.bodyUsed) {
        error.json().then((err) => {
          if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
            handleRefreshWorkflowDraft()
        })
      }
      callback?.onError?.()
    }
    finally {
      callback?.onSettled?.()
    }
  }, [getNodesReadOnly, getPostParams, handleRefreshWorkflowDraft, snippetId, workflowStore])

  const doSyncWorkflowDraft = useSerialAsyncCallback(performSync, getNodesReadOnly)

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
