'use client'

import type { WorkflowDraftEnvironmentVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient } from '@/service/client'
import { downloadBlob } from '@/utils/download'

type ExportAppDslInput = {
  appId: string
  appName: string
  includeSecret?: boolean
}

type ExportWorkflowAppDslInput = Pick<ExportAppDslInput, 'appId' | 'appName'>

type ExportAppDslResult = { status: 'downloaded' } | { status: 'failed' }

type ExportAppDslMessages = {
  loading: string
  success: string
  error: string
}

export type ExportWorkflowAppDslResult =
  | ExportAppDslResult
  | {
      status: 'confirmation-required'
      secretEnvList: WorkflowDraftEnvironmentVariableResponse[]
    }

async function getSecretEnvironmentVariables(appId: string) {
  const { items } = await consoleClient.apps.byAppId.workflows.draft.environmentVariables.get(
    { params: { app_id: appId } },
    { context: { silent: true } },
  )
  return items.filter((environmentVariable) => environmentVariable.value_type === 'secret')
}

async function exportAppDslFile({ appId, appName, includeSecret = false }: ExportAppDslInput) {
  const { data } = await consoleClient.apps.byAppId.export.get(
    {
      params: { app_id: appId },
      query: { include_secret: includeSecret },
    },
    { context: { silent: true } },
  )

  downloadBlob({
    data: new Blob([data], { type: 'application/yaml' }),
    fileName: `${appName}.yml`,
  })
}

async function downloadAppDsl(input: ExportAppDslInput, messages: ExportAppDslMessages) {
  await toast.promise(exportAppDslFile(input), {
    loading: {
      title: messages.loading,
    },
    success: {
      title: messages.success,
      timeout: 3000,
    },
    error: {
      title: messages.error,
    },
  })

  return { status: 'downloaded' } as const
}

function useExportAppDslMessages() {
  const { t: tApp } = useTranslation('app')
  const { t: tCommon } = useTranslation('common')

  return {
    loading: tCommon(($) => $['operation.exporting']),
    success: tCommon(($) => $['operation.downloadSuccess']),
    error: tApp(($) => $.exportFailed),
  }
}

/** Exports Agent, Chat, and Completion apps without reading a workflow draft. */
export function useExportAppDsl() {
  const messages = useExportAppDslMessages()
  const { mutateAsync, isPending } = useMutation({
    mutationFn: (input: ExportAppDslInput): Promise<ExportAppDslResult> =>
      downloadAppDsl(input, messages),
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
  }
}

/** Checks Workflow and Advanced Chat secrets before exporting their DSL. */
export function useExportWorkflowAppDsl() {
  const messages = useExportAppDslMessages()
  const { mutateAsync, isPending } = useMutation({
    mutationFn: async (input: ExportWorkflowAppDslInput): Promise<ExportWorkflowAppDslResult> => {
      let secretEnvList: WorkflowDraftEnvironmentVariableResponse[]
      try {
        secretEnvList = await getSecretEnvironmentVariables(input.appId)
      } catch (error) {
        toast.error(messages.error)
        throw error
      }

      if (secretEnvList.length > 0)
        return {
          status: 'confirmation-required',
          secretEnvList,
        }

      return downloadAppDsl(input, messages)
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
  }
}
