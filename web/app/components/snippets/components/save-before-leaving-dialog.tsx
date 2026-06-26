'use client'

import type { ReactElement } from 'react'
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
import { useTranslation } from 'react-i18next'

type SaveBeforeLeavingDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactElement
  disabled?: boolean
  saveDisabled?: boolean
  loading?: boolean
  onDiscard: () => void | Promise<void>
  onSave: () => void | Promise<void>
}

const SaveBeforeLeavingDialog = ({
  open,
  onOpenChange,
  trigger,
  disabled,
  saveDisabled,
  loading,
  onDiscard,
  onSave,
}: SaveBeforeLeavingDialogProps) => {
  const { t } = useTranslation('snippet')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <AlertDialogTrigger render={trigger} />
      )}
      <AlertDialogContent className="w-165">
        <div className="space-y-2 p-8 pb-12">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('saveBeforeLeavingTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular text-text-secondary">
            {t('saveBeforeLeavingDescription')}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="px-8 pt-0">
          <AlertDialogCancelButton disabled={disabled || loading}>
            {t('continueEditing')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="destructive"
            disabled={disabled || loading}
            onClick={onDiscard}
          >
            {t('doNotSave')}
          </AlertDialogConfirmButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={loading}
            disabled={disabled || saveDisabled || loading}
            onClick={onSave}
          >
            {t('saveAndExit')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default SaveBeforeLeavingDialog
