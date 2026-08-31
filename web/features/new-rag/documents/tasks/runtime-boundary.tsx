'use client'

import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentTaskPermissionGuardFactsAtom } from '../state/recovery'
import { documentTaskRuntimeBridgeAtom } from '../state/runtime'
import { documentTasksOpenAtom } from '../state/scoped'
import { useAuxiliaryTaskReadGuard } from './auxiliary-read-guard'
import { TaskEventObserver } from './event-observer'
import { queryKeyMatchesKnowledgeSpace } from './recovery'
import { useTaskRuntimeController } from './use-task-runtime'

export function DocumentTaskRuntimeController() {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const tasksOpen = useAtomValue(documentTasksOpenAtom)
  const permissionQueryFacts = useAtomValue(documentTaskPermissionGuardFactsAtom)
  const { documentPermissionDenied, sourcePermissionDenied } = permissionQueryFacts
  const {
    deny: denyAuxiliaryTaskRead,
    guard: auxiliaryTaskReadGuard,
    permissionDenied: auxiliaryReadPermissionDenied,
    retry: retryAuxiliaryTaskRead,
  } = useAuxiliaryTaskReadGuard({
    documentPermissionDenied,
    refetchDocuments: permissionQueryFacts.refetchDocuments,
  })

  const refreshDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
    })
  }, [knowledgeSpaceId, queryClient])
  const notifyTaskFailed = useCallback(
    () => toast.error(t(($) => $['newKnowledge.taskFailedNotification'])),
    [t],
  )
  const { acceptTaskSnapshot, observers, resetFailedPollBlocks } = useTaskRuntimeController({
    auxiliaryTaskReadGuard,
    denyAuxiliaryTaskRead,
    documentPermissionDenied,
    externalPermissionDenied:
      documentPermissionDenied || auxiliaryReadPermissionDenied || sourcePermissionDenied,
    knowledgeSpaceId,
    onTaskFailed: notifyTaskFailed,
    onTaskReachedTerminal: refreshDocuments,
    tasksOpen,
  })
  const setRuntimeBridge = useSetAtom(documentTaskRuntimeBridgeAtom)
  useLayoutEffect(() => {
    setRuntimeBridge({
      auxiliaryReadPermissionDenied,
      acceptTaskSnapshot,
      resetFailedPollBlocks,
      retryAuxiliaryTaskRead,
    })
  }, [
    acceptTaskSnapshot,
    auxiliaryReadPermissionDenied,
    resetFailedPollBlocks,
    retryAuxiliaryTaskRead,
    setRuntimeBridge,
  ])

  return observers.tasks.map((task) => (
    <TaskEventObserver
      key={`${task.id}:${observers.generation(task.id)}`}
      documentId={task.documentId}
      lastEventId={observers.eventCursors.get(task.id)}
      onEvent={observers.onEvent}
      onLastEventIdChange={observers.onEventCursorChange}
      onPermissionDenied={observers.onPermissionDenied}
      taskId={task.id}
      taskVersion={observers.version(task)}
    />
  ))
}
