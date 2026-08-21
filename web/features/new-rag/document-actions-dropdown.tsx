'use client'

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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type DocumentAction = 'download' | 'remove' | 'rename' | 'retry' | 'toggle-availability'

export function DocumentActionsDropdown({
  canEdit,
  canDownload,
  className,
  documentEnabled,
  documentTitle,
  onRemove,
  onDownload,
  onRename,
  onReindex,
  onRetry,
  onToggleAvailability,
  pendingAction,
  downloadDisabled,
  removeDisabled,
  reindexDisabled,
  retryDisabled,
  showAvailabilityAction,
  showRetry,
  toggleAvailabilityDisabled,
  unavailableReasonId,
}: {
  canDownload: boolean
  canEdit: boolean
  className?: string
  documentEnabled: boolean
  documentTitle: string
  downloadDisabled: boolean
  onDownload: () => Promise<boolean>
  onRemove: () => Promise<boolean>
  onRename: (title: string) => Promise<boolean>
  onReindex: () => void
  onRetry: () => Promise<boolean>
  onToggleAvailability: () => Promise<boolean>
  pendingAction?: DocumentAction
  removeDisabled: boolean
  reindexDisabled: boolean
  retryDisabled: boolean
  showAvailabilityAction: boolean
  showRetry: boolean
  toggleAvailabilityDisabled: boolean
  unavailableReasonId: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [nextTitle, setNextTitle] = useState(documentTitle)
  const busy = Boolean(pendingAction)
  const renameDisabled = !canEdit || busy
  const reprocessUnavailable = !canEdit || (showRetry ? retryDisabled : reindexDisabled)
  const downloadUnavailable = !canDownload || downloadDisabled
  const availabilityUnavailable = !canEdit || toggleAvailabilityDisabled
  const removeUnavailable = !canEdit || removeDisabled
  const hasUnavailableAction =
    reprocessUnavailable ||
    downloadUnavailable ||
    (showAvailabilityAction && availabilityUnavailable) ||
    removeUnavailable

  const openRenameDialog = () => {
    setNextTitle(documentTitle)
    setRenameDialogOpen(true)
  }

  const submitRename = async () => {
    const title = nextTitle.trim()
    if (!title || title === documentTitle || pendingAction) return
    if (await onRename(title)) setRenameDialogOpen(false)
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['newKnowledge.documentActions'], { name: documentTitle })}
          disabled={busy}
          className={cn(
            'ml-auto flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled',
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-4',
              busy
                ? 'i-ri-loader-4-line animate-spin motion-reduce:animate-none'
                : 'i-ri-more-fill',
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[200px]">
          <DropdownMenuItem
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled={renameDisabled}
            onClick={openRenameDialog}
          >
            <span aria-hidden className="i-ri-edit-line size-4" />
            {tCommon(($) => $['operation.rename'])}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-describedby={reprocessUnavailable ? unavailableReasonId : undefined}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled={!canEdit || busy || (showRetry ? retryDisabled : reindexDisabled)}
            onClick={() => {
              if (showRetry) void onRetry()
              else onReindex()
            }}
          >
            <span
              aria-hidden
              className={showRetry ? 'i-ri-restart-line size-4' : 'i-ri-loop-left-line size-4'}
            />
            {t(($) =>
              showRetry ? $['newKnowledge.retryTask'] : $['newKnowledge.reindexDocument'],
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-describedby={downloadUnavailable ? unavailableReasonId : undefined}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled={!canDownload || busy || downloadDisabled}
            onClick={() => void onDownload()}
          >
            <span aria-hidden className="i-ri-download-line size-4" />
            {t(($) => $['newKnowledge.downloadDocuments'])}
          </DropdownMenuItem>
          {showAvailabilityAction && (
            <DropdownMenuItem
              aria-describedby={availabilityUnavailable ? unavailableReasonId : undefined}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
              disabled={!canEdit || busy || toggleAvailabilityDisabled}
              onClick={() => void onToggleAvailability()}
            >
              <span
                aria-hidden
                className={cn(
                  'size-4',
                  documentEnabled ? 'i-ri-indeterminate-circle-line' : 'i-ri-checkbox-circle-line',
                )}
              />
              {documentEnabled ? t(($) => $['newKnowledge.disableSource']) : t(($) => $.enable)}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="my-px" />
          <DropdownMenuItem
            aria-describedby={removeUnavailable ? unavailableReasonId : undefined}
            className="h-7 gap-2 px-2 system-sm-medium"
            disabled={!canEdit || busy || removeDisabled}
            variant="destructive"
            onClick={() => setRemoveDialogOpen(true)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            {tCommon(($) => $['operation.delete'])}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {hasUnavailableAction && (
        <span id={unavailableReasonId} className="sr-only">
          {t(($) => $['newKnowledge.documentActionsUnavailable'])}
        </span>
      )}

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
          >
            <DialogTitle className="title-xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.rename'])}
            </DialogTitle>
            <DialogDescription className="mt-2 system-sm-regular text-text-tertiary">
              {documentTitle}
            </DialogDescription>
            <label
              className="mt-5 block system-sm-medium text-text-secondary"
              htmlFor={`${unavailableReasonId}-rename`}
            >
              {t(($) => $['newKnowledge.documentColumn'])}
            </label>
            <Input
              id={`${unavailableReasonId}-rename`}
              autoComplete="off"
              className="mt-2 w-full"
              disabled={pendingAction === 'rename'}
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
            />
            <div className="mt-6 flex justify-end gap-2">
              <Button
                disabled={pendingAction === 'rename'}
                onClick={() => setRenameDialogOpen(false)}
                type="button"
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                disabled={
                  pendingAction === 'rename' ||
                  !nextTitle.trim() ||
                  nextTitle.trim() === documentTitle
                }
                loading={pendingAction === 'rename'}
                type="submit"
                variant="primary"
              >
                {tCommon(($) => $['operation.save'])}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={pendingAction === 'remove'}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={pendingAction === 'remove'}
              loading={pendingAction === 'remove'}
              tone="destructive"
              onClick={() =>
                void onRemove().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
                })
              }
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
