import type { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'

export class HumanInputDraftSyncError extends Error {
  constructor(options?: ErrorOptions) {
    super('Human Input draft could not be saved', options)
    this.name = 'HumanInputDraftSyncError'
  }
}

export const syncHumanInputDraft = async (
  syncDraft: ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft'],
): Promise<void> => {
  let saved = false
  let failed = false
  let cause: unknown
  const result = await syncDraft(true, {
    onSuccess: () => {
      saved = true
    },
    onError: (error?: unknown) => {
      failed = true
      cause = error
    },
  })
  if (failed || (!saved && result == null)) throw new HumanInputDraftSyncError({ cause })
}
