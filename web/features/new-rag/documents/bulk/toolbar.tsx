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
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { documentBulkPendingActionAtom } from '../state/bulk'
import { reindexUnavailabilityAtom, selectionResultsUnavailableAtom } from '../state/results'
import { documentCanDownloadAtom, documentCanWriteAtom } from '../state/runtime'
import {
  clearDocumentSelectionAtom,
  downloadableDocumentIdsAtom,
  selectionAvailabilityActionVisibleAtom,
  selectionAvailabilityDisabledAtom,
  selectionAvailabilityTargetEnabledAtom,
  selectionReindexDisabledAtom,
  validSelectedDocumentIdsAtom,
} from '../state/selection'
import {
  useBulkAvailabilityAction,
  useBulkDownloadAction,
  useBulkReindexAction,
  useBulkRemoveAction,
} from './use-bulk-actions'

function BulkReindexAction() {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const disabled = useAtomValue(selectionResultsUnavailableAtom)
  const reindexDisabled = useAtomValue(selectionReindexDisabledAtom)
  const unavailableReason = useAtomValue(reindexUnavailabilityAtom)
  const { busy, pending, run } = useBulkReindexAction()
  const disabledReason =
    unavailableReason === 'tasks'
      ? t(($) => $.tasksErrorDescription)
      : unavailableReason === 'sources'
        ? t(($) => $.sourcesErrorDescription)
        : unavailableReason === 'documents'
          ? t(($) => $.documentsErrorDescription)
          : unavailableReason === 'loading'
            ? tCommon(($) => $.loading)
            : unavailableReason === 'partial'
              ? t(($) => $.partialDocumentResults)
              : undefined

  return (
    <>
      <Button
        aria-describedby={disabled ? 'document-reindex-unavailable' : undefined}
        aria-busy={pending}
        className="shrink-0"
        disabled={disabled || reindexDisabled || busy}
        loading={pending}
        size="small"
        onClick={() => void run()}
      >
        {t(($) => $.reindexDocuments)}
      </Button>
      {disabled && disabledReason && (
        <span
          id="document-reindex-unavailable"
          className="max-w-44 shrink-0 system-2xs-regular text-text-tertiary"
          role="status"
        >
          {t(($) => $.reindexDocuments)}
          {' · '}
          {disabledReason}
        </span>
      )}
    </>
  )
}

function BulkDownloadAction() {
  const { t } = useTranslation('knowledgeSpace')
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const downloadableDocumentIds = useAtomValue(downloadableDocumentIdsAtom)
  const disabled = !canDownload || !downloadableDocumentIds.length
  const { busy, pending, run } = useBulkDownloadAction()

  return (
    <>
      <Button
        aria-busy={pending}
        aria-describedby={disabled ? 'document-download-unavailable' : undefined}
        className="shrink-0"
        disabled={disabled || busy}
        loading={pending}
        size="small"
        onClick={() => void run()}
      >
        {t(($) => $.downloadDocuments)}
      </Button>
      <span id="document-download-unavailable" className="sr-only">
        {t(($) => $.documentActionsUnavailable)}
      </span>
    </>
  )
}

function BulkAvailabilityAction() {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tDataset } = useTranslation('dataset')
  const actionVisible = useAtomValue(selectionAvailabilityActionVisibleAtom)
  const actionDisabled = useAtomValue(selectionAvailabilityDisabledAtom)
  const targetEnabled = useAtomValue(selectionAvailabilityTargetEnabledAtom)
  const resultsUnavailable = useAtomValue(selectionResultsUnavailableAtom)
  const { busy, pending, run } = useBulkAvailabilityAction()

  if (!actionVisible) return null

  return (
    <Button
      className="shrink-0"
      disabled={resultsUnavailable || actionDisabled || busy}
      size="small"
      loading={pending}
      onClick={() => void run()}
    >
      {targetEnabled ? tDataset(($) => $.enable) : t(($) => $.disableSource)}
    </Button>
  )
}

function BulkRemoveAction() {
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const resultsUnavailable = useAtomValue(selectionResultsUnavailableAtom)
  const { busy, pending, run } = useBulkRemoveAction()

  return (
    <>
      <Button
        className="shrink-0"
        disabled={resultsUnavailable || busy}
        loading={pending}
        size="small"
        tone="destructive"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        {tCommon(($) => $['operation.remove'])}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
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
                  if (removed) setOpen(false)
                })
              }
            >
              {tCommon(($) => $['operation.remove'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function DocumentBulkActionsToolbar() {
  const { t } = useTranslation('knowledgeSpace')
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const clearSelectedDocuments = useSetAtom(clearDocumentSelectionAtom)
  const busy = Boolean(useAtomValue(documentBulkPendingActionAtom))

  if ((!canWrite && !canDownload) || !selectedDocumentIds.size) return null

  return (
    <div className="pointer-events-none fixed right-0 bottom-[calc(1.75rem+env(safe-area-inset-bottom,0px))] left-0 z-20 flex justify-center pr-[calc(1rem+env(safe-area-inset-right,0px))] pl-[calc(1rem+env(safe-area-inset-left,0px))] sm:left-(--new-rag-sidebar-width,0px)">
      <div
        aria-label={t(($) => $.bulkDocumentActions)}
        className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-x-auto rounded-[14px] border border-divider-subtle bg-components-panel-bg py-2.5 pr-2.5 pl-4 shadow-[0_12px_32px_-6px_rgba(15,23,41,0.16),0_2px_6px_rgba(15,23,41,0.06)]"
        role="group"
      >
        <span className="shrink-0 text-[13px] leading-4.5 font-medium text-text-primary">
          {t(($) => $.documentsSelected, {
            count: selectedDocumentIds.size,
          })}
        </span>
        <span aria-hidden className="h-5 w-px shrink-0 bg-divider-regular" />
        {canWrite && <BulkReindexAction />}
        {canDownload && <BulkDownloadAction />}
        {canWrite && <BulkAvailabilityAction />}
        {canWrite && <BulkRemoveAction />}
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $.clearDocumentSelection)}
          className="size-6.5 shrink-0 px-0"
          disabled={busy}
          onClick={() => {
            document.getElementById('new-knowledge-documents-title')?.focus()
            clearSelectedDocuments()
          }}
        >
          <span aria-hidden className="i-ri-close-line size-3.5" />
        </Button>
      </div>
    </div>
  )
}
