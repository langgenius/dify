'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

type OpenScopeConfirmDialogProps = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function OpenScopeConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: OpenScopeConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onCancel()
      }}
    >
      <AlertDialogContent className="w-[480px] overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-lg">
        <div className="flex flex-col items-start gap-2 self-stretch p-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('accessRule.changeOpenScopeTitle', { ns: 'permission' })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="system-md-regular text-text-secondary">
            {t('accessRule.changeOpenScopeDescription', { ns: 'permission' })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="gap-2 p-6">
          <AlertDialogCancelButton variant="secondary">
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm}>
            {t('operation.change', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
