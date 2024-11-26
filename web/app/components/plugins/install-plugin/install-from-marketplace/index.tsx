'use client'

import React, { useCallback, useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { Dependency, Plugin, PluginManifestInMarket } from '../../types'
import { InstallStep, PluginType } from '../../types'
import Install from './steps/install'
import Installed from '../base/installed'
import { useTranslation } from 'react-i18next'
import { useUpdateModelProviders } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useInvalidateAllToolProviders } from '@/service/use-tools'
import ReadyToInstallBundle from '../install-bundle/ready-to-install'

const i18nPrefix = 'plugin.installModal'

type InstallFromMarketplaceProps = {
  uniqueIdentifier: string
  manifest: PluginManifestInMarket | Plugin
  isBundle?: boolean
  dependencies?: Dependency[]
  onSuccess: () => void
  onClose: () => void
}

const InstallFromMarketplace: React.FC<InstallFromMarketplaceProps> = ({
  uniqueIdentifier,
  manifest,
  isBundle,
  dependencies,
  onSuccess,
  onClose,
}) => {
  const { t } = useTranslation()
  // readyToInstall -> check installed -> installed/failed
  const [step, setStep] = useState<InstallStep>(InstallStep.readyToInstall)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const updateModelProviders = useUpdateModelProviders()
  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  // TODO: check installed in beta version.

  const getTitle = useCallback(() => {
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`)
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`)
    return t(`${i18nPrefix}.installPlugin`)
  }, [step, t])

  const handleInstalled = useCallback(() => {
    setStep(InstallStep.installed)
    invalidateInstalledPluginList()
    if (PluginType.model.includes(manifest.category))
      updateModelProviders()
    if (PluginType.tool.includes(manifest.category))
      invalidateAllToolProviders()
  }, [invalidateAllToolProviders, invalidateInstalledPluginList, manifest, updateModelProviders])

  const handleFailed = useCallback((errorMsg?: string) => {
    setStep(InstallStep.installFailed)
    if (errorMsg)
      setErrorMsg(errorMsg)
  }, [])

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      wrapperClassName='z-[9999]'
      className='flex min-w-[560px] p-0 flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          {getTitle()}
        </div>
      </div>
      {
        isBundle ? (
          <ReadyToInstallBundle
            step={step}
            onStepChange={setStep}
            onClose={onClose}
            allPlugins={dependencies!}
            isFromMarketPlace
          />
        ) : (<>
          {
            step === InstallStep.readyToInstall && (
              <Install
                uniqueIdentifier={uniqueIdentifier}
                payload={manifest!}
                onCancel={onClose}
                onInstalled={handleInstalled}
                onFailed={handleFailed}
              />
            )}
          {
            [InstallStep.installed, InstallStep.installFailed].includes(step) && (
              <Installed
                payload={manifest!}
                isMarketPayload
                isFailed={step === InstallStep.installFailed}
                errMsg={errorMsg}
                onCancel={onSuccess}
              />
            )
          }
        </>
        )
      }
    </Modal >
  )
}

export default InstallFromMarketplace
