'use client'

import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import type { ConnectionProvider, EndUserConnection } from '../model'
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
        <AlertDialogContent finalFocus={finalFocus} className="w-130">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['endUser.disconnectConnectionTitle'], { ns: 'app' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <div className="space-y-5">
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
              <AlertDialogDescription>
                {t(($) => $['endUser.disconnectConnectionDescription'], { ns: 'app' })}
              </AlertDialogDescription>
              {failed && (
                <p role="alert" className="system-sm-regular text-text-destructive">
                  {t(($) => $['api.actionFailed'], { ns: 'common' })}
                </p>
              )}
            </div>
          </AlertDialogBody>
          <AlertDialogFooter>
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
