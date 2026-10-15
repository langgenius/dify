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
import { cn } from '@langgenius/dify-ui/cn'
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
        <AlertDialogContent
          finalFocus={finalFocus}
          className={request.deleteChats ? 'w-130 rounded-xl p-6' : undefined}
        >
          <div className={request.deleteChats ? 'space-y-4' : 'space-y-2 px-6 pt-6'}>
            <AlertDialogTitle
              className={cn(
                'text-text-primary',
                request.deleteChats ? 'title-2xl-semi-bold' : 'title-3xl-semi-bold',
              )}
            >
              {request.deleteChats
                ? t(($) => $['endUser.deleteChatsTitle'], { ns: 'app' })
                : t(($) => $['endUser.removeTitle'], { ns: 'app', name: request.app.name })}
            </AlertDialogTitle>
            <AlertDialogDescription
              render={<div />}
              className={cn(
                'text-text-tertiary',
                request.deleteChats ? 'space-y-4 system-xs-regular' : 'system-md-regular',
              )}
            >
              {request.deleteChats ? (
                <>
                  <p>
                    {t(($) => $['endUser.deleteChatsDescription'], {
                      ns: 'app',
                      name: request.app.name,
                    })}
                  </p>
                  <p>{t(($) => $['endUser.deleteChatsDisclaimer'], { ns: 'app' })}</p>
                </>
              ) : (
                t(($) => $['endUser.removeDescription'], { ns: 'app' })
              )}
            </AlertDialogDescription>
            {failed && (
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['endUser.removeError'], { ns: 'app' })}
              </p>
            )}
          </div>
          <AlertDialogFooter className={request.deleteChats ? 'mt-4 gap-3 p-0' : undefined}>
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
