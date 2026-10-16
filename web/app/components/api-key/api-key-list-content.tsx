'use client'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { ComponentProps, ReactNode, RefObject } from 'react'
import type { ApiKeyDeleteTarget } from './api-key-table'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeyTable } from './api-key-table'
import { maskApiKey } from './mask-api-key'

type ApiKeyListContentProps = ComponentProps<typeof ApiKeyTable> & {
  children: ReactNode
  isDeleting: boolean
  isFetching: boolean
  isError: boolean
  onRetry: () => void
  onDelete: (keyId: string, onSuccess: () => void) => void
  finalFocus: RefObject<HTMLButtonElement | null>
}

export function ApiKeyListContent({
  apiKeys,
  canManage,
  showScope,
  allowCopy,
  children,
  isDeleting,
  isFetching,
  isError,
  onRetry,
  onDelete,
  finalFocus,
}: ApiKeyListContentProps) {
  const { t } = useTranslation(['appApi', 'common'])
  const deleteActionsRef = useRef<AlertDialogActions>(null)
  const deleteSucceededRef = useRef(false)

  const handleDelete = (keyId: string | undefined) => {
    if (!keyId || !canManage || isDeleting) return
    onDelete(keyId, () => {
      deleteSucceededRef.current = true
      deleteActionsRef.current?.close()
    })
  }

  return (
    <>
      <span role="status" className="sr-only">
        {isDeleting || isFetching ? t(($) => $.loading, { ns: 'common' }) : ''}
      </span>
      {isError && (
        <div className="flex items-center gap-2 px-6 py-4">
          <p role="status">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          <Button variant="secondary" size="small" onClick={onRetry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <AlertDialog<ApiKeyDeleteTarget>
        actionsRef={deleteActionsRef}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) deleteSucceededRef.current = false
          if (!nextOpen && isDeleting && details.reason !== 'imperative-action') {
            details.cancel()
          }
        }}
      >
        {({ payload }) => (
          <>
            <ApiKeyTable
              apiKeys={apiKeys}
              canManage={canManage}
              showScope={showScope}
              allowCopy={allowCopy}
            />
            <AlertDialogContent
              backdropProps={{ forceRender: true }}
              finalFocus={() => (deleteSucceededRef.current ? finalFocus.current : true)}
            >
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['actionMsg.deleteConfirmTitle'], { ns: 'appApi' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="system-md-regular wrap-break-word text-text-tertiary">
                  <span className="mb-2 block font-mono" translate="no">
                    {payload && maskApiKey(payload.token)}
                  </span>
                  {t(($) => $['actionMsg.deleteConfirmTips'], { ns: 'appApi' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancelButton disabled={isDeleting}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={isDeleting}
                  disabled={!canManage}
                  onClick={() => handleDelete(payload?.id)}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </>
        )}
      </AlertDialog>
      {children}
    </>
  )
}
