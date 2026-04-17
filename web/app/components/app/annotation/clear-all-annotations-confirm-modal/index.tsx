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
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'

type Props = {
  isShow: boolean
  onHide: () => void
  onConfirm: () => void
}

const ClearAllAnnotationsConfirmModal: FC<Props> = ({
  isShow,
  onHide,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const title = t('table.header.clearAllConfirm', { ns: 'appAnnotation' })

  return (
    <AlertDialog open={isShow} onOpenChange={open => !open && onHide()}>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
            {title}
          </AlertDialogTitle>
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

export default React.memo(ClearAllAnnotationsConfirmModal)
