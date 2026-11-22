'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialogBody,
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
  canDelete,
  error,
  finalFocus,
  onConfirm,
}: {
  isPending: boolean
  canDelete: boolean
  error: string | undefined
  finalFocus: AlertDialogContentProps['finalFocus']
  onConfirm: () => void
}) {
  const { t } = useTranslation(['common', 'accountSettings'])

  return (
    <AlertDialogContent backdropProps={{ forceRender: true }} finalFocus={finalFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'accountSettings' })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'accountSettings' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <AlertDialogBody>
          <p role="alert" className="text-text-destructive">
            {error}
          </p>
        </AlertDialogBody>
      )}
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton disabled={!canDelete} loading={isPending} onClick={onConfirm}>
          {t(($) => $['operation.delete'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
