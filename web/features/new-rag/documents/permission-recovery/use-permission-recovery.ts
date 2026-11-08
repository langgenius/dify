'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { consoleQuery } from '@/service/console'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentPermissionQueryFactsAtom } from '../state/recovery'
import {
  applyDocumentPermissionRecoveryEventAtom,
  documentHasWorkspaceWritePermissionAtom,
  documentReadDenialsAtom,
  resetDocumentFailedTaskPollBlocksAtom,
} from '../state/runtime'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

export function useDocumentPermissionRecovery() {
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { refetchSources, refetchTasks } = useAtomValue(documentPermissionQueryFactsAtom)
  const readDenials = useAtomValue(documentReadDenialsAtom)
  const hasWorkspaceWritePermission = useAtomValue(documentHasWorkspaceWritePermissionAtom)
  const resetFailedPollBlocks = useSetAtom(resetDocumentFailedTaskPollBlocksAtom)
  const applyEvent = useSetAtom(applyDocumentPermissionRecoveryEventAtom)

  useEffect(() => {
    const transition = applyEvent({ denials: readDenials, type: 'read-denials-changed' })
    for (const effect of transition.effects) {
      if (effect === 'reset-task-poll-blocks') resetFailedPollBlocks()
      else if (effect === 'refetch-tasks') void refetchTasks({ cancelRefetch: false })
      else void refetchSources({ cancelRefetch: false })
    }
  }, [applyEvent, readDenials, refetchSources, refetchTasks, resetFailedPollBlocks])

  useEffect(() => {
    applyEvent({ type: 'workspace-permission-changed', writable: hasWorkspaceWritePermission })
  }, [applyEvent, hasWorkspaceWritePermission])

  const canRead = !readDenials.documents && !readDenials.tasks && !readDenials.sources

  useEffect(() => {
    if (canRead) return
    void queryClient.cancelQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
    })
    void queryClient.cancelQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
    })
  }, [canRead, knowledgeSpaceId, queryClient])
}
