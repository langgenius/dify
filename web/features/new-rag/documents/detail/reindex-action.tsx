'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'

export function DocumentReindexAction({
  canCancel,
  cancelBusy,
  disabled,
  disabledReasonId,
  failed,
  inProgress,
  knowledgeSpaceId,
  onCancel,
  onReindex,
  reindexing,
}: {
  canCancel: boolean
  cancelBusy: boolean
  disabled: boolean
  disabledReasonId?: string
  failed: boolean
  inProgress: boolean
  knowledgeSpaceId: string
  onCancel: () => Promise<unknown>
  onReindex: () => Promise<unknown>
  reindexing: boolean
}) {
  const { t } = useTranslation('dataset')
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
      if (readiness.status === 'ready') await onReindex()
    } finally {
      guardPendingRef.current = false
      setGuardBusy(false)
    }
  }

  return (
    <>
      <Button
        aria-busy={guardBusy || reindexing || cancelBusy}
        aria-describedby={disabledReasonId}
        className="gap-1 pl-3"
        disabled={inProgress ? !canCancel : disabled || guardBusy}
        loading={inProgress ? cancelBusy : guardBusy || reindexing}
        onClick={() => void (inProgress ? onCancel() : startReindex())}
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
