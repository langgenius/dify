'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import type { UndeployDialogPayload } from '../types'
import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

type UndeployConfirmDialogContentProps = {
  finalFocus: AlertDialogContentProps['finalFocus']
  menuActionsRef: UndeployDialogPayload['menuActionsRef']
  environmentName: string
  isPending?: boolean
  versionName: string
  onConfirm: () => void
}

function UndeployConfirmDialogSession({
  menuActionsRef,
  environmentName,
  isPending = false,
  versionName,
  onConfirm,
}: Omit<UndeployConfirmDialogContentProps, 'finalFocus'>) {
  const { t } = useTranslation(['deployments'])
  const { t: tCommon } = useTranslation(['common'])
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    cancelRef.current?.focus()
    menuActionsRef.current?.close()
  }, [menuActionsRef])

  return (
    <>
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
        <AlertDialogCancelButton ref={cancelRef} disabled={isPending}>
          {tCommon(($) => $['operation.cancel'])}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['deployTab.confirmUndeploy'])}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}

export function UndeployConfirmDialogContent({
  finalFocus,
  ...sessionProps
}: UndeployConfirmDialogContentProps) {
  return (
    <AlertDialogContent finalFocus={finalFocus}>
      <UndeployConfirmDialogSession {...sessionProps} />
    </AlertDialogContent>
  )
}
