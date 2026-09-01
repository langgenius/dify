'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeSpace } from '../../space/context'
import {
  documentLatestTaskAtom,
  documentSubmissionPendingAtom,
  documentSubmittedJobMissingAtom,
  documentSubmittedJobTerminalAtom,
  documentTaskIsLookingUpAtom,
  documentTasksQueryErrorAtom,
  documentTasksQueryIsFetchingNextPageAtom,
  documentTasksQueryIsPendingAtom,
  documentWorkflowInitializedAtom,
  documentWorkflowRuntimeAtom,
  initializeDocumentWorkflowAtom,
  loadNextDocumentTaskPageAtom,
  persistDocumentWorkflowAtom,
  reconcileDocumentTaskAtom,
  reconcileSubmittedDocumentJobAtom,
} from './state/workflow'

export function DocumentWorkflowController() {
  const { t } = useTranslation('dataset')
  const { refetch: refetchKnowledgeSpace, space } = useKnowledgeSpace()
  const runtime = useMemo(
    () => ({
      hasEditPermission: space.permission_keys.includes('knowledge_space_document_write'),
      messages: {
        actionFailed: t(($) => $['newKnowledge.taskActionFailed']),
        documentMissing: t(($) => $['newKnowledge.documentNotFoundTitle']),
        reindexFailed: t(($) => $['newKnowledge.documentsReindexFailed']),
        reindexStarted: t(($) => $['newKnowledge.documentsReindexStarted']),
      },
      refreshWritePermission: async () =>
        Boolean(
          (await refetchKnowledgeSpace())?.permission_keys.includes(
            'knowledge_space_document_write',
          ),
        ),
    }),
    [refetchKnowledgeSpace, space.permission_keys, t],
  )
  const setWorkflowRuntime = useSetAtom(documentWorkflowRuntimeAtom)

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
    setWorkflowRuntime(runtime)
  }, [runtime, setWorkflowRuntime])

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

  return null
}
