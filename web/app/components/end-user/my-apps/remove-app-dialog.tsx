'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import type { RemoveAppRequest } from './model'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  request: RemoveAppRequest | null
  open: boolean
  finalFocus: AlertDialogContentProps['finalFocus']
  onCancel: () => void
  onConfirm: (request: RemoveAppRequest) => void | Promise<void>
}

export default function RemoveAppDialog({ request, open, finalFocus, onCancel, onConfirm }: Props) {
  const { t } = useTranslation(['app', 'common'])
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const confirm = async () => {
    if (!request || pending) return
    setPending(true)
    setFailed(false)
    try {
      await onConfirm(request)
      onCancel()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) {
          setFailed(false)
          onCancel()
        }
      }}
    >
      {request && (
        <AlertDialogContent finalFocus={finalFocus}>
          <div className="space-y-2 px-6 pt-6">
            <AlertDialogTitle className="title-3xl-semi-bold text-text-primary">
              {t(($) => $['endUser.removeTitle'], { ns: 'app', name: request.app.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {request.deleteChats
                ? t(($) => $['endUser.deleteChatsDescription'], { ns: 'app' })
                : t(($) => $['endUser.removeDescription'], { ns: 'app' })}
            </AlertDialogDescription>
            {failed && (
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['endUser.removeError'], { ns: 'app' })}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={pending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={pending} onClick={confirm}>
              {request.deleteChats
                ? t(($) => $['endUser.removeAndDeleteChats'], { ns: 'app' })
                : t(($) => $['endUser.removeFromList'], { ns: 'app' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
