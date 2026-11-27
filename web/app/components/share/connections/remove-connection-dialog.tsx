'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import type { ConnectionMethod } from './required-services'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isAbortError } from '@/service/client-error'

type Props = {
  name: string
  method?: ConnectionMethod
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
  finalFocus: AlertDialogContentProps['finalFocus']
  disabled?: boolean
}

export default function RemoveConnectionDialog({
  name,
  method,
  open,
  onOpenChange,
  onConfirm,
  finalFocus,
  disabled = false,
}: Props) {
  const { t } = useTranslation(['app', 'common'])
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const confirm = async () => {
    if (disabled || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      if (!isAbortError(error)) toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pendingRef.current) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent
        className="w-130"
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['endUser.disconnectConnectionTitle'], { ns: 'app' })}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody className="space-y-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-default-burn text-text-tertiary"
            >
              <span
                className={
                  method === 'api-key' ? 'i-ri-key-2-line size-5' : 'i-ri-plug-line size-5'
                }
              />
            </span>
            <span className="min-w-0 system-md-semibold wrap-anywhere text-text-secondary">
              {name}
            </span>
          </div>
          <AlertDialogDescription>
            {t(($) => $['endUser.disconnectConnectionDescription'], { ns: 'app' })}
          </AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={pending}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={pending}
            disabled={disabled}
            onClick={() => void confirm()}
          >
            {t(($) => $['endUser.disconnect'], { ns: 'app' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
