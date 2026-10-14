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
  onConfirm: () => void
}>

export function ClearAllAnnotationsConfirmContent({ isPending, onConfirm }: Props) {
  const { t } = useTranslation(['appAnnotation', 'common'])
  const title = t(($) => $['table.header.clearAllConfirm'], { ns: 'appAnnotation' })

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
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
