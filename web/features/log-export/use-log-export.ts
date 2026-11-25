import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DefaultError, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export type LogExportPhase = 'checking' | 'exporting' | 'retry-status' | 'selecting'
export type LogExportCreateErrorKind = 'limit-reached' | 'failed' | null

export const logExportRequest = { context: { silent: true } } as const

function isActive(status: ConversationLogExportStatusResponse['status'] | undefined) {
  return status === 'pending' || status === 'processing'
}

export function useLogExport<
  Latest extends { task: ConversationLogExportStatusResponse | null },
  Preview,
  Created extends ConversationLogExportStatusResponse,
  Input,
>({
  enabled,
  latestOptions,
  previewOptions,
  createOptions,
  statusOptions,
}: {
  enabled: boolean
  latestOptions: UseQueryOptions<Latest>
  previewOptions: UseQueryOptions<Preview>
  createOptions: UseMutationOptions<Created, DefaultError, Input>
  statusOptions: (
    taskId: string | undefined,
  ) => UseQueryOptions<ConversationLogExportStatusResponse>
}) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'filters' | 'progress' | null>(null)
  const [progressTask, setProgressTask] = useState<ConversationLogExportStatusResponse>()
  const [taskIdAtSubmit, setTaskIdAtSubmit] = useState<string>()
  const openProgress = (task: ConversationLogExportStatusResponse) => {
    setProgressTask(task)
    setDialog('progress')
  }
  const progress = useQuery({
    ...statusOptions(progressTask?.task_id),
    enabled: enabled && dialog === 'progress',
    placeholderData: progressTask,
    staleTime: 0,
    retry: 1,
    refetchInterval: ({ state }) =>
      state.status !== 'error' && isActive(state.data?.status) ? 1500 : false,
  })
  const latest = useQuery({
    ...latestOptions,
    enabled: enabled && dialog === 'filters',
    staleTime: 0,
    retry: 1,
    refetchInterval: ({ state }) =>
      state.status !== 'error' && isActive(state.data?.task?.status) ? 1500 : false,
  })
  const { error, isPending, mutate, reset } = useMutation({
    ...createOptions,
    onSettled: async (...args) => {
      await createOptions.onSettled?.(...args)
      const [created] = args
      await queryClient.invalidateQueries({
        queryKey: latestOptions.queryKey,
        exact: true,
        refetchType: created ? 'none' : 'active',
      })
      if (created) openProgress(created)
    },
  })
  const latestData = latest.isError ? undefined : latest.data
  const task = latestData?.task
  const taskInProgress = isActive(task?.status)
  // An export can finish before the client learns that its create response was lost.
  const recoveredTask = task != null && (taskInProgress || task.task_id !== taskIdAtSubmit)
  useEffect(() => {
    if (error && recoveredTask) reset()
  }, [error, recoveredTask, reset])
  let createErrorKind: LogExportCreateErrorKind = null
  if (error && !recoveredTask) {
    createErrorKind =
      error instanceof ORPCError && error.code === 'log_export_limit_reached'
        ? 'limit-reached'
        : 'failed'
  }

  const phase: LogExportPhase =
    isPending || taskInProgress
      ? 'exporting'
      : latest.isPending || latest.fetchStatus !== 'idle'
        ? 'checking'
        : latest.isError
          ? 'retry-status'
          : 'selecting'
  const preview = useQuery({
    ...previewOptions,
    enabled: enabled && dialog === 'filters' && phase === 'selecting',
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
  return {
    latest: latestData,
    preview: preview.isError ? undefined : preview.data,
    create: (input: Input) => {
      setTaskIdAtSubmit(task?.task_id)
      mutate(input)
    },
    onViewProgress: task && taskInProgress ? () => openProgress(task) : undefined,
    dialogState: {
      open: dialog === 'filters',
      onOpenChange: (open: boolean) => {
        if (open) reset()
        setDialog(open ? 'filters' : null)
      },
      phase,
      submitting: isPending,
      createErrorKind,
      pendingPreview:
        preview.isPending || preview.isPlaceholderData || preview.fetchStatus !== 'idle',
      onRetryStatus: () => {
        void latest.refetch()
      },
    },
    progressState: progressTask && {
      open: enabled && dialog === 'progress',
      taskId: progressTask.task_id,
      task: progress.data,
      statusError: progress.isError,
      onClose: () => setDialog(null),
      onRetry: () => {
        void progress.refetch()
      },
    },
  }
}
