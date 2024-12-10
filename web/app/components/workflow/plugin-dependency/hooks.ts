import { useCallback } from 'react'
import { useStore as usePluginDependenciesStore } from './store'
import { useMutationCheckDependecies } from '@/service/use-plugins'

export const usePluginDependencies = () => {
  const { mutateAsync } = useMutationCheckDependecies()

  const handleCheckPluginDependencies = useCallback(async (appId: string) => {
    const { leaked_dependencies } = await mutateAsync(appId)
    const { setDependencies } = usePluginDependenciesStore.getState()
    setDependencies(leaked_dependencies)
  }, [mutateAsync])

  return {
    handleCheckPluginDependencies,
  }
}
