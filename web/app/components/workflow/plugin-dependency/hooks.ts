import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/console'
import { useCheckPipelineDependencies } from '@/service/use-pipeline'
import { useStore as usePluginDependenciesStore } from './store'

export const usePluginDependencies = () => {
  const { mutateAsync: checkWorkflowDependencies } = useMutation(
    consoleQuery.apps.imports.byAppId.checkDependencies.get.mutationOptions(),
  )
  const { mutateAsync: checkPipelineDependencies } = useCheckPipelineDependencies()

  const handleCheckPluginDependencies = useCallback(
    async (id: string, isPipeline = false) => {
      const { setDependencies } = usePluginDependenciesStore.getState()
      try {
        if (isPipeline) {
          const { leaked_dependencies } = await checkPipelineDependencies(id)
          setDependencies(leaked_dependencies)
          return
        }

        const { leaked_dependencies } = await checkWorkflowDependencies({ params: { app_id: id } })
        setDependencies(
          (leaked_dependencies ?? []).map((dependency) => ({
            ...dependency,
            // The legacy dependency store represents an absent version with undefined.
            value: { ...dependency.value, version: dependency.value.version ?? undefined },
          })),
        )
      } catch (error) {
        setDependencies([])
        throw error
      }
    },
    [checkWorkflowDependencies, checkPipelineDependencies],
  )

  return {
    handleCheckPluginDependencies,
  }
}
