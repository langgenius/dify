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
  onConfirm: () => void
}>

export function ClearAllAnnotationsConfirmContent({ isPending, onConfirm }: Props) {
  const { t } = useTranslation(['appAnnotation', 'common'])
  const title = t(($) => $['table.header.clearAllConfirm'], { ns: 'appAnnotation' })

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle title={title}>{title}</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
