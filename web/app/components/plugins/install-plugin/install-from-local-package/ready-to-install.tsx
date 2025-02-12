'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { PluginDeclaration } from '../../types'
import { InstallStep } from '../../types'
import Install from './steps/install'
import Installed from '../base/installed'
import useRefreshPluginList from '../hooks/use-refresh-plugin-list'

type Props = {
  step: InstallStep
  onStepChange: (step: InstallStep) => void,
  onStartToInstall: () => void
  setIsInstalling: (isInstalling: boolean) => void
  onClose: () => void
  uniqueIdentifier: string | null,
  manifest: PluginDeclaration | null,
  errorMsg: string | null,
  onError: (errorMsg: string) => void,
}

const ReadyToInstall: FC<Props> = ({
  step,
  onStepChange,
  onStartToInstall,
  setIsInstalling,
  onClose,
  uniqueIdentifier,
  manifest,
  errorMsg,
  onError,
}) => {
  const { refreshPluginList } = useRefreshPluginList()

  const handleInstalled = useCallback((notRefresh?: boolean) => {
    onStepChange(InstallStep.installed)
    if (!notRefresh)
      refreshPluginList(manifest)
    setIsInstalling(false)
  }, [manifest, onStepChange, refreshPluginList, setIsInstalling])

  const handleFailed = useCallback((errorMsg?: string) => {
    onStepChange(InstallStep.installFailed)
    setIsInstalling(false)
    if (errorMsg)
      onError(errorMsg)
  }, [onError, onStepChange, setIsInstalling])

  return (
    <>
      {
        step === InstallStep.readyToInstall && (
          <Install
            uniqueIdentifier={uniqueIdentifier!}
            payload={manifest!}
            onCancel={onClose}
            onInstalled={handleInstalled}
            onFailed={handleFailed}
            onStartToInstall={onStartToInstall}
          />
        )
      }
      {
        ([InstallStep.uploadFailed, InstallStep.installed, InstallStep.installFailed].includes(step)) && (
          <Installed
            payload={manifest}
            isFailed={[InstallStep.uploadFailed, InstallStep.installFailed].includes(step)}
            errMsg={errorMsg}
            onCancel={onClose}
          />
        )
      }
    </>
  )
}
export default React.memo(ReadyToInstall)
