import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useWorkflowRefreshDraft } from '../hooks/use-workflow-refresh-draft'

const WorkflowDraftConflict = () => {
  const { t } = useTranslation(['workflow'])
  const hasConflict = useStore((s) => s.hasWorkflowDraftConflict)
  const conflictId = useStore((s) => s.workflowDraftConflictId)
  const isRefreshing = useStore((s) => s.isSyncingWorkflowDraft)
  const [dismissedConflictId, setDismissedConflictId] = useState<number | null>(null)
  const [failedConflictId, setFailedConflictId] = useState<number | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const open = hasConflict && dismissedConflictId !== conflictId

  const handleReload = async () => {
    setFailedConflictId(null)
    const refreshed = await handleRefreshWorkflowDraft(false, { resolveConflict: true })
    if (refreshed === 'failed') setFailedConflictId(conflictId)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isRefreshing) {
          details.cancel()
          return
        }
        setDismissedConflictId(nextOpen ? null : conflictId)
      }}
    >
      {hasConflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-state-warning-active bg-state-warning-hover px-4 py-3">
          <div
            role={open ? undefined : 'alert'}
            className="min-w-0 flex-1 system-sm-regular text-text-secondary"
          >
            <p className="system-sm-medium text-text-warning">
              {t(($) => $['draftConflict.message'])}
            </p>
          </div>
          <AlertDialogTrigger render={<Button variant="secondary" />}>
            {t(($) => $['draftConflict.resolve'])}
          </AlertDialogTrigger>
        </div>
      )}
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(($) => $['draftConflict.title'])}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['draftConflict.description'])}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failedConflictId === conflictId && (
          <AlertDialogBody>
            <p role="alert" className="system-sm-regular text-text-destructive">
              {t(($) => $['draftConflict.reloadFailed'])}
            </p>
          </AlertDialogBody>
        )}
        <AlertDialogFooter>
          <AlertDialogCancelButton ref={cancelRef} disabled={isRefreshing}>
            {t(($) => $['draftConflict.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            className="h-auto min-h-8 max-w-full py-2 whitespace-normal"
            loading={isRefreshing}
            onClick={handleReload}
          >
            {t(($) => $['draftConflict.confirmReload'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default WorkflowDraftConflict
