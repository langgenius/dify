'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

type UndeployConfirmDialogContentProps = {
  finalFocus: AlertDialogContentProps['finalFocus']
  environmentName: string
  isPending?: boolean
  versionName: string
  onConfirm: () => void
}

export function UndeployConfirmDialogContent({
  finalFocus,
  environmentName,
  isPending = false,
  versionName,
  onConfirm,
}: UndeployConfirmDialogContentProps) {
  const { t } = useTranslation(['deployments'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <AlertDialogContent finalFocus={finalFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['studio.undeployConfirmTitle'], {
            envName: environmentName,
            versionName,
          })}
        </AlertDialogTitle>
        <AlertDialogDescription>{t(($) => $['studio.undeployConfirmDesc'])}</AlertDialogDescription>
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
  )
}
