'use client'

import type {
  EnvironmentVariableItemResponse,
  GetAppsByAppIdExportData,
} from '@dify/contracts/api/console/apps/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'

type ExportAppDslInput = {
  appId: string
  appName: string
  includeSecret?: boolean
  versionId?: string
  format?: NonNullable<GetAppsByAppIdExportData['query']>['format']
  workflowId?: string
}

type ExportWorkflowAppDslInput = Pick<ExportAppDslInput, 'appId' | 'appName'>

type ExportAppDslResult = { status: 'downloaded' } | { status: 'failed' }

export type ExportWorkflowAppDslResult =
  | ExportAppDslResult
  | {
      status: 'confirmation-required'
      secretEnvList: EnvironmentVariableItemResponse[]
    }

async function getSecretEnvironmentVariables(appId: string) {
  const { items } = await consoleClient.apps.byAppId.workflows.draft.environmentVariables.get({
    params: { app_id: appId },
  })
  return items.filter((environmentVariable) => environmentVariable.value_type === 'secret')
}

export async function exportAppDslFile({
  appId,
  appName,
  includeSecret = false,
  workflowId,
  versionId,
  format,
}: ExportAppDslInput) {
  const response = await consoleClient.apps.byAppId.export.get({
    params: { app_id: appId },
    query: {
      include_secret: includeSecret,
      ...(workflowId ? { workflow_id: workflowId } : {}),
      ...(versionId ? { version_id: versionId } : {}),
      ...(format && { format }),
    },
  })

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

/** Exports Agent, Chat, and Completion apps without reading a workflow draft. */
export function useExportAppDsl() {
  const messages = useExportAppDslMessages()
  const { mutateAsync, isPending } = useMutation({
    mutationFn: exportAppDslFile,
    onMutate: (input) => {
      let resolve!: (format: 'yaml' | 'ifpkg') => void
      let reject!: (error: unknown) => void
      const feedback = new Promise<'yaml' | 'ifpkg'>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      // Mutation callbacks settle the same progress toast, including after unmount.
      void toast
        .promise(feedback, {
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
        .catch(() => {
          // The promise toast presents the rejection; mutateAsync still rejects separately.
        })
      return { resolve, reject }
    },
    onSuccess: (format, _input, feedback) => feedback?.resolve(format),
    onError: (error, _input, feedback) => feedback?.reject(error),
  })

  const exportAppDsl = useCallback(
    async (input: ExportAppDslInput): Promise<ExportAppDslResult> => {
      try {
        await mutateAsync(input)
        return { status: 'downloaded' }
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
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const { mutateAsync: checkSecrets, isPending } = useMutation({
    mutationFn: (input: ExportWorkflowAppDslInput) => getSecretEnvironmentVariables(input.appId),
    onError: (error) => {
      toast.error(messages.packageError, { description: getErrorMessage(error) })
    },
  })

  const exportWorkflowAppDsl = useCallback(
    async (input: ExportWorkflowAppDslInput): Promise<ExportWorkflowAppDslResult> => {
      let secretEnvList: EnvironmentVariableItemResponse[]
      try {
        secretEnvList = await checkSecrets(input)
      } catch {
        return { status: 'failed' }
      }
      if (secretEnvList.length > 0) return { status: 'confirmation-required', secretEnvList }
      return exportAppDsl(input)
    },
    [checkSecrets, exportAppDsl],
  )

  return { exportWorkflowAppDsl, isExporting: isPending || isExporting }
}
