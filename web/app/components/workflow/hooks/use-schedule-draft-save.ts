import type { SyncDraftCallback } from '../hooks-store'
import { useCallback } from 'react'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '../store'
import { useNodesReadOnly } from './use-workflow'

export const useScheduleDraftSave = () => {
  const { getNodesReadOnly } = useNodesReadOnly()
  const debouncedSyncWorkflowDraft = useStore((s) => s.debouncedSyncWorkflowDraft)
  const onDraftChange = useHooksStore((s) => s.onDraftChange)
  const doSyncWorkflowDraft = useHooksStore((s) => s.doSyncWorkflowDraft)
  const syncWorkflowDraftWhenPageClose = useHooksStore((s) => s.syncWorkflowDraftWhenPageClose)

  const handleSyncWorkflowDraft = useCallback(
    (sync?: boolean, notRefreshWhenSyncError?: boolean, callback?: SyncDraftCallback) => {
      if (getNodesReadOnly()) return

      onDraftChange()
      if (sync) return doSyncWorkflowDraft(notRefreshWhenSyncError, callback)

      debouncedSyncWorkflowDraft(doSyncWorkflowDraft)
    },
    [debouncedSyncWorkflowDraft, doSyncWorkflowDraft, getNodesReadOnly, onDraftChange],
  )

  return {
    doSyncWorkflowDraft,
    handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
