'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import {
  createReleaseAppInstanceIdAtom,
  createReleaseDialogOpenAtom,
  createReleaseLocalAtoms,
  isCreatingReleaseAtom,
  openCreateReleaseDialogAtom,
  requestCloseCreateReleaseDialogAtom,
} from './state'
import { CreateReleaseDialogContent } from './ui/dialog'

function CreateReleaseScopedControl({
  variant,
  size,
  label,
  className,
}: {
  variant: ButtonProps['variant']
  size: ButtonProps['size']
  label?: string
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const open = useAtomValue(createReleaseDialogOpenAtom)
  const isCreatingRelease = useAtomValue(isCreatingReleaseAtom)
  const openDialog = useSetAtom(openCreateReleaseDialogAtom)
  const requestCloseDialog = useSetAtom(requestCloseCreateReleaseDialogAtom)

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openDialog()
      return
    }

    if (!isCreatingRelease)
      requestCloseDialog()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogTrigger
        render={(
          <Button
            size={size}
            variant={variant}
            className={className}
          />
        )}
      >
        {label ?? t($ => $['versions.createRelease'])}
      </DialogTrigger>
      <CreateReleaseDialogContent />
    </Dialog>
  )
}

export function CreateReleaseControl({
  appInstanceId,
  variant = 'primary',
  size = 'small',
  label,
  className,
}: {
  appInstanceId: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
}) {
  return (
    <ScopeProvider
      key={appInstanceId}
      atoms={[
        [createReleaseAppInstanceIdAtom, appInstanceId],
        ...createReleaseLocalAtoms,
      ]}
      name="CreateRelease"
    >
      <CreateReleaseScopedControl
        variant={variant}
        size={size}
        label={label}
        className={className}
      />
    </ScopeProvider>
  )
}
