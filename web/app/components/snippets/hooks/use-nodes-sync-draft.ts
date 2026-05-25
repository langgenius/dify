import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { SnippetInputField } from '@/models/snippet'
import type { SnippetDraftSyncPayload, SnippetWorkflow } from '@/types/snippet'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { consoleClient } from '@/service/client'
import { postWithKeepalive } from '@/service/fetch'
import { useSnippetDetailStore } from '../store'
import { useSnippetRefreshDraft } from './use-snippet-refresh-draft'

const isSyncConflictError = (error: unknown): error is { bodyUsed: boolean, json: () => Promise<{ code?: string }> } => {
  return !!error
    && typeof error === 'object'
    && 'bodyUsed' in error
    && 'json' in error
    && typeof error.json === 'function'
}

type SyncInputFieldsDraftCallback = SyncDraftCallback & {
  onRefresh?: (inputFields: SnippetInputField[]) => void
}

export const useNodesSyncDraft = (snippetId: string) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useSnippetRefreshDraft(snippetId)

  const getInputFieldsSyncPayload = useCallback((inputFields?: SnippetInputField[]) => {
    return {
      input_fields: inputFields ?? useSnippetDetailStore.getState().fields,
    }
  }, [])

  const getDraftSyncPayload = useCallback((inputFields?: SnippetInputField[]) => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const nodes = getNodes().filter(node => !node.data?._isTempNode)
    const [x, y, zoom] = transform
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
      ...getInputFieldsSyncPayload(inputFields),
      graph: {
        nodes: producedNodes,
        edges: producedEdges,
        viewport: { x, y, zoom },
      },
    }
  }, [getInputFieldsSyncPayload, snippetId, store])

  const syncDraft = useCallback(async (
    payload: Omit<SnippetDraftSyncPayload, 'hash'>,
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
    onRefresh?: (draftWorkflow: SnippetWorkflow) => void,
  ) => {
    if (getNodesReadOnly())
      return

    if (!snippetId)
      return

    const {
      setDraftUpdatedAt,
      setSyncWorkflowDraftHash,
      syncWorkflowDraftHash,
    } = workflowStore.getState()

    try {
      const response = await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId },
        body: {
          ...payload,
          hash: syncWorkflowDraftHash || undefined,
        },
      })

      setSyncWorkflowDraftHash(response.hash)
      setDraftUpdatedAt(response.updated_at)
      callback?.onSuccess?.()
    }
    catch (error: unknown) {
      if (isSyncConflictError(error) && !error.bodyUsed) {
        error.json().then((err) => {
          if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
            handleRefreshWorkflowDraft(onRefresh)
        })
      }
      callback?.onError?.()
    }
    finally {
      callback?.onSettled?.()
    }
  }, [getNodesReadOnly, handleRefreshWorkflowDraft, snippetId, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return

    const draftPayload = getDraftSyncPayload()
    if (!draftPayload)
      return

    const { syncWorkflowDraftHash } = workflowStore.getState()
    postWithKeepalive(`${API_PREFIX}/snippets/${snippetId}/workflows/draft`, {
      ...draftPayload,
      hash: syncWorkflowDraftHash,
    })
  }, [getDraftSyncPayload, getNodesReadOnly, snippetId, workflowStore])

  const performSync = useCallback(async (
    draftPayload: Omit<SnippetDraftSyncPayload, 'hash'> | null,
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
  ) => {
    if (!draftPayload)
      return

    await syncDraft(draftPayload, notRefreshWhenSyncError, callback)
  }, [syncDraft])

  const performInputFieldsSync = useCallback(async (
    draftPayload: Omit<SnippetDraftSyncPayload, 'hash'> | null,
    callback?: SyncInputFieldsDraftCallback,
  ) => {
    if (!draftPayload)
      return

    await syncDraft(
      draftPayload,
      false,
      callback,
      (draftWorkflow) => {
        const refreshedInputFields = Array.isArray(draftWorkflow.input_fields)
          ? draftWorkflow.input_fields as SnippetInputField[]
          : []
        callback?.onRefresh?.(refreshedInputFields)
      },
    )
  }, [syncDraft])

  const syncWorkflowDraftWithPayload = useSerialAsyncCallback(performSync, getNodesReadOnly)
  const syncInputFieldsDraftWithPayload = useSerialAsyncCallback(performInputFieldsSync)

  const doSyncWorkflowDraft = useCallback((
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
  ) => {
    if (getNodesReadOnly())
      return Promise.resolve()

    const draftPayload = getDraftSyncPayload()
    return syncWorkflowDraftWithPayload(draftPayload, notRefreshWhenSyncError, callback)
  }, [getDraftSyncPayload, getNodesReadOnly, syncWorkflowDraftWithPayload])

  const syncInputFieldsDraft = useCallback((
    inputFields: SnippetInputField[],
    callback?: SyncInputFieldsDraftCallback,
  ) => {
    const draftPayload = getDraftSyncPayload(inputFields)
    return syncInputFieldsDraftWithPayload(draftPayload, callback)
  }, [getDraftSyncPayload, syncInputFieldsDraftWithPayload])

  return {
    doSyncWorkflowDraft,
    syncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
