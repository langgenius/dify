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

export function PlatformContactUpgradeDialog({
  conflictCount,
  onConfirm,
  onOpenChange,
  open,
  pending,
}: {
  conflictCount: number
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  pending: boolean
}) {
  const { t } = useTranslation('contacts')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {conflictCount === 1
              ? t(($) => $['platformPicker.upgrade.title_one'])
              : t(($) => $['platformPicker.upgrade.title_other'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular wrap-break-word text-text-tertiary">
            {conflictCount === 1
              ? t(($) => $['platformPicker.upgrade.description_one'])
              : t(($) => $['platformPicker.upgrade.description_other'], { count: conflictCount })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary" disabled={pending}>
            {t(($) => $['action.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            {t(($) => $['platformPicker.upgrade.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
