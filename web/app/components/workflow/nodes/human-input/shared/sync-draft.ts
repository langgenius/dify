import type { useScheduleDraftSave } from '@/app/components/workflow/hooks/use-schedule-draft-save'

export class HumanInputDraftSyncError extends Error {
  constructor() {
    super('Human Input draft could not be saved')
    this.name = 'HumanInputDraftSyncError'
  }
}

export const syncHumanInputDraft = async (
  syncDraft: ReturnType<typeof useScheduleDraftSave>['doSyncWorkflowDraft'],
): Promise<void> => {
  let saved = false
  let failed = false
  const result = await syncDraft(true, {
    onSuccess: () => {
      saved = true
    },
    onError: () => {
      failed = true
    },
  })
  if (failed || (!saved && result == null)) throw new HumanInputDraftSyncError()
}
