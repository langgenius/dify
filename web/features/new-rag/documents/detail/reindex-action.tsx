'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'
import { ReindexConfirmDialog } from '../reindex-confirm-dialog'
import { useReindexConfirmation } from '../use-reindex-confirmation'
import { documentDetailKnowledgeSpaceIdAtom } from './state/inputs'
import {
  cancelDocumentReindexAtom,
  documentCanCancelReindexAtom,
  documentReindexBusyAtom,
  documentReindexCancelBusyAtom,
  documentReindexDisabledAtom,
  documentReindexDisabledReasonIdAtom,
  documentReindexFailedAtom,
  documentReindexInProgressAtom,
  documentSubmissionPendingAtom,
  reindexDocumentAtom,
} from './state/workflow'
import { useRefreshDocumentWritePermission } from './write-permission'

export function DocumentReindexAction() {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const { t: tError } = useTranslation(['knowledgeErrors'])
  const knowledgeSpaceId = useAtomValueRawSync(documentDetailKnowledgeSpaceIdAtom)
  const canCancel = useAtomValueRawSync(documentCanCancelReindexAtom)
  const cancelBusy = useAtomValueRawSync(documentReindexCancelBusyAtom)
  const disabled = useAtomValueRawSync(documentReindexDisabledAtom)
  const disabledReasonId = useAtomValueRawSync(documentReindexDisabledReasonIdAtom)
  const failed = useAtomValueRawSync(documentReindexFailedAtom)
  const inProgress = useAtomValueRawSync(documentReindexInProgressAtom)
  const reindexBusy = useAtomValueRawSync(documentReindexBusyAtom)
  const submissionPending = useAtomValueRawSync(documentSubmissionPendingAtom)
  const reindexing = reindexBusy || submissionPending
  const cancelReindex = useSetAtom(cancelDocumentReindexAtom)
  const reindexDocument = useSetAtom(reindexDocumentAtom)
  const refreshWritePermission = useRefreshDocumentWritePermission()
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const startReindexMutation = useMutation({
    mutationFn: async () => {
      const readiness = await ensureModelReady({ capability: 'index', intent: 'reindex' })
      return readiness.status === 'ready' ? reindexDocument(refreshWritePermission) : undefined
    },
    onSuccess: (result) => {
      if (result?.status === 'started')
        toast.success(t(($) => $.documentsReindexStarted, { ns: 'knowledgeDocuments' }))
      else if (result?.status === 'document-missing')
        toast.error(t(($) => $.documentNotFoundTitle, { ns: 'knowledgeDocuments' }))
      else if (result?.status === 'failed') {
        const messageKey = result.messageKey
        toast.error(
          messageKey
            ? tError(($) => $[messageKey])
            : (result.errorMessage ??
                t(($) => $.documentsReindexFailed, { ns: 'knowledgeDocuments' })),
        )
      }
    },
  })
  const guardBusy = startReindexMutation.isPending
  // The button only asks while it is neither disabled nor busy; a reindex that starts, or a
  // document that stops allowing one, while the dialog is open takes the dialog with it.
  const confirmation = useReindexConfirmation(!inProgress && !disabled && !guardBusy && !reindexing)

  const stopReindex = async () => {
    const result = await cancelReindex(refreshWritePermission)
    if (result.status === 'failed') toast.error(result.message ?? t(($) => $.taskActionFailed))
  }

  return (
    <>
      <Button
        aria-describedby={disabledReasonId}
        className="gap-1 ps-3"
        disabled={inProgress ? !canCancel : disabled}
        loading={inProgress ? cancelBusy : guardBusy || reindexing}
        onClick={() => (inProgress ? void stopReindex() : confirmation.setOpen(true))}
      >
        {!inProgress && <span aria-hidden className="i-ri-refresh-line size-4" />}
        {t(
          ($) =>
            inProgress
              ? $.cancelDocumentReindex
              : failed
                ? $.retryReindexDocument
                : $.reindexDocument,
          { ns: 'knowledgeDocuments' },
        )}
      </Button>
      <ReindexConfirmDialog
        open={confirmation.open}
        onOpenChange={confirmation.setOpen}
        onConfirm={() => startReindexMutation.mutate()}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </>
  )
}
