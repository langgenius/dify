'use client'

import type { LogicalDocument } from './models'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useAtomValueRawSync } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentShowsAvailabilityAction,
  taskCanRetry,
} from './model'
import { ReindexConfirmDialog } from './reindex-confirm-dialog'
import {
  useDocumentRowPendingAction,
  useDownloadDocumentAction,
  useReindexDocumentAction,
  useRenameDocumentAction,
  useRetryDocumentTaskAction,
  useToggleDocumentAvailabilityAction,
} from './row-actions/use-document-row-actions'
import { createDocumentRowActionFactsAtom, createDocumentRowCanEditAtom } from './state/results'
import { documentCanDownloadAtom } from './state/runtime'
import { useReindexConfirmation } from './use-reindex-confirmation'

function useDocumentActionFacts(documentId: string) {
  const factsAtom = useMemo(() => createDocumentRowActionFactsAtom(documentId), [documentId])
  return useAtomValueRawSync(factsAtom)
}

function useDocumentCanEdit(documentId: string) {
  const canEditAtom = useMemo(() => createDocumentRowCanEditAtom(documentId), [documentId])
  return useAtomValueRawSync(canEditAtom)
}

function RenameDocumentMenuItem({
  document,
  onOpen,
}: {
  document: LogicalDocument
  onOpen: () => void
}) {
  const { t: tCommon } = useTranslation(['common'])
  const canEdit = useDocumentCanEdit(document.id)
  const busy = Boolean(useDocumentRowPendingAction(document.id))

  return (
    <MenuItem
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={!canEdit || busy}
      onClick={onOpen}
    >
      <span aria-hidden className="i-ri-edit-line size-4" />
      {tCommon(($) => $['operation.rename'])}
    </MenuItem>
  )
}

function RenameDocumentForm({
  document,
  onSaved,
}: {
  document: LogicalDocument
  onSaved: () => void
}) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const { t: tCommon } = useTranslation(['common'])
  const [nextTitle, setNextTitle] = useState(document.title)
  const { busy, pending, run } = useRenameDocumentAction(document)
  const inputId = `new-document-${document.id}-rename`
  const submit = async () => {
    const title = nextTitle.trim()
    if (!title || title === document.title || busy) return
    if (await run(title)) onSaved()
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{tCommon(($) => $['operation.rename'])}</DialogTitle>
        <DialogDescription>{document.title}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <label className="block system-sm-medium text-text-secondary" htmlFor={inputId}>
          {t(($) => $.documentColumn)}
        </label>
        <Input
          id={inputId}
          autoComplete="off"
          className="mt-2 w-full"
          disabled={pending}
          value={nextTitle}
          onChange={(event) => setNextTitle(event.target.value)}
        />
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={pending} />}>
          {tCommon(($) => $['operation.cancel'])}
        </DialogClose>
        <Button
          disabled={!nextTitle.trim() || nextTitle.trim() === document.title}
          loading={pending}
          type="submit"
          variant="primary"
        >
          {tCommon(($) => $['operation.save'])}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RetryDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const canEdit = useDocumentCanEdit(document.id)
  const { task } = useDocumentActionFacts(document.id)
  const { busy, run } = useRetryDocumentTaskAction(document.id, task)
  const disabled = !canEdit || !task || !taskCanRetry(task)
  const unavailableReasonId = `new-document-${document.id}-actions-unavailable`

  return (
    <MenuItem
      aria-describedby={disabled ? unavailableReasonId : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span aria-hidden className="i-ri-restart-line size-4" />
      {t(($) => $.retryTask)}
    </MenuItem>
  )
}

function ReindexDocumentMenuItem({
  document,
  onOpen,
}: {
  document: LogicalDocument
  onOpen: () => void
}) {
  const { t } = useTranslation(['dataset', 'knowledgeDocuments'])
  const canEdit = useDocumentCanEdit(document.id)
  const { status } = useDocumentActionFacts(document.id)
  const busy = Boolean(useDocumentRowPendingAction(document.id))
  const disabled = !canEdit || !documentCanReindex(status)

  return (
    <MenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={onOpen}
    >
      <span aria-hidden className="i-ri-loop-left-line size-4" />
      {t(($) => $.reindexDocument, { ns: 'knowledgeDocuments' })}
    </MenuItem>
  )
}

/**
 * Asks, then runs the reindex. It is mounted beside the menu, which closes when an item is
 * chosen, and shows from the moment it is mounted: each request to reindex mounts a new one.
 */
function ReindexDocumentConfirmation({ document }: { document: LogicalDocument }) {
  const canEdit = useDocumentCanEdit(document.id)
  const { status } = useDocumentActionFacts(document.id)
  const { busy, run } = useReindexDocumentAction(document, status)
  const { open, setOpen } = useReindexConfirmation(
    canEdit && documentCanReindex(status) && !busy,
    true,
  )
  return <ReindexConfirmDialog open={open} onOpenChange={setOpen} onConfirm={() => void run()} />
}

function ReprocessDocumentMenuItem({
  document,
  onReindex,
}: {
  document: LogicalDocument
  onReindex: () => void
}) {
  const { status } = useDocumentActionFacts(document.id)
  return status === 'failed' ? (
    <RetryDocumentMenuItem document={document} />
  ) : (
    <ReindexDocumentMenuItem document={document} onOpen={onReindex} />
  )
}

function DownloadDocumentMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation(['dataset', 'knowledgeDocuments'])
  const canDownload = useAtomValueRawSync(documentCanDownloadAtom)
  const { status, documentSnapshotPending } = useDocumentActionFacts(document.id)
  const { busy, run } = useDownloadDocumentAction(document, status, documentSnapshotPending)
  const disabled = !canDownload || documentSnapshotPending || !documentCanDownload(document, status)

  return (
    <MenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="mb-px h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      onClick={() => void run()}
    >
      <span aria-hidden className="i-ri-download-line size-4" />
      {t(($) => $.downloadDocuments, { ns: 'knowledgeDocuments' })}
    </MenuItem>
  )
}

function ToggleDocumentAvailabilityMenuItem({ document }: { document: LogicalDocument }) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const canEdit = useDocumentCanEdit(document.id)
  const { status } = useDocumentActionFacts(document.id)
  const { busy, run } = useToggleDocumentAvailabilityAction(document, status)
  if (!documentShowsAvailabilityAction(status)) return null
  const disabled =
    !canEdit || document.status === 'deleting' || !documentCanToggleAvailability(status)

  return (
    <MenuItem
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
      {document.enabled ? t(($) => $.disableSource) : t(($) => $.enable, { ns: 'dataset' })}
    </MenuItem>
  )
}

function RemoveDocumentMenuItem({
  document,
  onOpen,
}: {
  document: LogicalDocument
  onOpen: () => void
}) {
  const { t: tCommon } = useTranslation(['common'])
  const canEdit = useDocumentCanEdit(document.id)
  const busy = Boolean(useDocumentRowPendingAction(document.id))
  const disabled = !canEdit || document.status === 'deleting'

  return (
    <MenuItem
      aria-describedby={disabled ? `new-document-${document.id}-actions-unavailable` : undefined}
      className="h-7 gap-2 px-2 system-sm-medium"
      disabled={busy || disabled}
      variant="destructive"
      onClick={onOpen}
    >
      <span aria-hidden className="i-ri-delete-bin-line size-4" />
      {tCommon(($) => $['operation.delete'])}
    </MenuItem>
  )
}

export function DocumentActionsMenu({
  className,
  document,
  onRemove,
}: {
  className?: string
  onRemove: () => void
  document: LogicalDocument
}) {
  const { t } = useTranslation(['dataset', 'knowledgeDocuments'])
  const pendingAction = useDocumentRowPendingAction(document.id)
  const busy = Boolean(pendingAction)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  // A list has hundreds of rows and few of them are ever reindexed, so a row gets a confirmation
  // (a dialog and the action behind it) only once a reindex was asked for; 0 is "never".
  const [reindexRequest, setReindexRequest] = useState(0)
  const unavailableReasonId = `new-document-${document.id}-actions-unavailable`

  return (
    <>
      <Menu modal={false}>
        <MenuTrigger
          aria-label={t(($) => $.documentActions, {
            ns: 'knowledgeDocuments',
            name: document.title,
          })}
          disabled={busy}
          className={cn(
            'ms-auto flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled',
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
        </MenuTrigger>
        <MenuContent align="end" className="w-50">
          <RenameDocumentMenuItem document={document} onOpen={() => setRenameDialogOpen(true)} />
          <ReprocessDocumentMenuItem
            document={document}
            onReindex={() => setReindexRequest((request) => request + 1)}
          />
          <DownloadDocumentMenuItem document={document} />
          <ToggleDocumentAvailabilityMenuItem document={document} />
          <MenuSeparator className="my-px" />
          <RemoveDocumentMenuItem document={document} onOpen={onRemove} />
        </MenuContent>
      </Menu>
      <span id={unavailableReasonId} className="sr-only">
        {t(($) => $.documentActionsUnavailable, { ns: 'knowledgeDocuments' })}
      </span>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open, details) => {
          if (!open && pendingAction === 'rename') details.cancel()
          else setRenameDialogOpen(open)
        }}
      >
        <DialogContent>
          <RenameDocumentForm document={document} onSaved={() => setRenameDialogOpen(false)} />
        </DialogContent>
      </Dialog>
      {reindexRequest > 0 && (
        <ReindexDocumentConfirmation key={reindexRequest} document={document} />
      )}
    </>
  )
}
