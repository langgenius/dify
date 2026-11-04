import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { ExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { exportAppDslFile } from '@/app/components/app/use-export-app-dsl'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const useDSLBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const { t } = useTranslation(['app'])
  const queryClient = useQueryClient()
  const { eventEmitter } = useEventEmitterContextContext()

  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )

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
          toast.error(t(($) => $.exportFailed, { ns: 'app' }))
          return false
        }
      }

      await exportAppDslFile(queryClient, {
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
          t(($) => $.exportFailed, { ns: 'app' }),
          { description: getErrorMessage(error) },
        )
        return false
      }
    },
    [exportWorkflow, isExporting, t],
  )

  const exportCheck = useCallback(async () => {
    if (!appDetail) return
    try {
      const { items } = await queryClient.query(
        consoleQuery.apps.byAppId.workflows.draft.environmentVariables.get.queryOptions({
          input: { params: { app_id: appDetail.id } },
          context: { silent: true },
          staleTime: 0,
        }),
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
        t(($) => $.exportFailed, { ns: 'app' }),
        {
          description: getErrorMessage(error),
        },
      )
    }
  }, [appDetail, eventEmitter, handleExportDSL, queryClient, t])

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
