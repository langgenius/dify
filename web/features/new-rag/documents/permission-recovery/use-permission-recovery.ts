'use client'

import type { DocumentPermissionRecoveryRuntime } from './model'
import type {
  PermissionRecoveryEvent,
  PermissionRecoveryRuntimeState,
  ReadPermissionDenials,
} from './runtime-state'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { consoleQuery } from '@/service/client'
import { useKnowledgeSpace } from '../../space/context'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentPermissionQueryFactsAtom } from '../state/recovery'
import {
  documentAuxiliaryReadPermissionDeniedAtom,
  resetDocumentFailedTaskPollBlocksAtom,
  retryDocumentAuxiliaryTaskReadAtom,
} from '../state/runtime'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'
import {
  createPermissionRecoveryRuntimeState,
  transitionPermissionRecoveryRuntimeState,
} from './runtime-state'

export function useDocumentPermissionRecovery() {
  const queryClient = useQueryClient()
  const { refetch: refetchKnowledgeSpace, space } = useKnowledgeSpace()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const {
    documentPermissionDenied,
    refetchSources,
    refetchTasks,
    sourcePermissionDenied,
    taskPermissionDenied,
  } = useAtomValue(documentPermissionQueryFactsAtom)
  const auxiliaryReadPermissionDenied = useAtomValue(documentAuxiliaryReadPermissionDeniedAtom)
  const resetFailedPollBlocks = useSetAtom(resetDocumentFailedTaskPollBlocksAtom)
  const retryAuxiliaryTaskRead = useSetAtom(retryDocumentAuxiliaryTaskReadAtom)
  const hasWorkspaceWritePermission = space.permission_keys.includes(
    'knowledge_space_document_write',
  )
  const readDenials = useMemo<ReadPermissionDenials>(
    () => ({
      documents: documentPermissionDenied || auxiliaryReadPermissionDenied,
      sources: sourcePermissionDenied,
      tasks: taskPermissionDenied,
    }),
    [
      auxiliaryReadPermissionDenied,
      documentPermissionDenied,
      sourcePermissionDenied,
      taskPermissionDenied,
    ],
  )
  const runtimeStateRef = useRef<PermissionRecoveryRuntimeState | null>(null)
  if (!runtimeStateRef.current) {
    runtimeStateRef.current = createPermissionRecoveryRuntimeState({
      denials: readDenials,
      writable: hasWorkspaceWritePermission,
    })
  }
  const [runtimeState, dispatch] = useReducer(
    (state: PermissionRecoveryRuntimeState, event: PermissionRecoveryEvent) =>
      transitionPermissionRecoveryRuntimeState(state, event).state,
    runtimeStateRef.current,
  )

  const applyEvent = useCallback((event: PermissionRecoveryEvent) => {
    const transition = transitionPermissionRecoveryRuntimeState(runtimeStateRef.current!, event)
    runtimeStateRef.current = transition.state
    dispatch(event)
    return transition
  }, [])

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

  const refreshWorkspacePermission = useCallback(
    async (generation: number) => {
      applyEvent({ generation, type: 'write-refresh-started' })
      try {
        const refreshedSpace = await refetchKnowledgeSpace()
        applyEvent({
          generation,
          type: 'write-refresh-finished',
          writable: Boolean(
            refreshedSpace?.permission_keys.includes('knowledge_space_document_write'),
          ),
        })
      } catch {
        applyEvent({ generation, type: 'write-refresh-finished', writable: false })
      }
    },
    [applyEvent, refetchKnowledgeSpace],
  )

  const denyWrite = useCallback(() => {
    const denial = applyEvent({ type: 'write-denied' })
    void refreshWorkspacePermission(denial.state.write.generation)
  }, [applyEvent, refreshWorkspacePermission])

  const retryWorkspacePermission = useCallback(async () => {
    const denial = applyEvent({ type: 'write-denied' })
    await refreshWorkspacePermission(denial.state.write.generation)
  }, [applyEvent, refreshWorkspacePermission])

  const retryRead = useCallback(() => {
    applyEvent({ type: 'read-retry-requested' })
    retryAuxiliaryTaskRead()
  }, [applyEvent, retryAuxiliaryTaskRead])

  const denialIdentity = `${documentPermissionDenied ? 'documents' : ''}:${auxiliaryReadPermissionDenied ? 'auxiliary' : ''}:${readDenials.tasks ? 'tasks' : ''}:${readDenials.sources ? 'sources' : ''}`
  const recoverySurface = useMemo<DocumentPermissionRecoveryRuntime>(
    () => ({
      canRetryRead: auxiliaryReadPermissionDenied && !documentPermissionDenied,
      denialIdentity,
      retryRead,
      writeStatus: runtimeState.write.status,
    }),
    [
      auxiliaryReadPermissionDenied,
      denialIdentity,
      documentPermissionDenied,
      retryRead,
      runtimeState.write.status,
    ],
  )

  return {
    canRead,
    canWrite: canRead && hasWorkspaceWritePermission && runtimeState.write.status === 'writable',
    denyWrite,
    recoverySurface,
    retryWorkspacePermission,
    workspacePermissionRefreshing: runtimeState.write.status === 'refreshing',
  }
}
