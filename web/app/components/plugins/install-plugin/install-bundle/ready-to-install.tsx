'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { InstallStep } from '../../types'
import Install from './steps/install'
import Installed from './steps/installed'
import type { Dependency, InstallStatus, Plugin } from '../../types'

type Props = {
  step: InstallStep
  onStepChange: (step: InstallStep) => void,
  onStartToInstall: () => void
  setIsInstalling: (isInstalling: boolean) => void
  allPlugins: Dependency[]
  onClose: () => void
  isFromMarketPlace?: boolean
}

const ReadyToInstall: FC<Props> = ({
  step,
  onStepChange,
  onStartToInstall,
  setIsInstalling,
  allPlugins,
  onClose,
  isFromMarketPlace,
}) => {
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([])
  const [installStatus, setInstallStatus] = useState<InstallStatus[]>([])
  const handleInstalled = useCallback((plugins: Plugin[], installStatus: InstallStatus[]) => {
    setInstallStatus(installStatus)
    setInstalledPlugins(plugins)
    onStepChange(InstallStep.installed)
    setIsInstalling(false)
  }, [onStepChange, setIsInstalling])
  return (
    <>
      {step === InstallStep.readyToInstall && (
        <Install
          allPlugins={allPlugins}
          onCancel={onClose}
          onStartToInstall={onStartToInstall}
          onInstalled={handleInstalled}
          isFromMarketPlace={isFromMarketPlace}
        />
      )}
      {step === InstallStep.installed && (
        <Installed
          list={installedPlugins}
          installStatus={installStatus}
          onCancel={onClose}
        />
      )}
    </>
  )
}
export default React.memo(ReadyToInstall)
