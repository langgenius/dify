import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPipelineDependencies } from '@/app/components/rag-pipeline/utils/query-select'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useStore as usePluginDependenciesStore } from './store'

export const usePluginDependencies = () => {
  const { t } = useTranslation(['common'])
  const { mutateAsync: checkWorkflowDependencies } = useMutation(
    consoleQuery.apps.imports.byAppId.checkDependencies.get.mutationOptions({
      context: { silent: true },
    }),
  )
  const { mutateAsync: checkPipelineDependencies } = useMutation(
    consoleQuery.rag.pipelines.imports.byPipelineId.checkDependencies.get.mutationOptions(),
  )

  const handleCheckPluginDependencies = useCallback(
    async (id: string, isPipeline = false) => {
      const { setDependencies } = usePluginDependenciesStore.getState()
      if (isPipeline) {
        setDependencies(
          selectPipelineDependencies(
            await checkPipelineDependencies({ params: { pipeline_id: id } }),
          ),
        )
        return true
      }

      try {
        const { leaked_dependencies } = await checkWorkflowDependencies({ params: { app_id: id } })
        setDependencies(
          (leaked_dependencies ?? []).map((dependency) => ({
            ...dependency,
            // The legacy dependency store represents an absent version with undefined.
            value: { ...dependency.value, version: dependency.value.version ?? undefined },
          })),
        )
        return true
      } catch (error) {
        setDependencies([])
        toast.error(
          t(($) => $.error, { ns: 'common' }),
          {
            description: getErrorMessage(error),
          },
        )
        return false
      }
    },
    [checkWorkflowDependencies, checkPipelineDependencies, t],
  )

  return {
    handleCheckPluginDependencies,
  }
}
