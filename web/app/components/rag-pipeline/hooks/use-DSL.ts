import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { ExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleClient } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { downloadBlob } from '@/utils/download'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const useDSLBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const { t } = useTranslation(['app'])
  const describeRequestError = useRequestErrorDescriber()
  const { eventEmitter } = useEventEmitterContextContext()
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useWorkflowStore()
  const { mutateAsync: exportPipeline, isPending: isExporting } = useMutation({
    meta: { errorToast: false },
    mutationFn: async (include: boolean) => {
      const { knowledgeName } = workflowStore.getState()
      if (!pipelineId) return false

      let syncFailed = false
      let syncError: unknown
      await doSyncWorkflowDraft(undefined, {
        onError: (error) => {
          syncFailed = true
          syncError = error
        },
      })
      if (syncFailed) {
        toast.error(
          describeRequestError(
            syncError,
            t(($) => $.exportFailed, { ns: 'app' }),
          ),
        )
        return false
      }

      const { data } = await consoleClient.rag.pipelines.byPipelineId.exports.get({
        params: { pipeline_id: pipelineId },
        query: { include_secret: String(include) },
      })
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
      } catch (error) {
        toast.error(
          describeRequestError(
            error,
            t(($) => $.exportFailed, { ns: 'app' }),
          ),
        )
        return false
      }
    },
    [t, describeRequestError, isExporting, exportPipeline],
  )
  const exportCheck = useCallback(async () => {
    if (!pipelineId) return
    try {
      const workflowDraft = await consoleClient.rag.pipelines.byPipelineId.workflows.draft.get({
        params: { pipeline_id: pipelineId },
      })
      const list = workflowDraft.environment_variables.filter((env) => env.value_type === 'secret')
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
        describeRequestError(
          error,
          t(($) => $.exportFailed, { ns: 'app' }),
        ),
      )
    }
  }, [eventEmitter, handleExportDSL, t, describeRequestError, pipelineId])
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
