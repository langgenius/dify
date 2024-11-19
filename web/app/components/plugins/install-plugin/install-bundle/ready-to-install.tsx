'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { InstallStep } from '../../types'
import Install from './steps/install'
import Installed from './steps/installed'
import type { Dependency, InstallStatusResponse, Plugin } from '../../types'

type Props = {
  step: InstallStep
  onStepChange: (step: InstallStep) => void,
  allPlugins: Dependency[]
  onClose: () => void
}

const ReadyToInstall: FC<Props> = ({
  step,
  onStepChange,
  allPlugins,
  onClose,
}) => {
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([])
  const [installStatus, setInstallStatus] = useState<InstallStatusResponse[]>([])
  const handleInstalled = useCallback((plugins: Plugin[], installStatus: InstallStatusResponse[]) => {
    setInstallStatus(installStatus)
    setInstalledPlugins(plugins)
    onStepChange(InstallStep.installed)
  }, [onStepChange])
  return (
    <>
      {step === InstallStep.readyToInstall && (
        <Install
          allPlugins={allPlugins}
          onCancel={onClose}
          onInstalled={handleInstalled}
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
