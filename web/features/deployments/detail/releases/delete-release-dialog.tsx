'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
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

export function DeleteReleaseDialog({
  open,
  release,
  isDeleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  release: Release
  isDeleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDeleting)
          return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent className="w-120">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('versions.deleteConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t('versions.deleteConfirmDesc', { name: release.displayName })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-3">
          <AlertDialogCancelButton variant="secondary" disabled={isDeleting}>
            {t('versions.cancelDelete')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={isDeleting}
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {t('versions.deleteRelease')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
