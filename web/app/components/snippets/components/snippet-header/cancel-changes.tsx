'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type CancelChangesProps = {
  onCancel: () => void
}

const CancelChanges = ({
  onCancel,
}: CancelChangesProps) => {
  const { t } = useTranslation('snippet')

  return (
    <div className="flex items-center gap-2 system-sm-regular">
      <AlertDialog>
        <AlertDialogTrigger
          className="system-sm-semibold text-text-accent hover:text-text-accent-secondary"
        >
          {t('cancel')}
        </AlertDialogTrigger>
        <AlertDialogContent className="w-160">
          <div className="space-y-2 p-8 pb-12">
            <AlertDialogTitle className="title-md-semi-bold text-text-primary">
              {t('discardChangesTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-secondary">
              {t('discardChangesDescription')}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions className="px-8 pt-0">
            <AlertDialogCancelButton>
              {t('continueEditing')}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onCancel}>
              {t('discardChanges')}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <span className="text-text-quaternary">·</span>
      <span className="text-text-tertiary">{t('unsavedChanges')}</span>
    </div>
  )
}

export default memo(CancelChanges)
