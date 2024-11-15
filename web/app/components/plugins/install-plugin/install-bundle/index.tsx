'use client'
import type { FC } from 'react'
import Modal from '@/app/components/base/modal'
import React, { useCallback, useState } from 'react'
import { InstallStep } from '../../types'
import type { Dependency, Plugin } from '../../types'
import Install from './steps/install'
import Installed from './steps/installed'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'plugin.installModal'

export enum InstallType {
  fromLocal = 'fromLocal',
  fromMarketplace = 'fromMarketplace',
  fromDSL = 'fromDSL',
}

type Props = {
  installType?: InstallType
  fromDSLPayload: Dependency[]
  // plugins?: PluginDeclaration[]
  onClose: () => void
}

const InstallBundle: FC<Props> = ({
  installType = InstallType.fromMarketplace,
  fromDSLPayload,
  onClose,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<InstallStep>(installType === InstallType.fromMarketplace ? InstallStep.readyToInstall : InstallStep.uploading)
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([])
  const [installStatus, setInstallStatus] = useState<{ success: boolean }[]>([])
  const getTitle = useCallback(() => {
    if (step === InstallStep.uploadFailed)
      return t(`${i18nPrefix}.uploadFailed`)
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`)
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`)

    return t(`${i18nPrefix}.installPlugin`)
  }, [step, t])

  const handleInstalled = useCallback((plugins: Plugin[], installStatus: { success: boolean }[]) => {
    setInstallStatus(installStatus)
    setInstalledPlugins(plugins)
    setStep(InstallStep.installed)
  }, [])

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] p-0 flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          {getTitle()}
        </div>
      </div>
      {step === InstallStep.readyToInstall && (
        <Install
          fromDSLPayload={fromDSLPayload}
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
    </Modal>
  )
}

export default React.memo(InstallBundle)
