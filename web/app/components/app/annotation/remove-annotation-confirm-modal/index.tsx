'use client'
import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

type RemoveAnnotationConfirmContentProps = {
  isPending: boolean
  onRemove: () => void
}

export function RemoveAnnotationConfirmContent({
  isPending,
  onRemove,
}: RemoveAnnotationConfirmContentProps) {
  const { t } = useTranslation(['appDebug', 'common'])
  const title = t(($) => $['feature.annotation.removeConfirm'], { ns: 'appDebug' })

  return (
    <AlertDialogContent backdropProps={{ forceRender: true }}>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onRemove}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
