'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import type { ConnectionProvider, EndUserConnection } from '../model'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ProviderIcon from '../provider-icon'

type Props = {
  provider: ConnectionProvider
  connection: EndUserConnection | null
  open: boolean
  finalFocus: AlertDialogContentProps['finalFocus']
  onOpenChange: (open: boolean) => void
  onCloseComplete: () => void
  onRemove: (connection: EndUserConnection) => void | Promise<void>
}

export default function RemoveConnectionDialog({
  provider,
  connection,
  open,
  finalFocus,
  onOpenChange,
  onCloseComplete,
  onRemove,
}: Props) {
  const { t } = useTranslation(['app', 'common'])
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const pendingRef = useRef(false)
  const confirm = async () => {
    if (!connection || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      await onRemove(connection)
      onOpenChange(false)
    } catch {
      setFailed(true)
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
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setFailed(false)
          onCloseComplete()
        }
      }}
    >
      {connection && (
        <AlertDialogContent finalFocus={finalFocus} className="w-130 rounded-xl border p-6">
          <div className="space-y-5">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['endUser.disconnectConnectionTitle'], { ns: 'app' })}
            </AlertDialogTitle>
            <div className="flex items-center gap-3">
              {connection.type === 'oauth' ? (
                <ProviderIcon provider={provider} size="small" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-default-burn text-text-tertiary"
                >
                  <span className="i-ri-key-2-line size-5" />
                </span>
              )}
              <span className="min-w-0 system-md-semibold wrap-anywhere text-text-secondary">
                {connection.name}
              </span>
            </div>
            <AlertDialogDescription className="system-xs-regular text-text-tertiary">
              {t(($) => $['endUser.disconnectConnectionDescription'], { ns: 'app' })}
            </AlertDialogDescription>
            {failed && (
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['api.actionFailed'], { ns: 'common' })}
              </p>
            )}
          </div>
          <AlertDialogFooter className="mt-5 gap-3 p-0">
            <AlertDialogCancelButton disabled={pending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={pending} onClick={confirm}>
              {t(($) => $['endUser.disconnect'], { ns: 'app' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
