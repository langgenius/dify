import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useCallback, useState } from 'react'
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
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const [exporting, setExporting] = useState(false)

  const appDetail = useAppStore((s) => s.appDetail)

  const handleExportDSL = useCallback(
    async (include = false, workflowId?: string) => {
      if (!appDetail) return

      if (exporting) return

      try {
        setExporting(true)
        await doSyncWorkflowDraft()
        await exportAppDslFile({
          appId: appDetail.id,
          appName: appDetail.name,
          includeSecret: include,
          workflowId,
        })
      } catch (error) {
        toast.error(
          t(($) => $.exportAppFailed, { ns: 'app' }),
          {
            description: await getAppTransferErrorMessage(error),
          },
        )
      } finally {
        setExporting(false)
      }
    },
    [appDetail, t, doSyncWorkflowDraft, exporting],
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
        handleExportDSL()
        return
      }
      eventEmitter?.emit({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: list,
        },
      } as any)
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
  }
}

export const useDSLByCanEdit = (canEdit: boolean) => {
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(canEdit)

  return useDSLBase(doSyncWorkflowDraft)
}
