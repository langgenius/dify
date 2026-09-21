import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { exportAppDslFile } from '@/app/components/app/use-export-app-dsl'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
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
        await exportAppDslFile({
          appId: appDetail.id,
          appName: appDetail.name,
          includeSecret: include,
          workflowId,
        })
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
