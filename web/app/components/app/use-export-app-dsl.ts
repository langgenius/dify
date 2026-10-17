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
import { consoleQuery } from '@/service/console'
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
}

type ExportWorkflowAppDslInput = Pick<ExportAppDslInput, 'appId' | 'appName' | 'feedback'>

type ExportAppDslResult = { status: 'downloaded' } | { status: 'failed' }

export type ExportWorkflowAppDslResult =
  | ExportAppDslResult
  | {
      status: 'confirmation-required'
      secretEnvList: EnvironmentVariableItemResponse[]
    }

async function getSecretEnvironmentVariables(queryClient: QueryClient, appId: string) {
  const { items } = await queryClient.query(
    consoleQuery.apps.byAppId.workflows.draft.environmentVariables.get.queryOptions({
      input: { params: { app_id: appId } },
      context: { silent: true },
      staleTime: 0,
    }),
  )
  return items.filter((environmentVariable) => environmentVariable.value_type === 'secret')
}

export async function exportAppDslFile(
  queryClient: QueryClient,
  { appId, appName, includeSecret = false, workflowId, versionId, format }: ExportAppDslInput,
) {
  const response = await queryClient.query(
    consoleQuery.apps.byAppId.export.get.queryOptions({
      input: {
        params: { app_id: appId },
        query: {
          include_secret: includeSecret,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          ...(versionId ? { version_id: versionId } : {}),
          ...(format && { format }),
        },
      },
      context: { silent: true },
      staleTime: 0,
      gcTime: 0,
    }),
  )

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
    packageSuccess: tApp(($) => $.exportAppSuccess),
    packageError: tApp(($) => $.exportAppFailed),
  }
}

async function downloadAppDsl(
  queryClient: QueryClient,
  input: ExportAppDslInput,
  messages: ReturnType<typeof useExportAppDslMessages>,
): Promise<ExportAppDslResult> {
  const download = exportAppDslFile(queryClient, input)
  if (input.feedback === 'dialog') {
    await download
  } else {
    await toast.promise(download, {
      loading: { title: messages.loading },
      success: (format) => ({
        title: format === 'ifpkg' ? messages.packageSuccess : messages.success,
        timeout: 3000,
      }),
      error: (error) => ({
        title: input.format === 'yaml' ? messages.error : messages.packageError,
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
    errorMessage: error ? (getErrorMessage(error) ?? messages.packageError) : undefined,
    reset,
  }
}

/** Checks Workflow and Advanced Chat secrets before exporting their DSL. */
export function useExportWorkflowAppDsl() {
  const messages = useExportAppDslMessages()
  const queryClient = useQueryClient()
  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: async (input: ExportWorkflowAppDslInput): Promise<ExportWorkflowAppDslResult> => {
      let secretEnvList: EnvironmentVariableItemResponse[]
      try {
        secretEnvList = await getSecretEnvironmentVariables(queryClient, input.appId)
      } catch (error) {
        if (input.feedback !== 'dialog') {
          toast.error(messages.packageError, { description: getErrorMessage(error) })
        }
        throw error
      }

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
    errorMessage: error ? (getErrorMessage(error) ?? messages.packageError) : undefined,
    reset,
  }
}
