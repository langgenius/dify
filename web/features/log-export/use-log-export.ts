import type { DefaultError, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export type LogExportPhase = 'checking' | 'exporting' | 'retry-status' | 'selecting'
export type LogExportCreateErrorKind = 'limit-reached' | 'failed' | null

export const logExportRequest = { context: { silent: true } } as const

export function useLogExport<
  Latest extends { task?: { status: string; task_id: string } | null },
  Preview,
  Created,
  Input,
>({
  enabled,
  latestOptions,
  previewOptions,
  createOptions,
}: {
  enabled: boolean
  latestOptions: UseQueryOptions<Latest>
  previewOptions: UseQueryOptions<Preview>
  createOptions: UseMutationOptions<Created, DefaultError, Input>
}) {
  const queryClient = useQueryClient()
  const [taskIdAtSubmit, setTaskIdAtSubmit] = useState<string>()
  const latest = useQuery({
    ...latestOptions,
    enabled,
    staleTime: 0,
    retry: 1,
    refetchInterval: ({ state }) => {
      const status = state.data?.task?.status
      return state.status !== 'error' && (status === 'pending' || status === 'processing')
        ? 1500
        : false
    },
  })
  const { error, isPending, mutate, reset } = useMutation({
    ...createOptions,
    onSettled: async (...args) => {
      await createOptions.onSettled?.(...args)
      await queryClient.invalidateQueries({ queryKey: latestOptions.queryKey, exact: true })
    },
  })
  const latestData = latest.isError ? undefined : latest.data
  const task = latestData?.task
  const taskInProgress = task?.status === 'pending' || task?.status === 'processing'
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
    enabled: enabled && phase === 'selecting',
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
    reset,
    dialogState: {
      phase,
      submitting: isPending,
      createErrorKind,
      pendingPreview:
        preview.isPending || preview.isPlaceholderData || preview.fetchStatus !== 'idle',
      onRetryStatus: () => {
        void latest.refetch()
      },
    },
  }
}
