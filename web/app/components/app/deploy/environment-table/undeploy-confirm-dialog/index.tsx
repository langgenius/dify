'use client'

import type { RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

type UndeployConfirmDialogProps = {
  finalFocus: RefObject<HTMLElement | null>
  environmentName: string
  isPending?: boolean
  open: boolean
  versionName: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function UndeployConfirmDialog({
  finalFocus,
  environmentName,
  isPending = false,
  open,
  versionName,
  onConfirm,
  onOpenChange,
}: UndeployConfirmDialogProps) {
  const { t } = useTranslation(['deployments'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['studio.undeployConfirmTitle'], {
              envName: environmentName,
              versionName,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['studio.undeployConfirmDesc'])}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
            {t(($) => $['deployTab.confirmUndeploy'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
