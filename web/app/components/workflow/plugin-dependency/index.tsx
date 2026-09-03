'use client'

import type { InstallBundleCompleteCallback } from '@/app/components/plugins/install-plugin/install-bundle'
import { useCallback } from 'react'
import InstallBundle from '@/app/components/plugins/install-plugin/install-bundle'
import { useStore } from './store'

type Props = {
  onInstallComplete?: InstallBundleCompleteCallback
}

const PluginDependency = ({ onInstallComplete }: Props) => {
  const dependencies = useStore((s) => s.dependencies)

  const handleCancelInstallBundle = useCallback(() => {
    const { setDependencies } = useStore.getState()
    setDependencies([])
  }, [])

  if (!dependencies.length) return null

  return (
    <InstallBundle
      fromDSLPayload={dependencies}
      onClose={handleCancelInstallBundle}
      onInstallComplete={onInstallComplete}
    />
  )
}

export default PluginDependency
