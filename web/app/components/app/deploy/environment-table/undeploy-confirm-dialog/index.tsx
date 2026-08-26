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

type UndeployConfirmDialogProps = {
  environmentName: string
  isPending?: boolean
  open: boolean
  versionName: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function UndeployConfirmDialog({
  environmentName,
  isPending = false,
  open,
  versionName,
  onConfirm,
  onOpenChange,
}: UndeployConfirmDialogProps) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent className="w-120">
        <div className="flex flex-col items-start gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['studio.undeployConfirmTitle'], {
              envName: environmentName,
              versionName,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p className="system-md-regular text-text-secondary">
              {t(($) => $['studio.undeployConfirmDesc'])}
            </p>
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary" className="min-w-20" disabled={isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            className="min-w-20"
            disabled={isPending}
            loading={isPending}
            onClick={onConfirm}
          >
            {t(($) => $['deployTab.confirmUndeploy'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
