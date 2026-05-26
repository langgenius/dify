import type { SyncDraftCallback } from '../hooks-store/index'
import { useCallback } from 'react'
import { useHooksStore } from '../hooks-store'
import { useStore } from '../store/index'
import { useNodesReadOnly } from '../hooks/use-workflow'

export type SyncCallback = SyncDraftCallback

export const useNodesSyncDraft = () => {
  const { getNodesReadOnly } = useNodesReadOnly()
  const debouncedSyncWorkflowDraft = useStore(s => s.debouncedSyncWorkflowDraft)
  const doSyncWorkflowDraft = useHooksStore(s => s.doSyncWorkflowDraft)
  const syncWorkflowDraftWhenPageClose = useHooksStore(s => s.syncWorkflowDraftWhenPageClose)

  const handleSyncWorkflowDraft = useCallback((
    sync?: boolean,
    notRefreshWhenSyncError?: boolean,
    callback?: SyncDraftCallback,
  ) => {
    if (getNodesReadOnly())
      return

    if (sync)
      doSyncWorkflowDraft(notRefreshWhenSyncError, callback)
    else
      debouncedSyncWorkflowDraft(doSyncWorkflowDraft)
  }, [debouncedSyncWorkflowDraft, doSyncWorkflowDraft, getNodesReadOnly])

  return {
    doSyncWorkflowDraft,
    handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
