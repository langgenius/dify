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
import { cn } from '@langgenius/dify-ui/cn'
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
        <AlertDialogContent
          finalFocus={finalFocus}
          className={connection.type === 'oauth' ? 'w-130 rounded-xl border p-6' : undefined}
        >
          <div className={connection.type === 'oauth' ? 'space-y-5' : 'space-y-2 px-6 pt-6'}>
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {connection.type === 'oauth'
                ? t(($) => $['endUser.disconnectConnectionTitle'], { ns: 'app' })
                : t(($) => $['endUser.deleteKeyTitle'], { ns: 'app', name: connection.name })}
            </AlertDialogTitle>
            {connection.type === 'oauth' && (
              <div className="flex items-center gap-3">
                <ProviderIcon provider={provider} size="small" />
                <span className="min-w-0 system-md-semibold wrap-anywhere text-text-secondary">
                  {connection.name}
                </span>
              </div>
            )}
            <AlertDialogDescription
              className={cn(
                'text-text-tertiary',
                connection.type === 'oauth' ? 'system-xs-regular' : 'system-sm-regular',
              )}
            >
              {connection.type === 'oauth'
                ? t(($) => $['endUser.disconnectConnectionDescription'], { ns: 'app' })
                : t(($) => $['endUser.deleteKeyDescription'], { ns: 'app' })}
            </AlertDialogDescription>
            {failed && (
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['api.actionFailed'], { ns: 'common' })}
              </p>
            )}
          </div>
          <AlertDialogFooter className={connection.type === 'oauth' ? 'mt-5 gap-3 p-0' : undefined}>
            <AlertDialogCancelButton disabled={pending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={pending} onClick={confirm}>
              {connection.type === 'oauth'
                ? t(($) => $['endUser.disconnect'], { ns: 'app' })
                : t(($) => $['endUser.deleteKey'], { ns: 'app' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
