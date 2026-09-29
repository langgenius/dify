import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { ExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getAppTransferErrorMessage } from '@/app/components/app/transfer-error'
import { exportAppDslFile } from '@/app/components/app/use-export-app-dsl'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleClient, consoleQuery } from '@/service/console'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const useDSLBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const { t } = useTranslation(['app'])
  const { eventEmitter } = useEventEmitterContextContext()

  const appId = useStore((state) => state.appId)
  const { data: appName } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (app) => app.name,
    }),
  )
  const workflowStore = useWorkflowStore()

  const { mutateAsync: exportWorkflow, isPending: isExporting } = useMutation({
    mutationFn: async ({
      appId,
      appName,
      include,
      workflowId,
    }: {
      appId: string
      appName: string
      include: boolean
      workflowId?: string
    }) => {
      if (!workflowId) {
        let syncFailed = false
        await doSyncWorkflowDraft(undefined, {
          onError: () => {
            syncFailed = true
          },
        })
        if (syncFailed) {
          toast.error(t(($) => $.exportAppFailed, { ns: 'app' }))
          return false
        }
      }

      await exportAppDslFile({
        appId,
        appName,
        includeSecret: include,
        workflowId,
      })
      return true
    },
  })

  const handleExportDSL = useCallback(
    async (include = false, workflowId?: string): Promise<boolean> => {
      if (isExporting || !appId || appName === undefined) return false

      try {
        return await exportWorkflow({ appId, appName, include, workflowId })
      } catch (error) {
        toast.error(
          t(($) => $.exportAppFailed, { ns: 'app' }),
          { description: await getAppTransferErrorMessage(error) },
        )
        return false
      }
    },
    [appId, appName, exportWorkflow, isExporting, t],
  )

  const exportCheck = useCallback(async () => {
    if (!appId || appName === undefined) return
    try {
      const { items } = await consoleClient.apps.byAppId.workflows.draft.environmentVariables.get(
        { params: { app_id: appId } },
        { context: { silent: true } },
      )
      const list = items.filter((env) => env.value_type === 'secret')
      if (list.length === 0) {
        await handleExportDSL()
        return
      }
      eventEmitter?.emit({
        type: DSL_EXPORT_CHECK,
        payload: {
          target: workflowStore,
          data: list,
        },
      } satisfies ExportSecretEnvironmentEvent)
    } catch (error) {
      toast.error(
        t(($) => $.exportAppFailed, { ns: 'app' }),
        {
          description: await getAppTransferErrorMessage(error),
        },
      )
    }
  }, [appId, appName, eventEmitter, handleExportDSL, t, workflowStore])

  return {
    exportCheck,
    handleExportDSL,
    isExporting,
  }
}

export const useDSLByCanEdit = (canEdit: boolean) => {
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(canEdit)

  return useDSLBase(doSyncWorkflowDraft)
}
