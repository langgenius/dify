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

type Props = Readonly<{
  isPending: boolean
  onRemove: () => void
}>

export function RemoveAnnotationConfirmContent({ isPending, onRemove }: Props) {
  const { t } = useTranslation(['appDebug', 'common'])
  const title = t(($) => $['feature.annotation.removeConfirm'], { ns: 'appDebug' })

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle title={title}>{title}</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton tone="destructive" loading={isPending} onClick={onRemove}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
