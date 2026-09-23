import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { ExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleClient } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { downloadBlob } from '@/utils/download'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const useDSLBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const { t } = useTranslation(['app'])
  const { eventEmitter } = useEventEmitterContextContext()
  const workflowStore = useWorkflowStore()
  const { mutateAsync: exportPipeline, isPending: isExporting } = useMutation({
    mutationFn: async (include: boolean) => {
      const { pipelineId, knowledgeName } = workflowStore.getState()
      if (!pipelineId) return false

      let syncFailed = false
      await doSyncWorkflowDraft(undefined, {
        onError: () => {
          syncFailed = true
        },
      })
      if (syncFailed) {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
        return false
      }

      const { data } = await consoleClient.rag.pipelines.byPipelineId.exports.get(
        { params: { pipeline_id: pipelineId }, query: { include_secret: String(include) } },
        { context: { silent: true } },
      )
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${knowledgeName}.pipeline` })
      return true
    },
  })
  const handleExportDSL = useCallback(
    async (include = false): Promise<boolean> => {
      if (isExporting) return false

      try {
        return await exportPipeline(include)
      } catch {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
        return false
      }
    },
    [t, isExporting, exportPipeline],
  )
  const exportCheck = useCallback(async () => {
    const { pipelineId } = workflowStore.getState()
    if (!pipelineId) return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(
        (env) => env.value_type === 'secret',
      )
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
    } catch {
      toast.error(t(($) => $.exportFailed, { ns: 'app' }))
    }
  }, [eventEmitter, handleExportDSL, t, workflowStore])
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
