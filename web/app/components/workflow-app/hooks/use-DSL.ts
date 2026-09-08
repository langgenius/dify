import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadAppDSLFile } from '@/app/components/app/dsl-file'
import { useStore as useAppStore } from '@/app/components/app/store'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleClient } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
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
        const response = await consoleClient.apps.byAppId.export.get({
          params: { app_id: appDetail.id },
          query: {
            include_secret: include,
            include_workflow_tools: true,
            workflow_id: workflowId,
          },
        })
        downloadAppDSLFile(response, appDetail.name)
      } catch {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
      } finally {
        setExporting(false)
      }
    },
    [appDetail, t, doSyncWorkflowDraft, exporting],
  )

  const exportCheck = useCallback(async () => {
    if (!appDetail) return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail?.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(
        (env) => env.value_type === 'secret',
      )
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
    } catch {
      toast.error(t(($) => $.exportFailed, { ns: 'app' }))
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
