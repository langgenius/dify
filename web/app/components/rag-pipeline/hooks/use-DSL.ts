import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import {
  DSL_EXPORT_CHECK,
} from '@/app/components/workflow/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useExportPipelineDSL } from '@/service/use-pipeline'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export const useDSL = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [exporting, setExporting] = useState(false)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const workflowStore = useWorkflowStore()
  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  const handleExportDSL = useCallback(async (include = false) => {
    const { pipelineId, knowledgeName } = workflowStore.getState()
    if (!pipelineId)
      return

    if (exporting)
      return

    try {
      setExporting(true)
      await doSyncWorkflowDraft()
      const { data } = await exportPipelineConfig({
        pipelineId,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      const url = URL.createObjectURL(file)
      a.href = url
      a.download = `${knowledgeName}.pipeline`
      a.click()
      URL.revokeObjectURL(url)
    }
    catch {
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
    finally {
      setExporting(false)
    }
  }, [notify, t, doSyncWorkflowDraft, exporting, exportPipelineConfig, workflowStore])

  const exportCheck = useCallback(async () => {
    const { pipelineId } = workflowStore.getState()
    if (!pipelineId)
      return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`)
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
  }, [eventEmitter, handleExportDSL, notify, t, workflowStore])

  return {
    exportCheck,
    handleExportDSL,
  }
}
