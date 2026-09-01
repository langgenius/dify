'use client'

import { toast } from '@langgenius/dify-ui/toast'
import { skipToken } from '@tanstack/query-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { responseStatus } from '../detail/model'
import { documentTaskIsActive, useDocumentTaskStatus } from './use-task-status'

const REINDEX_STORAGE_PREFIX = 'dify-new-rag-reindex'
const revisionsQueryKey =
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.get.key()

type SubmittedReindex = {
  baselineRevision: number
  taskId: string
}

function compilationJobIsTerminal(job: { run_state?: string | null; stage?: string | null }) {
  return (
    job.run_state === 'succeeded' ||
    job.run_state === 'completed' ||
    job.run_state === 'failed' ||
    job.run_state === 'canceled' ||
    job.run_state === 'superseded' ||
    job.stage === 'published' ||
    job.stage === 'failed' ||
    job.stage === 'canceled'
  )
}

function submittedReindexStorageKey(knowledgeSpaceId: string, documentId: string) {
  return `${REINDEX_STORAGE_PREFIX}:${knowledgeSpaceId}:${documentId}`
}

function readSubmittedReindex(storageKey: string): SubmittedReindex | undefined {
  try {
    const value = JSON.parse(globalThis.sessionStorage.getItem(storageKey) ?? 'null')
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.baselineRevision !== 'number' ||
      typeof value.taskId !== 'string'
    )
      return
    return {
      baselineRevision: value.baselineRevision,
      taskId: value.taskId,
    }
  } catch {
    // Ignore unavailable or invalid recovery data.
  }
}

export function useDocumentReindex({
  beforeReindex,
  chunksQueryKey,
  documentActiveRevision,
  documentId,
  documentQueryKey,
  enabled,
  knowledgeSpaceId,
  refreshWritePermission,
}: {
  beforeReindex: () => Promise<boolean>
  chunksQueryKey: readonly unknown[]
  documentActiveRevision: number
  documentId: string
  documentQueryKey: readonly unknown[]
  enabled: boolean
  knowledgeSpaceId: string
  refreshWritePermission: () => Promise<boolean>
}) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const storageKey = submittedReindexStorageKey(knowledgeSpaceId, documentId)
  const [writePermissionRevoked, setWritePermissionRevoked] = useState(false)
  const [documentMissing, setDocumentMissing] = useState(false)
  const [cancelReindexBusy, setCancelReindexBusy] = useState(false)
  const [permissionRecoveryBusy, setPermissionRecoveryBusy] = useState(false)
  const [permissionRecoveryNeeded, setPermissionRecoveryNeeded] = useState(false)
  const [reindexBusy, setReindexBusy] = useState(false)
  const [submittedReindex, setSubmittedReindex] = useState<SubmittedReindex | undefined>(() =>
    readSubmittedReindex(storageKey),
  )
  const permissionRecoveryPendingRef = useRef(false)
  const reindexPendingRef = useRef(false)
  const previousTaskStateRef = useRef<string | undefined>(undefined)
  const acceptedTaskIdRef = useRef<string | undefined>(undefined)
  const invalidatedTerminalTaskRef = useRef<string | undefined>(undefined)
  const { mutateAsync: reindexDocument } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
  )
  const { mutateAsync: cancelTask } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.cancel.post.mutationOptions(),
  )
  const submittedJobQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.jobs.byJobId.get.queryOptions({
      input: submittedReindex
        ? {
            params: {
              control_space_id: knowledgeSpaceId,
              job_id: submittedReindex.taskId,
            },
          }
        : skipToken,
      refetchInterval: (query) =>
        query.state.data && !compilationJobIsTerminal(query.state.data) ? 2000 : false,
      retry: (failureCount, error) => responseStatus(error) !== 403 && failureCount < 2,
    }),
  )
  const taskStatus = useDocumentTaskStatus({
    acceptedTaskId: submittedReindex?.taskId,
    documentId,
    enabled,
    knowledgeSpaceId,
    minimumRevision: submittedReindex
      ? submittedReindex.baselineRevision + 1
      : documentActiveRevision,
    submissionNeedsRecheck: Boolean(submittedReindex),
    submissionPending: Boolean(submittedReindex),
  })
  const { latestTask, taskIsActive } = taskStatus
  const latestTaskRef = useRef(latestTask)
  useEffect(() => {
    latestTaskRef.current = latestTask
  }, [latestTask])
  const submittedTaskObserved = Boolean(
    latestTask && submittedReindex && latestTask.id === submittedReindex.taskId,
  )
  const submittedJobIsTerminal = Boolean(
    submittedJobQuery.data && compilationJobIsTerminal(submittedJobQuery.data),
  )
  const submittedJobMissing = responseStatus(submittedJobQuery.error) === 404
  const submissionPending = Boolean(
    submittedReindex && !submittedTaskObserved && !submittedJobIsTerminal && !submittedJobMissing,
  )

  const retryWritePermission = async () => {
    if (permissionRecoveryPendingRef.current) return false
    permissionRecoveryPendingRef.current = true
    setPermissionRecoveryBusy(true)
    try {
      if (await refreshWritePermission()) {
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
    try {
      const submittedTaskIsTerminal = Boolean(
        submittedReindex &&
        latestTask?.id === submittedReindex.taskId &&
        !documentTaskIsActive(latestTask.state),
      )
      if (submittedReindex && !submittedTaskIsTerminal)
        globalThis.sessionStorage.setItem(storageKey, JSON.stringify(submittedReindex))
      else globalThis.sessionStorage.removeItem(storageKey)
    } catch {
      // Re-index recovery remains available for the current page when browser storage is unavailable.
    }
  }, [latestTask, storageKey, submittedReindex])

  useEffect(() => {
    const previousState = previousTaskStateRef.current
    const previousWasActive =
      previousState === 'dispatch_pending' ||
      previousState === 'queued' ||
      previousState === 'running' ||
      previousState === 'retry_wait'
    previousTaskStateRef.current = latestTask?.state
    const taskMatchesAcceptedSubmission = Boolean(
      latestTask && submittedReindex && latestTask.id === submittedReindex.taskId,
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
    submittedReindex,
    taskIsActive,
    taskStatus.queryKey,
  ])

  useEffect(() => {
    if (!submittedReindex || (!submittedJobIsTerminal && !submittedJobMissing)) return
    if (submittedJobIsTerminal) {
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
    }
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Reconcile the persisted submission with its authoritative job endpoint.
    setSubmittedReindex(undefined)
  }, [
    chunksQueryKey,
    documentQueryKey,
    queryClient,
    submittedJobIsTerminal,
    submittedJobMissing,
    submittedReindex,
    taskStatus.queryKey,
  ])

  const reindex = async (baselineRevision = documentActiveRevision) => {
    if (reindexPendingRef.current) return
    reindexPendingRef.current = true
    setReindexBusy(true)
    try {
      if (!(await beforeReindex())) return
      const result = await reindexDocument({
        body: { documentIds: [documentId] },
        params: { control_space_id: knowledgeSpaceId },
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
      const taskId =
        typeof result.items[0].compilation_job?.id === 'string'
          ? result.items[0].compilation_job.id
          : undefined
      if (!taskId) throw new Error('Re-index response did not include a compilation task id')
      setSubmittedReindex({
        baselineRevision: Math.max(
          baselineRevision,
          documentActiveRevision,
          latestTaskRef.current?.documentRevision ?? documentActiveRevision,
        ),
        taskId,
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
    cancelReindex: async () => {
      const task = latestTaskRef.current
      const taskId = submittedReindex?.taskId ?? task?.id
      const submittedTaskIsPending = Boolean(submittedReindex)
      if (
        !taskId ||
        (!submittedTaskIsPending &&
          (!task || !documentTaskIsActive(task.state) || task.canCancel === false))
      )
        return false
      setCancelReindexBusy(true)
      try {
        await cancelTask({
          params: {
            control_space_id: knowledgeSpaceId,
            task_id: taskId,
            task_kind: task?.id === taskId ? (task.taskKind ?? 'document') : 'document',
          },
        })
        setSubmittedReindex(undefined)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: documentQueryKey }),
          queryClient.invalidateQueries({ queryKey: revisionsQueryKey }),
          queryClient.invalidateQueries({ queryKey: chunksQueryKey }),
          queryClient.invalidateQueries({ queryKey: taskStatus.queryKey }),
        ])
        return true
      } catch (error) {
        if (responseStatus(error) === 403) {
          setWritePermissionRevoked(true)
          await retryWritePermission()
        }
        toast.error(t(($) => $['newKnowledge.taskActionFailed']))
        return false
      } finally {
        setCancelReindexBusy(false)
      }
    },
    cancelReindexBusy,
    documentMissing,
    permissionRecoveryBusy,
    permissionRecoveryNeeded,
    reindex,
    reindexBusy,
    retryWritePermission,
    submissionPending,
    writePermissionRevoked,
  }
}
