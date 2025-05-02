import { useCallback } from 'react'
import { useStore as usePluginDependenciesStore } from './store'
import { useMutationCheckDependencies } from '@/service/use-plugins'

export const usePluginDependencies = () => {
  const { mutateAsync } = useMutationCheckDependencies()

  const handleCheckPluginDependencies = useCallback(async (appId: string) => {
    const { leaked_dependencies } = await mutateAsync(appId)
    const { setDependencies } = usePluginDependenciesStore.getState()
    setDependencies(leaked_dependencies)
  }, [mutateAsync])

  return {
    handleCheckPluginDependencies,
  }
}
