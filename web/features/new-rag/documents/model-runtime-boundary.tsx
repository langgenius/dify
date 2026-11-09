'use client'

import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useLayoutEffect } from 'react'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { documentsKnowledgeSpaceIdAtom } from './state/inputs'
import { documentModelReadyActionAtom } from './state/runtime'

export function DocumentModelRuntimeController() {
  const knowledgeSpaceId = useAtomValueRawSync(documentsKnowledgeSpaceIdAtom)
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const setModelReadyAction = useSetAtom(documentModelReadyActionAtom)
  useLayoutEffect(() => {
    setModelReadyAction({ ensureModelReady })
  }, [ensureModelReady, setModelReadyAction])

  return (
    <KnowledgeModelSetupDialog
      open={modelSetupDialogOpen}
      readiness={modelReadiness}
      onOpenChange={setModelSetupDialogOpen}
      onConfigure={configureModelSetup}
    />
  )
}
