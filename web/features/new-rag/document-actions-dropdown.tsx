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

export type DocumentAction = 'remove' | 'rename' | 'toggle-source'

export function DocumentActionsDropdown({
  canEdit,
  className,
  documentTitle,
  onRemove,
  onRename,
  onReindex,
  onToggleSource,
  pendingAction,
  removeDisabled,
  reindexDisabled,
  sourceDisabled,
  toggleSourceDisabled,
  unavailableReasonId,
}: {
  canEdit: boolean
  className?: string
  documentTitle: string
  onRemove: () => Promise<boolean>
  onRename: (title: string) => Promise<boolean>
  onReindex: () => void
  onToggleSource: () => Promise<boolean>
  pendingAction?: DocumentAction
  removeDisabled: boolean
  reindexDisabled: boolean
  sourceDisabled: boolean
  toggleSourceDisabled: boolean
  unavailableReasonId: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [nextTitle, setNextTitle] = useState(documentTitle)
  const busy = Boolean(pendingAction)
  const renameDisabled = !canEdit || busy

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
            aria-describedby={reindexDisabled ? unavailableReasonId : undefined}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled={!canEdit || busy || reindexDisabled}
            onClick={onReindex}
          >
            <span aria-hidden className="i-ri-loop-left-line size-4" />
            {t(($) => $['newKnowledge.reindexDocument'])}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-describedby={toggleSourceDisabled ? unavailableReasonId : undefined}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled={!canEdit || busy || toggleSourceDisabled}
            onClick={() => void onToggleSource()}
          >
            <span
              aria-hidden
              className={cn(
                'size-4',
                sourceDisabled ? 'i-ri-checkbox-circle-line' : 'i-ri-indeterminate-circle-line',
              )}
            />
            {sourceDisabled ? t(($) => $.enable) : t(($) => $['newKnowledge.disableSource'])}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-describedby={unavailableReasonId}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled
          >
            <span aria-hidden className="i-ri-archive-2-line size-4" />
            {t(($) => $['batchAction.archive'])}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-px" />
          <DropdownMenuItem
            aria-describedby={unavailableReasonId}
            className="mb-px h-7 gap-2 px-2 system-sm-medium"
            disabled
          >
            <span aria-hidden className="i-ri-download-line size-4" />
            {t(($) => $['newKnowledge.downloadDocuments'])}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-describedby={removeDisabled ? unavailableReasonId : undefined}
            className="h-7 gap-2 px-2 system-sm-medium"
            disabled={!canEdit || busy || removeDisabled}
            variant="destructive"
            onClick={() => setRemoveDialogOpen(true)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            {t(($) => $['newKnowledge.removeSource'])}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span id={unavailableReasonId} className="sr-only">
        {t(($) => $['newKnowledge.documentActionsUnavailable'])}
      </span>

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
              {t(($) => $['newKnowledge.removeSource'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
