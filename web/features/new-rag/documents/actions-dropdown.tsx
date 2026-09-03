'use client'

import type { LogicalDocument } from './models'
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
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentShowsAvailabilityAction,
  taskCanRetry,
} from './model'
import {
  useDocumentRowActionBusy,
  useDownloadDocumentAction,
  useReindexDocumentAction,
  useRemoveDocumentAction,
  useRenameDocumentAction,
  useRetryDocumentTaskAction,
  useToggleDocumentAvailabilityAction,
} from './row-actions/use-document-row-actions'
import { createDocumentRowActionFactsAtom, selectionResultsUnavailableAtom } from './state/results'
import { documentCanDownloadAtom, documentCanWriteAtom } from './state/runtime'

function useDocumentActionFacts(documentId: string) {
  const factsAtom = useMemo(() => createDocumentRowActionFactsAtom(documentId), [documentId])
  return useAtomValue(factsAtom)
}

function useDocumentCanEdit() {
  const permissionAllowsWrite = useAtomValue(documentCanWriteAtom)
  const selectionResultsUnavailable = useAtomValue(selectionResultsUnavailableAtom)
  return permissionAllowsWrite && !selectionResultsUnavailable
}

function RenameDocumentMenuItem({
  document,
  onOpen,
}: {
  document: LogicalDocument
  onOpen: () => void
}) {
  const { t: tCommon } = useTranslation('common')
  const canEdit = useDocumentCanEdit()
  const busy = useDocumentRowActionBusy(document.id)

  return (
    <DropdownMenuItem
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={!canEdit || busy}
      onClick={onOpen}
    >
      <span aria-hidden className="i-ri-edit-line size-4" />
      {tCommon(($) => $['operation.rename'])}
    </DropdownMenuItem>
  )
}

function RenameDocumentDialog({
  document,
  onOpenChange,
  open,
}: {
  document: LogicalDocument
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [nextTitle, setNextTitle] = useState(document.title)
  const { busy, pending, run } = useRenameDocumentAction(document)
  const inputId = `new-document-${document.id}-rename`
  const submit = async () => {
    const title = nextTitle.trim()
    if (!title || title === document.title || busy) return
    if (await run(title)) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {tCommon(($) => $['operation.rename'])}
          </DialogTitle>
          <DialogDescription className="mt-2 system-sm-regular text-text-tertiary">
            {document.title}
          </DialogDescription>
          <label className="mt-5 block system-sm-medium text-text-secondary" htmlFor={inputId}>
            {t(($) => $['newKnowledge.documentColumn'])}
          </label>
          <Input
            id={inputId}
            autoComplete="off"
            className="mt-2 w-full"
            disabled={pending}
            value={nextTitle}
            onChange={(event) => setNextTitle(event.target.value)}
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button disabled={pending} onClick={() => onOpenChange(false)} type="button">
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              disabled={pending || !nextTitle.trim() || nextTitle.trim() === document.title}
              loading={pending}
              type="submit"
              variant="primary"
            >
              {tCommon(($) => $['operation.save'])}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RetryDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation('dataset')
  const canEdit = useDocumentCanEdit()
  const { task } = useDocumentActionFacts(document.id)
  const { busy, run } = useRetryDocumentTaskAction(document.id, task)
  const disabled = !canEdit || !task || !taskCanRetry(task)
  const unavailableReasonId = `new-document-${document.id}-actions-unavailable`

  return (
    <DropdownMenuItem
      aria-describedby={disabled ? unavailableReasonId : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span aria-hidden className="i-ri-restart-line size-4" />
      {t(($) => $['newKnowledge.retryTask'])}
    </DropdownMenuItem>
  )
}

function ReindexDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation('dataset')
  const canEdit = useDocumentCanEdit()
  const { status } = useDocumentActionFacts(document.id)
  const { busy, run } = useReindexDocumentAction(document, status)
  const disabled = !canEdit || !documentCanReindex(status)

  return (
    <DropdownMenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span aria-hidden className="i-ri-loop-left-line size-4" />
      {t(($) => $['newKnowledge.reindexDocument'])}
    </DropdownMenuItem>
  )
}

function ReprocessDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { status } = useDocumentActionFacts(document.id)
  return status === 'failed' ? (
    <RetryDocumentMenuItem document={document} />
  ) : (
    <ReindexDocumentMenuItem document={document} />
  )
}

function DownloadDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation('dataset')
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const { status, tasksPending } = useDocumentActionFacts(document.id)
  const { busy, run } = useDownloadDocumentAction(document, status, tasksPending)
  const disabled = !canDownload || tasksPending || !documentCanDownload(document, status)

  return (
    <DropdownMenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span aria-hidden className="i-ri-download-line size-4" />
      {t(($) => $['newKnowledge.downloadDocuments'])}
    </DropdownMenuItem>
  )
}

function ToggleDocumentAvailabilityMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation('dataset')
  const canEdit = useDocumentCanEdit()
  const { status } = useDocumentActionFacts(document.id)
  const { busy, run } = useToggleDocumentAvailabilityAction(document, status)
  if (!documentShowsAvailabilityAction(status)) return null
  const disabled =
    !canEdit || document.status === 'deleting' || !documentCanToggleAvailability(status)

  return (
    <DropdownMenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span
        aria-hidden
        className={cn(
          'size-4',
          document.enabled ? 'i-ri-indeterminate-circle-line' : 'i-ri-checkbox-circle-line',
        )}
      />
      {document.enabled ? t(($) => $['newKnowledge.disableSource']) : t(($) => $.enable)}
    </DropdownMenuItem>
  )
}

function RemoveDocumentMenuItem({
  document,
  onOpen,
}: {
  document: LogicalDocument
  onOpen: () => void
}) {
  const { t: tCommon } = useTranslation('common')
  const canEdit = useDocumentCanEdit()
  const busy = useDocumentRowActionBusy(document.id)
  const disabled = !canEdit || document.status === 'deleting'

  return (
    <DropdownMenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      variant="destructive"
      onClick={onOpen}
    >
      <span aria-hidden className="i-ri-delete-bin-line size-4" />
      {tCommon(($) => $['operation.delete'])}
    </DropdownMenuItem>
  )
}

function RemoveDocumentDialog({
  document,
  onOpenChange,
  open,
}: {
  document: LogicalDocument
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t: tCommon } = useTranslation('common')
  const { pending, run } = useRemoveDocumentAction(document)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
          <AlertDialogCancelButton disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            disabled={pending}
            loading={pending}
            tone="destructive"
            onClick={() =>
              void run().then((removed) => {
                if (removed) onOpenChange(false)
              })
            }
          >
            {tCommon(($) => $['operation.delete'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DocumentActionsDropdown({
  className,
  document,
}: {
  className?: string
  document: LogicalDocument
}) {
  const { t } = useTranslation('dataset')
  const busy = useDocumentRowActionBusy(document.id)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const unavailableReasonId = `new-document-${document.id}-actions-unavailable`

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['newKnowledge.documentActions'], { name: document.title })}
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
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-50">
          <RenameDocumentMenuItem document={document} onOpen={() => setRenameDialogOpen(true)} />
          <ReprocessDocumentMenuItem document={document} />
          <DownloadDocumentMenuItem document={document} />
          <ToggleDocumentAvailabilityMenuItem document={document} />
          <DropdownMenuSeparator className="my-px" />
          <RemoveDocumentMenuItem document={document} onOpen={() => setRemoveDialogOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <span id={unavailableReasonId} className="sr-only">
        {t(($) => $['newKnowledge.documentActionsUnavailable'])}
      </span>
      <RenameDocumentDialog
        key={renameDialogOpen ? 'open' : 'closed'}
        document={document}
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
      />
      <RemoveDocumentDialog
        document={document}
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
      />
    </>
  )
}
