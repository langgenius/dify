import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DefaultError, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export type LogExportPhase = 'checking' | 'exporting' | 'retry-status' | 'selecting'
export type LogExportCancellation = {
  pending: boolean
  failed: boolean
  onCancel: () => void
}
export type LogExportEmailNotification = {
  state: NonNullable<ConversationLogExportStatusResponse['email_notification']>
  pending: boolean
  updateFailed: boolean
  onChange: (enabled: boolean) => void
}

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
  cancelExport,
  updateEmailNotification,
}: {
  enabled: boolean
  latestOptions: UseQueryOptions<Latest>
  previewOptions: UseQueryOptions<Preview>
  createOptions: UseMutationOptions<Created, DefaultError, Input>
  statusOptions: (
    taskId: string | undefined,
  ) => UseQueryOptions<ConversationLogExportStatusResponse>
  cancelExport: (taskId: string) => Promise<ConversationLogExportStatusResponse>
  updateEmailNotification: (taskId: string, enabled: boolean) => Promise<unknown>
}) {
  const { t } = useTranslation(['appLog'])
  const queryClient = useQueryClient()
  const { data: isEmailSetup } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ is_email_setup }) => is_email_setup,
  })
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
      state.status !== 'error' &&
      (isActive(state.data?.status) ||
        (state.data?.status === 'ready' && state.data.email_notification === 'waiting'))
        ? 1500
        : false,
  })
  const cancelMutation = useMutation({
    mutationFn: cancelExport,
    onSuccess: (_task, taskId) => {
      if (progressTask?.task_id === taskId)
        setDialog((current) => (current === 'progress' ? null : current))
      toast.success(t(($) => $['export.canceled'], { ns: 'appLog' }))
    },
    onSettled: async (canceledTask, _error, taskId) => {
      const taskQuery = { queryKey: statusOptions(taskId).queryKey, exact: true }
      if (canceledTask) {
        await queryClient.cancelQueries(taskQuery)
        queryClient.setQueryData(taskQuery.queryKey, canceledTask)
      }
      await Promise.all([
        canceledTask ? undefined : queryClient.invalidateQueries(taskQuery),
        queryClient.invalidateQueries({ queryKey: latestOptions.queryKey, exact: true }),
      ])
    },
  })
  const emailMutation = useMutation({
    mutationFn: ({ taskId, enabled }: { taskId: string; enabled: boolean }) =>
      updateEmailNotification(taskId, enabled),
    onSettled: async (_result, _error, { taskId }) => {
      await queryClient.invalidateQueries({ queryKey: statusOptions(taskId).queryKey, exact: true })
    },
  })
  const emailState = progress.data?.email_notification
  const emailStatusLoading = !progress.data || progress.isPlaceholderData
  const emailUpdate = emailMutation.variables
  const emailUpdateForTask = emailUpdate?.taskId === progressTask?.task_id ? emailUpdate : undefined
  // A failed response can still leave the requested preference in place. A ready
  // export that is still waiting can be queued by retrying the request.
  const emailUpdateFailed =
    emailMutation.isError &&
    emailUpdateForTask != null &&
    emailState !== 'queued' &&
    (emailUpdateForTask.enabled
      ? emailState === 'off' || progress.data?.status === 'ready'
      : emailState === 'waiting')
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
  const cancelForTask = cancelMutation.variables === progressTask?.task_id
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
      createFailed: error != null && !recoveredTask,
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
      cancellation:
        !progress.isError && progress.data?.status === 'pending'
          ? ({
              pending: cancelForTask && cancelMutation.isPending,
              failed: cancelForTask && cancelMutation.isError,
              onCancel: () => cancelMutation.mutate(progressTask.task_id),
            } satisfies LogExportCancellation)
          : undefined,
      emailNotification:
        isEmailSetup && (emailStatusLoading || emailState != null)
          ? ({
              state: emailState ?? 'off',
              pending: emailStatusLoading || (!!emailUpdateForTask && emailMutation.isPending),
              updateFailed: emailUpdateFailed,
              onChange: (enabled: boolean) =>
                emailMutation.mutate({ taskId: progressTask.task_id, enabled }),
            } satisfies LogExportEmailNotification)
          : undefined,
      onClose: () => setDialog(null),
      onRetry: () => {
        void progress.refetch()
      },
    },
  }
}
