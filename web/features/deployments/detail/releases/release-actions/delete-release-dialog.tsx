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
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from '#i18n'
import {
  deleteReleaseDialogOpenAtom,
  releaseActionItemAtom,
} from './state'

export function DeleteReleaseDialog({
  isDeleting,
  onConfirm,
}: {
  isDeleting: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation('deployments')
  const { releaseId, releaseRows } = useAtomValue(releaseActionItemAtom)
  const [open, setOpen] = useAtom(deleteReleaseDialogOpenAtom)
  const release = releaseRows.find(release => release.id === releaseId)
  if (!release)
    return null

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDeleting)
          return
        setOpen(nextOpen)
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
