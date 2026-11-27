'use client'

import type {
  EnvironmentVariableItemResponse,
  GetAppsByAppIdExportData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import { rethrowHandled } from '@/service/handled-error'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'

type ExportAppDslInput = {
  appId: string
  appName: string
  includeSecret?: boolean
  versionId?: string
  format?: NonNullable<GetAppsByAppIdExportData['query']>['format']
  workflowId?: string
  feedback?: 'toast' | 'dialog'
  signal?: AbortSignal
}

type ExportWorkflowAppDslInput = Pick<
  ExportAppDslInput,
  'appId' | 'appName' | 'feedback' | 'signal'
>

type ExportAppDslResult = { status: 'downloaded' } | { status: 'failed' } | { status: 'cancelled' }

export type ExportWorkflowAppDslResult =
  | ExportAppDslResult
  | {
      status: 'confirmation-required'
      secretEnvList: EnvironmentVariableItemResponse[]
    }

async function getSecretEnvironmentVariables(
  queryClient: QueryClient,
  appId: string,
  signal?: AbortSignal,
) {
  const input = { params: { app_id: appId } }
  const { items } = signal
    ? await consoleClient.apps.byAppId.workflows.draft.environmentVariables.get(input, {
        signal,
      })
    : // The export action reports a failed read with its own text.
      await queryClient
        .query(
          consoleQuery.apps.byAppId.workflows.draft.environmentVariables.get.queryOptions({
            input,
          }),
        )
        .catch(rethrowHandled)
  return items.filter((environmentVariable) => environmentVariable.value_type === 'secret')
}

export async function exportAppDslFile(
  queryClient: QueryClient,
  {
    appId,
    appName,
    includeSecret = false,
    workflowId,
    versionId,
    format,
    signal,
  }: ExportAppDslInput,
) {
  signal?.throwIfAborted()
  const input = {
    params: { app_id: appId },
    query: {
      include_secret: includeSecret,
      ...(workflowId ? { workflow_id: workflowId } : {}),
      ...(versionId ? { version_id: versionId } : {}),
      ...(format && { format }),
    },
  }
  const response = signal
    ? await consoleClient.apps.byAppId.export.get(input, { signal })
    : // The export action reports a failed read with its own text.
      await queryClient
        .query(consoleQuery.apps.byAppId.export.get.queryOptions({ input }))
        .catch(rethrowHandled)

  signal?.throwIfAborted()
  if (response instanceof Blob) {
    const name = response instanceof File ? response.name : undefined
    downloadBlob({
      data: response,
      fileName: name && name !== 'blob' ? name : `${appName}.ifpkg`,
    })
    return 'ifpkg' as const
  }

  downloadBlob({
    data: new Blob([response.data], { type: 'application/yaml' }),
    fileName: `${appName}.yml`,
  })
  return 'yaml' as const
}

function useExportAppDslMessages() {
  const { t: tApp } = useTranslation(['app'])
  const { t: tCommon } = useTranslation(['common'])

  return {
    loading: tCommon(($) => $['operation.exporting']),
    success: tCommon(($) => $['operation.downloadSuccess']),
    error: tApp(($) => $.exportFailed),
    packageSuccess: tApp(($) => $.ifpkgDownloaded),
  }
}

async function downloadAppDsl(
  queryClient: QueryClient,
  input: ExportAppDslInput,
  messages: ReturnType<typeof useExportAppDslMessages>,
): Promise<ExportAppDslResult> {
  const download = exportAppDslFile(queryClient, input)
  if (input.feedback === 'dialog') {
    try {
      await download
    } catch (error) {
      if (input.signal?.aborted) return { status: 'cancelled' }
      throw error
    }
  } else {
    await toast.promise(download, {
      loading: { title: messages.loading },
      success: (format) => ({
        title: format === 'ifpkg' ? messages.packageSuccess : messages.success,
        timeout: 3000,
      }),
      error: (error) => ({
        title: messages.error,
        description: getErrorMessage(error),
      }),
    })
  }
  return { status: 'downloaded' }
}

/** Exports Agent, Chat, and Completion apps without reading a workflow draft. */
export function useExportAppDsl() {
  const messages = useExportAppDslMessages()
  const queryClient = useQueryClient()
  const { mutateAsync, isPending, error, reset } = useMutation({
    meta: { errorToast: false },
    mutationFn: (input: ExportAppDslInput) => downloadAppDsl(queryClient, input, messages),
  })

  const exportAppDsl = useCallback(
    async (input: ExportAppDslInput): Promise<ExportAppDslResult> => {
      try {
        return await mutateAsync(input)
      } catch {
        return { status: 'failed' }
      }
    },
    [mutateAsync],
  )

  return {
    exportAppDsl,
    isExporting: isPending,
    errorMessage: error ? (getErrorMessage(error) ?? messages.error) : undefined,
    reset,
  }
}

/** Checks Workflow and Advanced Chat secrets before exporting their DSL. */
export function useExportWorkflowAppDsl() {
  const messages = useExportAppDslMessages()
  const queryClient = useQueryClient()
  const { mutateAsync, isPending, error, reset } = useMutation({
    meta: { errorToast: false },
    mutationFn: async (input: ExportWorkflowAppDslInput): Promise<ExportWorkflowAppDslResult> => {
      if (input.signal?.aborted) return { status: 'cancelled' }
      let secretEnvList: EnvironmentVariableItemResponse[]
      try {
        secretEnvList = await getSecretEnvironmentVariables(queryClient, input.appId, input.signal)
      } catch (error) {
        if (input.signal?.aborted) return { status: 'cancelled' }
        if (input.feedback !== 'dialog') {
          toast.error(messages.error, { description: getErrorMessage(error) })
        }
        throw error
      }

      if (input.signal?.aborted) return { status: 'cancelled' }
      if (secretEnvList.length > 0) {
        return { status: 'confirmation-required', secretEnvList }
      }
      return downloadAppDsl(queryClient, input, messages)
    },
  })

  const exportWorkflowAppDsl = useCallback(
    async (input: ExportWorkflowAppDslInput): Promise<ExportWorkflowAppDslResult> => {
      try {
        return await mutateAsync(input)
      } catch {
        return { status: 'failed' }
      }
    },
    [mutateAsync],
  )

  return {
    exportWorkflowAppDsl,
    isExporting: isPending,
    errorMessage: error ? (getErrorMessage(error) ?? messages.error) : undefined,
    reset,
  }
}
