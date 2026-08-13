'use client'

import type { ApiKeyItem } from '@dify/contracts/api/console/apps/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import useTimestamp from '@/hooks/use-timestamp'
import SecretKeyGenerateModal from '../secret-key-generate'
import s from '../style.module.css'

type SecretKeyItem = ApiKeyItem | EnvironmentApiKey
type CreatedSecretKey = Pick<ApiKeyItem, 'token'>

export type SecretKeyModalViewProps = {
  apiKeys?: SecretKeyItem[]
  canManage: boolean
  createDisabled: boolean
  isCreating: boolean
  isDeleting: boolean
  isLoading: boolean
  isShow: boolean
  onClose: () => void
  onCreate: (onSuccess: (createdKey: CreatedSecretKey) => void) => void
  onDelete: (keyId: string, onSuccess: () => void) => void
}

export function SecretKeyModalView({
  apiKeys,
  canManage,
  createDisabled,
  isCreating,
  isDeleting,
  isLoading,
  isShow,
  onClose,
  onCreate,
  onDelete,
}: SecretKeyModalViewProps) {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [deleteKeyId, setDeleteKeyId] = useState<string>()
  const [newKey, setNewKey] = useState<CreatedSecretKey>()

  const handleClose = () => {
    setDeleteKeyId(undefined)
    setNewKey(undefined)
    onClose()
  }

  const handleCreate = () => {
    if (createDisabled || isCreating) return
    onCreate(setNewKey)
  }

  const handleDelete = () => {
    if (!deleteKeyId || isDeleting) return
    onDelete(deleteKeyId, () => setDeleteKeyId(undefined))
  }

  const generateToken = (token: string) => {
    return `${token.slice(0, 3)}...${token.slice(-20)}`
  }

  return (
    <>
      <Dialog
        open={isShow}
        onOpenChange={(open) => {
          if (!open) handleClose()
        }}
      >
        <DialogContent
          className={cn(
            'max-h-[calc(100vh-80px)]! w-full max-w-200! overflow-hidden! border-none text-left align-middle',
            `${s.customModal} flex flex-col px-8`,
          )}
        >
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}
          </DialogTitle>

          <div className="-mt-6 -mr-2 mb-4 flex justify-end">
            <button
              type="button"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="flex size-6 cursor-pointer items-center justify-center text-text-tertiary"
              onClick={handleClose}
            >
              <span
                className="i-heroicons-x-mark-20-solid size-6 cursor-pointer"
                aria-hidden="true"
              />
            </button>
          </div>
          <p className="mt-1 shrink-0 text-[13px] leading-5 font-normal text-text-tertiary">
            {t(($) => $['apiKeyModal.apiSecretKeyTips'], { ns: 'appApi' })}
          </p>
          {isLoading && (
            <div className="mt-4">
              <Loading />
            </div>
          )}
          {!!apiKeys?.length && (
            <div className="mt-4 flex grow flex-col overflow-hidden">
              <div className="flex h-9 shrink-0 items-center border-b border-divider-regular text-xs font-semibold text-text-tertiary">
                <div className="w-64 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
                </div>
                <div className="w-50 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.created'], { ns: 'appApi' })}
                </div>
                <div className="w-50 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.lastUsed'], { ns: 'appApi' })}
                </div>
                <div className="grow px-3" />
              </div>
              <div className="grow overflow-auto">
                {apiKeys.map((api) => (
                  <div
                    className="flex h-9 items-center border-b border-divider-regular text-sm font-normal text-text-secondary"
                    key={api.id}
                  >
                    <div className="w-64 shrink-0 truncate px-3 font-mono">
                      {generateToken(api.token)}
                    </div>
                    <div className="w-50 shrink-0 truncate px-3">
                      {formatTime(
                        Number(api.created_at),
                        t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                      )}
                    </div>
                    <div className="w-50 shrink-0 truncate px-3">
                      {api.last_used_at
                        ? formatTime(
                            Number(api.last_used_at),
                            t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                          )
                        : t(($) => $.never, { ns: 'appApi' })}
                    </div>
                    <div className="flex grow space-x-2 px-3">
                      <CopyFeedback content={api.token} />
                      {canManage && (
                        <IconButton
                          aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${generateToken(api.token)}`}
                          onClick={() => setDeleteKeyId(api.id)}
                        >
                          <span aria-hidden className="i-ri-delete-bin-line size-4" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex">
            <Button
              className={`mt-4 flex shrink-0 ${s.autoWidth}`}
              onClick={handleCreate}
              disabled={createDisabled || isCreating}
              loading={isCreating}
            >
              <span className="i-heroicons-plus-20-solid flex size-4 shrink-0" />
              <div className="text-xs font-medium text-text-secondary">
                {t(($) => $['apiKeyModal.createNewSecretKey'], { ns: 'appApi' })}
              </div>
            </Button>
          </div>
          <AlertDialog
            open={deleteKeyId !== undefined}
            onOpenChange={(open) => {
              if (!open && !isDeleting) setDeleteKeyId(undefined)
            }}
          >
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t(($) => $['actionMsg.deleteConfirmTitle'], { ns: 'appApi' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $['actionMsg.deleteConfirmTips'], { ns: 'appApi' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton disabled={isDeleting}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton loading={isDeleting} onClick={handleDelete}>
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
      <SecretKeyGenerateModal
        className="shrink-0"
        isShow={isShow && newKey !== undefined}
        onClose={() => setNewKey(undefined)}
        newKey={newKey}
      />
    </>
  )
}
