import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { ExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getAppTransferErrorMessage } from '@/app/components/app/transfer-error'
import { exportAppDslFile } from '@/app/components/app/use-export-app-dsl'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleClient } from '@/service/console'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const useDSLBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const { t } = useTranslation(['app'])
  const { eventEmitter } = useEventEmitterContextContext()

  const appDetail = useAppStore((s) => s.appDetail)

  const { mutateAsync: exportWorkflow, isPending: isExporting } = useMutation({
    mutationFn: async ({ include, workflowId }: { include: boolean; workflowId?: string }) => {
      if (!appDetail) return false

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
        appId: appDetail.id,
        appName: appDetail.name,
        includeSecret: include,
        workflowId,
      })
      return true
    },
  })

  const handleExportDSL = useCallback(
    async (include = false, workflowId?: string): Promise<boolean> => {
      if (isExporting) return false

      try {
        return await exportWorkflow({ include, workflowId })
      } catch (error) {
        toast.error(
          t(($) => $.exportAppFailed, { ns: 'app' }),
          { description: await getAppTransferErrorMessage(error) },
        )
        return false
      }
    },
    [exportWorkflow, isExporting, t],
  )

  const exportCheck = useCallback(async () => {
    if (!appDetail) return
    try {
      const { items } = await consoleClient.apps.byAppId.workflows.draft.environmentVariables.get(
        { params: { app_id: appDetail.id } },
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
  }, [appDetail, eventEmitter, handleExportDSL, t])

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
