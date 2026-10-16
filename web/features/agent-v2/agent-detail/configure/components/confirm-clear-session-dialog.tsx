'use client'

import type { ReactElement, ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
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
        <AlertDialogHeader className="gap-1 pb-0">
          <AlertDialogTitle className="title-md-semi-bold">
            {title ?? t(($) => $['agentDetail.configure.clearSessionConfirm.title'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular">
            {t(($) => $['agentDetail.configure.clearSessionConfirm.description'])}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={confirmDisabled || isConfirming}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            disabled={confirmDisabled}
            loading={isConfirming}
            onClick={handleConfirm}
          >
            {tCommon(($) => $['operation.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
