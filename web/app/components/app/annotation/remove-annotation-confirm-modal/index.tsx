'use client'
import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
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
      <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
        <AlertDialogTitle
          className="w-full truncate title-2xl-semi-bold text-text-primary"
          title={title}
        >
          {title}
        </AlertDialogTitle>
      </div>
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
