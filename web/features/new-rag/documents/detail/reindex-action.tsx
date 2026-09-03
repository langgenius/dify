'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'
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
  const { t } = useTranslation('knowledgeSpace')
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const canCancel = useAtomValue(documentCanCancelReindexAtom)
  const cancelBusy = useAtomValue(documentReindexCancelBusyAtom)
  const disabled = useAtomValue(documentReindexDisabledAtom)
  const disabledReasonId = useAtomValue(documentReindexDisabledReasonIdAtom)
  const failed = useAtomValue(documentReindexFailedAtom)
  const inProgress = useAtomValue(documentReindexInProgressAtom)
  const reindexBusy = useAtomValue(documentReindexBusyAtom)
  const submissionPending = useAtomValue(documentSubmissionPendingAtom)
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
      if (result === 'started') toast.success(t(($) => $.documentsReindexStarted))
      else if (result === 'document-missing') toast.error(t(($) => $.documentNotFoundTitle))
      else if (result === 'failed') toast.error(t(($) => $.documentsReindexFailed))
    },
  })
  const guardBusy = startReindexMutation.isPending

  const stopReindex = async () => {
    const result = await cancelReindex(refreshWritePermission)
    if (result === 'failed') toast.error(t(($) => $.taskActionFailed))
  }

  return (
    <>
      <Button
        aria-busy={guardBusy || reindexing || cancelBusy}
        aria-describedby={disabledReasonId}
        className="gap-1 pl-3"
        disabled={inProgress ? !canCancel : disabled || guardBusy}
        loading={inProgress ? cancelBusy : guardBusy || reindexing}
        onClick={() => void (inProgress ? stopReindex() : startReindexMutation.mutate())}
      >
        {!inProgress && <span aria-hidden className="i-ri-refresh-line size-4" />}
        {t(($) =>
          inProgress
            ? $.cancelDocumentReindex
            : failed
              ? $.retryReindexDocument
              : $.reindexDocument,
        )}
      </Button>
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </>
  )
}
