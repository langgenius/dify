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

export type CreateKnowledgeExitReason = 'discard' | 'partial'

export function CreateKnowledgeExitDialog({
  onCancel,
  onConfirm,
  reason,
}: {
  onCancel: () => void
  onConfirm: () => void
  reason: CreateKnowledgeExitReason | null
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const isPartial = reason === 'partial'

  return (
    <AlertDialog
      open={reason !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent className="w-120 overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-lg">
        <div className="flex flex-col items-start gap-2 self-stretch p-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) =>
              isPartial
                ? $['newKnowledge.leavePartialSetupTitle']
                : $['newKnowledge.discardDraftTitle'],
            )}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div />}
            className="system-md-regular text-text-secondary"
          >
            {t(($) =>
              isPartial
                ? $['newKnowledge.leavePartialSetupDescription']
                : $['newKnowledge.discardDraftDescription'],
            )}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="gap-2 p-6">
          <AlertDialogCancelButton variant="secondary">
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm}>
            {t(($) =>
              isPartial
                ? $['newKnowledge.leavePartialSetupConfirm']
                : $['newKnowledge.discardDraftConfirm'],
            )}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
