'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
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
  const { t } = useTranslation('dataset')
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
  const [guardBusy, setGuardBusy] = useState(false)
  const guardPendingRef = useRef(false)
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)

  const startReindex = async () => {
    if (guardPendingRef.current) return
    guardPendingRef.current = true
    setGuardBusy(true)
    try {
      const readiness = await ensureModelReady({ capability: 'index', intent: 'reindex' })
      if (readiness.status === 'ready') {
        const result = await reindexDocument(refreshWritePermission)
        if (result === 'started') toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
        else if (result === 'document-missing')
          toast.error(t(($) => $['newKnowledge.documentNotFoundTitle']))
        else if (result === 'failed')
          toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
      }
    } finally {
      guardPendingRef.current = false
      setGuardBusy(false)
    }
  }

  const stopReindex = async () => {
    const result = await cancelReindex(refreshWritePermission)
    if (result === 'failed') toast.error(t(($) => $['newKnowledge.taskActionFailed']))
  }

  return (
    <>
      <Button
        aria-busy={guardBusy || reindexing || cancelBusy}
        aria-describedby={disabledReasonId}
        className="gap-1 pl-3"
        disabled={inProgress ? !canCancel : disabled || guardBusy}
        loading={inProgress ? cancelBusy : guardBusy || reindexing}
        onClick={() => void (inProgress ? stopReindex() : startReindex())}
      >
        {!inProgress && <span aria-hidden className="i-ri-refresh-line size-4" />}
        {t(($) =>
          inProgress
            ? $['newKnowledge.cancelDocumentReindex']
            : failed
              ? $['newKnowledge.retryReindexDocument']
              : $['newKnowledge.reindexDocument'],
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
