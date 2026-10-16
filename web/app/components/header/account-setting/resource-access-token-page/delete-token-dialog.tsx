'use client'

import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export function DeleteTokenDialogContent({
  isPending,
  onConfirm,
}: {
  isPending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation(['common', 'accountSettings'])

  return (
    <AlertDialogContent backdropProps={{ forceRender: true }}>
      <AlertDialogHeader className="pb-0">
        <AlertDialogTitle>
          {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'accountSettings' })}
        </AlertDialogTitle>
        <AlertDialogDescription className="system-sm-regular">
          {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'accountSettings' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['operation.delete'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
