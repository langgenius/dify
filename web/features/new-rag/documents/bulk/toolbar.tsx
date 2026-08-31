'use client'

import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentBulkSelection } from './selection-state'
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentBulkActions } from './use-bulk-actions'

export function DocumentBulkActionsToolbar({
  canDownload,
  canWrite,
  disabled,
  disabledReason,
  ensureModelReady,
  knowledgeSpaceId,
  onWriteDenied,
  selection,
}: {
  canDownload: boolean
  canWrite: boolean
  disabled: boolean
  disabledReason?: string
  ensureModelReady: EnsureKnowledgeModelReady
  knowledgeSpaceId: string
  onWriteDenied: () => void
  selection: DocumentBulkSelection
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const { download, pendingAction, reindex, remove, updateAvailability } = useDocumentBulkActions({
    canDownload,
    canWrite,
    ensureModelReady,
    knowledgeSpaceId,
    onWriteDenied,
    selection,
    selectionDisabled: disabled,
  })
  const busy = Boolean(pendingAction)
  const downloadDisabled = !canDownload || !selection.downloadableDocumentIds.length

  const clearSelection = () => {
    document.getElementById('new-knowledge-documents-title')?.focus()
    selection.clear()
  }

  return (
    <>
      <div className="pointer-events-none fixed right-0 bottom-[calc(1.75rem+env(safe-area-inset-bottom,0px))] left-0 z-20 flex justify-center pr-[calc(1rem+env(safe-area-inset-right,0px))] pl-[calc(1rem+env(safe-area-inset-left,0px))] sm:left-(--new-rag-sidebar-width,0px)">
        <div
          aria-label={t(($) => $['newKnowledge.bulkDocumentActions'])}
          className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-x-auto rounded-[14px] border border-divider-subtle bg-components-panel-bg py-2.5 pr-2.5 pl-4 shadow-[0_12px_32px_-6px_rgba(15,23,41,0.16),0_2px_6px_rgba(15,23,41,0.06)]"
          role="group"
        >
          <span className="shrink-0 text-[13px] leading-4.5 font-medium text-text-primary">
            {t(($) => $['newKnowledge.documentsSelected'], {
              count: selection.selectedDocumentIds.size,
            })}
          </span>
          <span aria-hidden className="h-5 w-px shrink-0 bg-divider-regular" />
          <Button
            aria-describedby={disabled ? 'document-reindex-unavailable' : undefined}
            aria-busy={pendingAction === 'reindex'}
            className="shrink-0"
            disabled={disabled || selection.reindexDisabled || busy}
            loading={pendingAction === 'reindex'}
            size="small"
            onClick={() => void reindex()}
          >
            {t(($) => $['newKnowledge.reindexDocuments'])}
          </Button>
          {disabled && disabledReason && (
            <span
              id="document-reindex-unavailable"
              className="max-w-44 shrink-0 system-2xs-regular text-text-tertiary"
              role="status"
            >
              {t(($) => $['newKnowledge.reindexDocuments'])}
              {' · '}
              {disabledReason}
            </span>
          )}
          <Button
            aria-busy={pendingAction === 'download'}
            aria-describedby={downloadDisabled ? 'document-download-unavailable' : undefined}
            className="shrink-0"
            disabled={downloadDisabled || busy}
            loading={pendingAction === 'download'}
            size="small"
            onClick={() => void download()}
          >
            {t(($) => $['newKnowledge.downloadDocuments'])}
          </Button>
          {selection.availabilityActionVisible && (
            <Button
              className="shrink-0"
              disabled={disabled || selection.availabilityDisabled || busy}
              size="small"
              loading={pendingAction === 'availability'}
              onClick={() => void updateAvailability()}
            >
              {t(($) =>
                selection.availabilityTargetEnabled ? $.enable : $['newKnowledge.disableSource'],
              )}
            </Button>
          )}
          <Button
            className="shrink-0"
            disabled={disabled || busy}
            loading={pendingAction === 'remove'}
            size="small"
            tone="destructive"
            variant="secondary"
            onClick={() => setRemoveDialogOpen(true)}
          >
            {tCommon(($) => $['operation.remove'])}
          </Button>
          <Button
            variant="ghost"
            size="small"
            aria-label={t(($) => $['newKnowledge.clearDocumentSelection'])}
            className="size-6.5 shrink-0 px-0"
            disabled={busy}
            onClick={clearSelection}
          >
            <span aria-hidden className="i-ri-close-line size-3.5" />
          </Button>
        </div>
      </div>
      <span id="document-download-unavailable" className="sr-only">
        {t(($) => $['newKnowledge.documentActionsUnavailable'])}
      </span>

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
                void remove().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
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
