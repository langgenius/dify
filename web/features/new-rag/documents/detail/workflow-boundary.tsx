'use client'

import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect } from 'react'
import { useKnowledgeSpace } from '../../space/context'
import {
  documentHasEditPermissionAtom,
  documentLatestTaskAtom,
  documentSubmissionPendingAtom,
  documentSubmittedJobMissingAtom,
  documentSubmittedJobTerminalAtom,
  documentTaskIsLookingUpAtom,
  documentTasksQueryErrorAtom,
  documentTasksQueryIsFetchingNextPageAtom,
  documentTasksQueryIsPendingAtom,
  documentWorkflowInitializedAtom,
  initializeDocumentWorkflowAtom,
  loadNextDocumentTaskPageAtom,
  persistDocumentWorkflowAtom,
  reconcileDocumentTaskAtom,
  reconcileSubmittedDocumentJobAtom,
} from './state/workflow'

export function DocumentWorkflowBoundary({ children }: { children: ReactNode }) {
  const { space } = useKnowledgeSpace()
  const hasEditPermission = space.permission_keys.includes('knowledge_space_document_write')
  useHydrateAtoms([[documentHasEditPermissionAtom, hasEditPermission]])
  const setHasEditPermission = useSetAtom(documentHasEditPermissionAtom)

  const initialized = useAtomValue(documentWorkflowInitializedAtom)
  const latestTask = useAtomValue(documentLatestTaskAtom)
  const submissionPending = useAtomValue(documentSubmissionPendingAtom)
  const submittedJobTerminal = useAtomValue(documentSubmittedJobTerminalAtom)
  const submittedJobMissing = useAtomValue(documentSubmittedJobMissingAtom)
  const taskError = useAtomValue(documentTasksQueryErrorAtom)
  const taskIsLookingUp = useAtomValue(documentTaskIsLookingUpAtom)
  const taskIsFetchingNextPage = useAtomValue(documentTasksQueryIsFetchingNextPageAtom)
  const taskIsPending = useAtomValue(documentTasksQueryIsPendingAtom)
  const initializeWorkflow = useSetAtom(initializeDocumentWorkflowAtom)
  const loadNextTaskPage = useSetAtom(loadNextDocumentTaskPageAtom)
  const persistWorkflow = useSetAtom(persistDocumentWorkflowAtom)
  const reconcileTask = useSetAtom(reconcileDocumentTaskAtom)
  const reconcileSubmittedJob = useSetAtom(reconcileSubmittedDocumentJobAtom)

  useEffect(() => {
    setHasEditPermission(hasEditPermission)
  }, [hasEditPermission, setHasEditPermission])

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

  useEffect(() => {
    if (!initialized || taskIsPending || taskIsFetchingNextPage || taskError || !taskIsLookingUp)
      return
    void loadNextTaskPage()
  }, [
    initialized,
    loadNextTaskPage,
    taskError,
    taskIsFetchingNextPage,
    taskIsLookingUp,
    taskIsPending,
  ])

  return children
}
