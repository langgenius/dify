import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useToastContext } from '@/app/components/base/toast'
import {
  DSL_EXPORT_CHECK,
} from '@/app/components/workflow/constants'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { exportAppConfig } from '@/service/apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export const useDSL = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [exporting, setExporting] = useState(false)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const appDetail = useAppStore(s => s.appDetail)

  const handleExportDSL = useCallback(async (include = false, workflowId?: string) => {
    if (!appDetail)
      return

    if (exporting)
      return

    try {
      setExporting(true)
      await doSyncWorkflowDraft()
      const { data } = await exportAppConfig({
        appID: appDetail.id,
        include,
        workflowID: workflowId,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      const url = URL.createObjectURL(file)
      a.href = url
      a.download = `${appDetail.name}.yml`
      a.click()
      URL.revokeObjectURL(url)
    }
    catch {
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
    finally {
      setExporting(false)
    }
  }, [appDetail, notify, t, doSyncWorkflowDraft, exporting])

  const exportCheck = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail?.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
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
    }
    catch {
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
  }, [appDetail, eventEmitter, handleExportDSL, notify, t])

  return {
    exportCheck,
    handleExportDSL,
  }
}
