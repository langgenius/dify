'use client'

import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { refreshWorkspacePermissionKeysAfterMutationDenialAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { responseStatus } from './document-detail-model'
import { useDocumentTaskStatus } from './use-document-task-status'

const REINDEX_CONFIRMATION_TIMEOUT = 30000

export function useDocumentReindex({
  chunksQueryKey,
  documentActiveRevision,
  documentId,
  documentQueryKey,
  enabled,
  knowledgeSpaceId,
  revisionsQueryKey,
}: {
  chunksQueryKey: readonly unknown[]
  documentActiveRevision: number
  documentId: string
  documentQueryKey: readonly unknown[]
  enabled: boolean
  knowledgeSpaceId: string
  revisionsQueryKey: readonly unknown[]
}) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const refreshWorkspacePermissionKeysAfterMutationDenial = useSetAtom(
    refreshWorkspacePermissionKeysAfterMutationDenialAtom,
  )
  const [writePermissionRevoked, setWritePermissionRevoked] = useState(false)
  const [documentMissing, setDocumentMissing] = useState(false)
  const [permissionRecoveryBusy, setPermissionRecoveryBusy] = useState(false)
  const [permissionRecoveryNeeded, setPermissionRecoveryNeeded] = useState(false)
  const [reindexBusy, setReindexBusy] = useState(false)
  const [submissionRecoveryBusy, setSubmissionRecoveryBusy] = useState(false)
  const [submittedReindex, setSubmittedReindex] = useState<{
    baselineRevision: number
    generation: number
    timedOut: boolean
  }>()
  const nextSubmissionGenerationRef = useRef(0)
  const permissionRecoveryPendingRef = useRef(false)
  const reindexPendingRef = useRef(false)
  const previousTaskStateRef = useRef<string | undefined>(undefined)
  const acceptedTaskIdRef = useRef<string | undefined>(undefined)
  const invalidatedTerminalTaskRef = useRef<string | undefined>(undefined)
  const { mutateAsync: reindexDocument } = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocumentsBulkReindex.mutationOptions(),
  )
  const taskStatus = useDocumentTaskStatus({
    documentId,
    enabled,
    knowledgeSpaceId,
    minimumRevision: submittedReindex
      ? submittedReindex.baselineRevision + 1
      : documentActiveRevision,
    submissionDiscoveryGeneration: submittedReindex?.generation,
    submissionNeedsRecheck: Boolean(submittedReindex),
    submissionPending: Boolean(submittedReindex && !submittedReindex.timedOut),
  })
  const { latestTask, taskIsActive } = taskStatus
  const latestTaskRef = useRef(latestTask)
  latestTaskRef.current = latestTask
  const submittedTaskObserved = Boolean(
    latestTask &&
    submittedReindex &&
    latestTask.documentRevision > submittedReindex.baselineRevision,
  )
  const submissionPending = Boolean(submittedReindex && !submittedTaskObserved)

  const retryWritePermission = async () => {
    if (permissionRecoveryPendingRef.current) return false
    permissionRecoveryPendingRef.current = true
    setPermissionRecoveryBusy(true)
    try {
      const result = await refreshWorkspacePermissionKeysAfterMutationDenial()
      const refreshedPermissionKeys = result.data?.dataset?.default_permission_keys
      if (
        !result.error &&
        refreshedPermissionKeys &&
        hasPermission(refreshedPermissionKeys, DatasetACLPermission.Edit)
      ) {
        setWritePermissionRevoked(false)
        setPermissionRecoveryNeeded(false)
        return true
      }
      setPermissionRecoveryNeeded(true)
      return false
    } catch {
      setPermissionRecoveryNeeded(true)
      return false
    } finally {
      permissionRecoveryPendingRef.current = false
      setPermissionRecoveryBusy(false)
    }
  }

  useEffect(() => {
    if (!submittedReindex || submittedReindex.timedOut || submittedTaskObserved) return
    const timeout = window.setTimeout(
      () =>
        setSubmittedReindex((current) =>
          current?.baselineRevision === submittedReindex.baselineRevision
            ? { ...current, timedOut: true }
            : current,
        ),
      REINDEX_CONFIRMATION_TIMEOUT,
    )
    return () => window.clearTimeout(timeout)
  }, [submittedReindex, submittedTaskObserved])

  useEffect(() => {
    const previousState = previousTaskStateRef.current
    const previousWasActive =
      previousState === 'dispatch_pending' ||
      previousState === 'queued' ||
      previousState === 'running' ||
      previousState === 'retry_wait'
    previousTaskStateRef.current = latestTask?.state
    const taskMatchesAcceptedSubmission = Boolean(
      latestTask &&
      submittedReindex &&
      latestTask.documentRevision > submittedReindex.baselineRevision,
    )
    if (taskMatchesAcceptedSubmission && latestTask) acceptedTaskIdRef.current = latestTask.id
    const terminalTaskKey = latestTask ? `${latestTask.id}:${latestTask.updatedAt}` : undefined
    const shouldInvalidateTerminalTask = Boolean(
      latestTask &&
      !taskIsActive &&
      (previousWasActive ||
        acceptedTaskIdRef.current === latestTask.id ||
        taskMatchesAcceptedSubmission ||
        latestTask.documentRevision > documentActiveRevision) &&
      invalidatedTerminalTaskRef.current !== terminalTaskKey,
    )
    if (!shouldInvalidateTerminalTask || !terminalTaskKey) return
    invalidatedTerminalTaskRef.current = terminalTaskKey
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: documentQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: revisionsQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: chunksQueryKey,
      }),
      queryClient.invalidateQueries({ queryKey: taskStatus.queryKey }),
    ])
  }, [
    chunksQueryKey,
    documentActiveRevision,
    documentQueryKey,
    latestTask,
    queryClient,
    revisionsQueryKey,
    submittedReindex,
    taskIsActive,
    taskStatus.queryKey,
  ])

  const reindex = async (baselineRevision = documentActiveRevision) => {
    if (reindexPendingRef.current) return
    reindexPendingRef.current = true
    setReindexBusy(true)
    try {
      const result = await reindexDocument({
        body: { documentIds: [documentId] },
        params: { id: knowledgeSpaceId },
      })
      if (!result.items[0] || result.items[0].status === 'not_found') {
        setDocumentMissing(true)
        queryClient.removeQueries({ queryKey: documentQueryKey })
        await queryClient.invalidateQueries({
          queryKey: documentQueryKey,
        })
        toast.error(t(($) => $['newKnowledge.documentNotFoundTitle']))
        return
      }
      setSubmittedReindex({
        baselineRevision: Math.max(
          baselineRevision,
          documentActiveRevision,
          latestTaskRef.current?.documentRevision ?? documentActiveRevision,
        ),
        generation: ++nextSubmissionGenerationRef.current,
        timedOut: false,
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: documentQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: revisionsQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: chunksQueryKey,
        }),
        queryClient.invalidateQueries({ queryKey: taskStatus.queryKey }),
      ])
      toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
    } catch (error) {
      if (responseStatus(error) === 403) {
        setWritePermissionRevoked(true)
        await retryWritePermission()
      }
      toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
    } finally {
      reindexPendingRef.current = false
      setReindexBusy(false)
    }
  }

  return {
    ...taskStatus,
    documentMissing,
    permissionRecoveryBusy,
    permissionRecoveryNeeded,
    reindex,
    reindexBusy,
    recheckTimedOutSubmission: async () => {
      if (submissionRecoveryBusy) return
      setSubmissionRecoveryBusy(true)
      try {
        await taskStatus.refetch()
      } finally {
        setSubmissionRecoveryBusy(false)
      }
    },
    retryTimedOutSubmission: async () => {
      if (submissionRecoveryBusy) return
      const baselineRevision = submittedReindex?.baselineRevision ?? documentActiveRevision
      setSubmittedReindex(undefined)
      await reindex(baselineRevision)
    },
    retryWritePermission,
    submissionRecoveryBusy,
    submissionPending,
    submissionTimedOut: Boolean(submittedReindex?.timedOut && !submittedTaskObserved),
    writePermissionRevoked,
  }
}
