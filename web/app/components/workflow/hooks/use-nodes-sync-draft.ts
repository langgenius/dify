import { useCallback } from 'react'
import {
  useStore,
} from '../store'
import {
  useNodesReadOnly,
} from './use-workflow'
import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useNodesSyncDraft = () => {
  const { getNodesReadOnly } = useNodesReadOnly()
  const debouncedSyncWorkflowDraft = useStore(s => s.debouncedSyncWorkflowDraft)
  const doSyncWorkflowDraft = useHooksStore(s => s.doSyncWorkflowDraft)
  const syncWorkflowDraftWhenPageClose = useHooksStore(s => s.syncWorkflowDraftWhenPageClose)

  const handleSyncWorkflowDraft = useCallback((
    sync?: boolean,
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    },
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
