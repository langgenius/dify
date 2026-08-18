'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export function AddSourceExitDialog({
  discarding,
  error,
  onCancel,
  onConfirm,
  open,
}: {
  discarding: boolean
  error: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !discarding) onCancel()
      }}
    >
      <AlertDialogContent className="w-120 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-lg">
        <div className="flex flex-col items-start gap-2 self-stretch p-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.discardSourceDraftTitle'])}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div />}
            className="system-md-regular text-text-secondary"
          >
            {t(($) => $['newKnowledge.discardSourceDraftDescription'])}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {t(($) => $['newKnowledge.discardSourceDraftFailed'])}
            </p>
          )}
        </div>
        <AlertDialogActions className="gap-2 p-6">
          <AlertDialogCancelButton variant="secondary" disabled={discarding}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton loading={discarding} disabled={discarding} onClick={onConfirm}>
            {t(($) => $['newKnowledge.discardDraftConfirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
