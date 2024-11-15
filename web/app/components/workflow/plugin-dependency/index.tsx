import { useCallback } from 'react'
import { useStore } from './store'
import InstallBundle from '@/app/components/plugins/install-plugin/install-bundle'

const PluginDependency = () => {
  const dependencies = useStore(s => s.dependencies)

  const handleCancelInstallBundle = useCallback(() => {
    const { setDependencies } = useStore.getState()
    setDependencies([])
  }, [])

  if (!dependencies.length)
    return null

  return (
    <div>
      <InstallBundle
        fromDSLPayload={dependencies}
        onClose={handleCancelInstallBundle}
      />
    </div>
  )
}

export default PluginDependency
