'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from '#i18n'

export function UndeployDeploymentDialog({
  disabled,
  isRequesting,
  open,
  row,
  onConfirm,
  onOpenChange,
}: {
  disabled: boolean
  isRequesting: boolean
  open: boolean
  row: EnvironmentDeployment
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')

  function handleOpenChange(nextOpen: boolean) {
    if (isRequesting)
      return

    onOpenChange(nextOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-120">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('deployTab.undeployConfirmTitle', { name: row.environment.displayName })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t('deployTab.undeployConfirmDesc')}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-3">
          <AlertDialogCancelButton variant="secondary" disabled={isRequesting}>
            {t('deployDrawer.cancel')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={isRequesting}
            disabled={disabled}
            onClick={onConfirm}
          >
            {t('deployTab.confirmUndeploy')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
