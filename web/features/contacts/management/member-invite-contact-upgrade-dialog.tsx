'use client'

import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['memberInviteUpgrade.title'], { count: conflictCount })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['memberInviteUpgrade.description'], { count: conflictCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
