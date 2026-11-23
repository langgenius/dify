import type { DefaultError, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type LogExportPhase = 'checking' | 'exporting' | 'retry-status' | 'selecting'

export const logExportRequest = { context: { silent: true } } as const

export function useLogExport<
  Latest extends { task?: { status: string } | null },
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
  const create = useMutation({
    ...createOptions,
    onSuccess: async (...args) => {
      await createOptions.onSuccess?.(...args)
      await queryClient.invalidateQueries({ queryKey: latestOptions.queryKey })
    },
  })
  const latestData = latest.isError ? undefined : latest.data
  const status = latestData?.task?.status
  const taskInProgress = status === 'pending' || status === 'processing'
  const phase: LogExportPhase =
    create.isPending || taskInProgress
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
    create: create.mutate,
    reset: create.reset,
    dialogState: {
      phase,
      submitting: create.isPending,
      createFailed: create.isError,
      pendingPreview:
        preview.isPending || preview.isPlaceholderData || preview.fetchStatus !== 'idle',
      onRetryStatus: () => {
        void latest.refetch()
      },
    },
  }
}
