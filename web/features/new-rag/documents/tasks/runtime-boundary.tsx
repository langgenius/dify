'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentTaskPermissionGuardFactsAtom } from '../state/recovery'
import { documentTaskRuntimeBridgeAtom } from '../state/runtime'
import { documentTasksOpenAtom } from '../state/scoped'
import { useAuxiliaryTaskReadGuard } from './auxiliary-read-guard'
import { TaskEventObserver } from './event-observer'
import { queryKeyMatchesKnowledgeSpace } from './recovery'
import { useTaskRuntimeController } from './use-task-runtime'

export function DocumentTaskRuntimeController() {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeTasks'])
  const queryClient = useQueryClient()
  const deploymentEdition = useAtomValueRawSync(deploymentEditionAtom)
  const knowledgeSpaceId = useAtomValueRawSync(documentsKnowledgeSpaceIdAtom)
  const tasksOpen = useAtomValueRawSync(documentTasksOpenAtom)
  const permissionQueryFacts = useAtomValueRawSync(documentTaskPermissionGuardFactsAtom)
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
    void Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key(),
      }),
      ...(deploymentEdition === 'CLOUD'
        ? [
            queryClient.invalidateQueries(
              { queryKey: consoleQuery.features.get.key() },
              { cancelRefetch: false },
            ),
            queryClient.invalidateQueries(
              { queryKey: consoleQuery.features.vectorSpace.get.key() },
              { cancelRefetch: false },
            ),
          ]
        : []),
    ])
  }, [deploymentEdition, knowledgeSpaceId, queryClient])
  const notifyTaskFailed = useCallback(
    () => toast.error(t(($) => $.taskFailedNotification, { ns: 'knowledgeTasks' })),
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
