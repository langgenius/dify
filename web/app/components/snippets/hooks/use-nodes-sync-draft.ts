import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { SnippetInputField } from '@/models/snippet'
import type {
  SnippetDraftSyncPayload,
  SnippetDraftSyncResponse,
  SnippetWorkflow,
} from '@/types/snippet'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useNodesReadOnlyByCanEdit } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import { consoleClient } from '@/service/client'
// eslint-disable-next-line no-restricted-imports
import { postWithKeepalive } from '@/service/fetch'
import { useSnippetDraftStore } from '../draft-store'
import { useSnippetRefreshDraft } from './use-snippet-refresh-draft'

const isSyncConflictError = (
  error: unknown,
): error is { bodyUsed: boolean; json: () => Promise<{ code?: string }> } => {
  return (
    !!error &&
    typeof error === 'object' &&
    'bodyUsed' in error &&
    'json' in error &&
    typeof error.json === 'function'
  )
}

type SyncInputFieldsDraftCallback = SyncDraftCallback & {
  onRefresh?: (inputFields: SnippetInputField[]) => void
}

const snippetDraftSyncQueues = new Map<string, Promise<unknown>>()

const enqueueSnippetDraftSync = <Result>(
  snippetId: string,
  task: () => Promise<Result> | Result,
) => {
  const previousTask =
    snippetDraftSyncQueues.get(snippetId)?.catch(() => undefined) ?? Promise.resolve()
  const nextTask = previousTask.then(task)

  snippetDraftSyncQueues.set(snippetId, nextTask)
  const cleanup = () => {
    if (snippetDraftSyncQueues.get(snippetId) === nextTask) snippetDraftSyncQueues.delete(snippetId)
  }
  void nextTask.then(cleanup, cleanup)

  return nextTask
}

export const useNodesSyncDraft = (snippetId: string) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnlyByCanEdit(true)
  const { handleRefreshWorkflowDraft } = useSnippetRefreshDraft(snippetId)

  const getInputFieldsSyncPayload = useCallback((inputFields?: SnippetInputField[]) => {
    return {
      input_fields: inputFields ?? useSnippetDraftStore.getState().inputFields,
    }
  }, [])

  const getDraftSyncPayload = useCallback(
    (inputFields?: SnippetInputField[]) => {
      const { getNodes, edges, transform } = store.getState()
      const nodes = getNodes().filter((node) => !node.data?._isTempNode)
      const [x, y, zoom] = transform
      if (!snippetId) return null

      const producedNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_')) delete node.data[key]
          })
        })
      })
      const producedEdges = produce(
        edges.filter((edge) => !edge.data?._isTemp),
        (draft) => {
          draft.forEach((edge) => {
            Object.keys(edge.data).forEach((key) => {
              if (key.startsWith('_')) delete edge.data[key]
            })
          })
        },
      )

      return {
        ...getInputFieldsSyncPayload(inputFields),
        graph: {
          nodes: producedNodes,
          edges: producedEdges,
          viewport: { x, y, zoom },
        },
      }
    },
    [getInputFieldsSyncPayload, snippetId, store],
  )

  const syncDraft = useCallback(
    async (
      payload: Omit<SnippetDraftSyncPayload, 'hash'>,
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      onRefresh?: (draftWorkflow: SnippetWorkflow) => void,
    ): Promise<SnippetDraftSyncResponse | undefined> => {
      if (getNodesReadOnly()) return

      if (!snippetId) return

      const { setDraftUpdatedAt, setSyncWorkflowDraftHash, syncWorkflowDraftHash } =
        workflowStore.getState()

      try {
        const response = await consoleClient.snippets.bySnippetId.workflows.draft.post({
          params: { snippet_id: snippetId },
          body: {
            ...payload,
            hash: syncWorkflowDraftHash || undefined,
          },
        })

        setSyncWorkflowDraftHash(response.hash)
        setDraftUpdatedAt(response.updated_at)
        callback?.onSuccess?.()
        return response
      } catch (error: unknown) {
        if (isSyncConflictError(error) && !error.bodyUsed) {
          error.json().then((err) => {
            if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
              handleRefreshWorkflowDraft(onRefresh)
          })
        }
        callback?.onError?.()
        return undefined
      } finally {
        callback?.onSettled?.()
      }
    },
    [getNodesReadOnly, handleRefreshWorkflowDraft, snippetId, workflowStore],
  )

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly()) return

    const draftPayload = getDraftSyncPayload()
    if (!draftPayload) return

    const { syncWorkflowDraftHash } = workflowStore.getState()
    postWithKeepalive(`${API_PREFIX}/snippets/${snippetId}/workflows/draft`, {
      ...draftPayload,
      hash: syncWorkflowDraftHash,
    })
  }, [getDraftSyncPayload, getNodesReadOnly, snippetId, workflowStore])

  const syncWorkflowDraftWithPayload = useCallback(
    async (
      draftPayload: Omit<SnippetDraftSyncPayload, 'hash'> | null,
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
    ) => {
      if (!draftPayload) return

      const response = await enqueueSnippetDraftSync(snippetId, () =>
        syncDraft(draftPayload, notRefreshWhenSyncError, callback),
      )
      return response ? draftPayload : undefined
    },
    [snippetId, syncDraft],
  )

  const syncInputFieldsDraftWithPayload = useCallback(
    async (
      draftPayload: Omit<SnippetDraftSyncPayload, 'hash'> | null,
      callback?: SyncInputFieldsDraftCallback,
    ) => {
      if (!draftPayload) return

      const response = await enqueueSnippetDraftSync(snippetId, () =>
        syncDraft(draftPayload, false, callback, (draftWorkflow) => {
          const refreshedInputFields = Array.isArray(draftWorkflow.input_fields)
            ? (draftWorkflow.input_fields as SnippetInputField[])
            : []
          callback?.onRefresh?.(refreshedInputFields)
        }),
      )
      return response ? draftPayload : undefined
    },
    [snippetId, syncDraft],
  )

  const doSyncWorkflowDraft = useCallback(
    (notRefreshWhenSyncError?: boolean, callback?: SyncDraftCallback) => {
      if (getNodesReadOnly()) return Promise.resolve()

      const draftPayload = getDraftSyncPayload()
      return syncWorkflowDraftWithPayload(draftPayload, notRefreshWhenSyncError, callback)
    },
    [getDraftSyncPayload, getNodesReadOnly, syncWorkflowDraftWithPayload],
  )

  const syncInputFieldsDraft = useCallback(
    (inputFields: SnippetInputField[], callback?: SyncInputFieldsDraftCallback) => {
      const draftPayload = getDraftSyncPayload(inputFields)
      return syncInputFieldsDraftWithPayload(draftPayload, callback)
    },
    [getDraftSyncPayload, syncInputFieldsDraftWithPayload],
  )

  return {
    doSyncWorkflowDraft,
    syncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
