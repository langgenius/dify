'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'

type Props = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
}
const i18nPrefix = 'common.effectVarConfirm'

const RemoveVarConfirm: FC<Props> = ({
  isShow,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  const title = t(`${i18nPrefix}.title`, { ns: 'workflow' })
  const content = t(`${i18nPrefix}.content`, { ns: 'workflow' })

  return (
    <AlertDialog open={isShow} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
            {content}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton>
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm}>
            {t('operation.confirm', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
export default React.memo(RemoveVarConfirm)
