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
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CancelChangesProps = {
  canDiscardChanges: boolean
  onCancel: () => void | Promise<void>
}

const CancelChanges = ({
  canDiscardChanges,
  onCancel,
}: CancelChangesProps) => {
  const { t } = useTranslation('snippet')
  const [open, setOpen] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const handleDiscardChanges = useCallback(async () => {
    setIsDiscarding(true)
    try {
      await onCancel()
      setOpen(false)
    }
    finally {
      setIsDiscarding(false)
    }
  }, [onCancel])

  return (
    <div className="flex items-center gap-2 system-sm-regular">
      {canDiscardChanges && (
        <>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger
              className="system-sm-semibold text-text-accent hover:text-text-accent-secondary"
            >
              {t('discardDraft')}
            </AlertDialogTrigger>
            <AlertDialogContent className="w-160">
              <div className="space-y-2 p-8 pb-12">
                <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t('discardChangesTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription className="system-md-regular text-text-secondary">
                  {t('discardChangesDescription')}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions className="px-8 pt-0">
                <AlertDialogCancelButton disabled={isDiscarding}>
                  {t('continueEditing')}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={isDiscarding}
                  disabled={isDiscarding}
                  onClick={handleDiscardChanges}
                >
                  {t('discardChanges')}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
          <span className="text-text-quaternary">·</span>
        </>
      )}
      <span className="text-text-tertiary">{t('editingDraft')}</span>
    </div>
  )
}

export default memo(CancelChanges)
