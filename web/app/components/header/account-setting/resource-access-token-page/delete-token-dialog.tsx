'use client'

import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
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
    <AlertDialogContent className="w-120 p-6 text-left" backdropProps={{ forceRender: true }}>
      <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'accountSettings' })}
      </AlertDialogTitle>
      <AlertDialogDescription className="mt-2 system-sm-regular text-text-tertiary">
        {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'accountSettings' })}
      </AlertDialogDescription>
      <AlertDialogFooter className="mt-6 p-0">
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
