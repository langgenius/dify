'use client'

import type { ReactNode } from 'react'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect } from 'react'
import { useKnowledgeSpace } from '../../space/context'
import {
  documentHasEditPermissionAtom,
  documentLatestTaskAtom,
  documentSubmissionPendingAtom,
  documentSubmittedJobMissingAtom,
  documentSubmittedJobTerminalAtom,
  documentWorkflowInitializedAtom,
  initializeDocumentWorkflowAtom,
  persistDocumentWorkflowAtom,
  reconcileDocumentTaskAtom,
  reconcileSubmittedDocumentJobAtom,
} from './state/workflow'

export function DocumentWorkflowBoundary({ children }: { children: ReactNode }) {
  const { space } = useKnowledgeSpace()
  const hasEditPermission = space.permission_keys.includes('knowledge_space_document_write')
  useHydrateAtoms([[documentHasEditPermissionAtom, hasEditPermission]], {
    dangerouslyForceHydrate: true,
  })

  const initialized = useAtomValueRawSync(documentWorkflowInitializedAtom)
  const latestTask = useAtomValueRawSync(documentLatestTaskAtom)
  const submissionPending = useAtomValueRawSync(documentSubmissionPendingAtom)
  const submittedJobTerminal = useAtomValueRawSync(documentSubmittedJobTerminalAtom)
  const submittedJobMissing = useAtomValueRawSync(documentSubmittedJobMissingAtom)
  const initializeWorkflow = useSetAtom(initializeDocumentWorkflowAtom)
  const persistWorkflow = useSetAtom(persistDocumentWorkflowAtom)
  const reconcileTask = useSetAtom(reconcileDocumentTaskAtom)
  const reconcileSubmittedJob = useSetAtom(reconcileSubmittedDocumentJobAtom)

  useEffect(() => {
    initializeWorkflow()
  }, [initializeWorkflow])

  useEffect(() => {
    if (initialized) persistWorkflow()
  }, [initialized, latestTask, persistWorkflow, submissionPending])

  useEffect(() => {
    if (initialized) void reconcileTask()
  }, [initialized, latestTask, reconcileTask])

  useEffect(() => {
    if (initialized && (submittedJobTerminal || submittedJobMissing)) void reconcileSubmittedJob()
  }, [initialized, reconcileSubmittedJob, submittedJobMissing, submittedJobTerminal])

  return children
}
