'use client'

import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export function MemberInviteContactUpgradeDialog({
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
  const { t } = useTranslation(['contacts'])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['memberInviteUpgrade.title'], { count: conflictCount })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular wrap-break-word text-text-tertiary">
            {t(($) => $['memberInviteUpgrade.description'], { count: conflictCount })}
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary" disabled={pending}>
            {t(($) => $['action.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            {t(($) => $['memberInviteUpgrade.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
