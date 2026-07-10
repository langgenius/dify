'use client'

import type { ReactElement } from 'react'
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
  onConfirm,
}: {
  children: ReactElement
  confirmDisabled?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)

  const handleConfirm = () => {
    onConfirm()
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={children} />
      <AlertDialogContent className="w-100">
        <div className="flex flex-col gap-1 p-6 pb-0">
          <AlertDialogTitle className="title-md-semi-bold text-text-primary">
            {t($ => $['agentDetail.configure.clearSessionConfirm.title'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t($ => $['agentDetail.configure.clearSessionConfirm.description'])}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-6">
          <AlertDialogCancelButton disabled={confirmDisabled}>
            {tCommon($ => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton disabled={confirmDisabled} onClick={handleConfirm}>
            {tCommon($ => $['operation.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
