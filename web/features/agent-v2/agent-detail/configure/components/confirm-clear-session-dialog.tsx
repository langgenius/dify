'use client'

import type { ReactElement, ReactNode } from 'react'
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AgentConfigureClearSessionConfirmDialog({
  children,
  confirmDisabled = false,
  open: controlledOpen,
  title,
  onOpenChange,
  onConfirm,
}: {
  children?: ReactElement
  confirmDisabled?: boolean
  open?: boolean
  title?: ReactNode
  onOpenChange?: (open: boolean) => void
  onConfirm: () => boolean | void | Promise<boolean | void>
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (!isConfirming) setOpen(nextOpen)
  }

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      const shouldClose = await onConfirm()
      if (shouldClose !== false) setOpen(false)
    } catch {
      // Keep the dialog open so the user can retry the failed action.
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {children && <AlertDialogTrigger render={children} />}
      <AlertDialogContent backdropProps={{ forceRender: true }} className="w-100">
        <div className="flex flex-col gap-1 p-6 pb-0">
          <AlertDialogTitle className="title-md-semi-bold text-text-primary">
            {title ?? t(($) => $['agentDetail.configure.clearSessionConfirm.title'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t(($) => $['agentDetail.configure.clearSessionConfirm.description'])}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-6">
          <AlertDialogCancelButton disabled={confirmDisabled || isConfirming}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            disabled={confirmDisabled || isConfirming}
            loading={isConfirming}
            onClick={handleConfirm}
          >
            {tCommon(($) => $['operation.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
