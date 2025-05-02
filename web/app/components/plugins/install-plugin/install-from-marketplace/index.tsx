'use client'

import React, { useCallback, useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { Dependency, Plugin, PluginManifestInMarket } from '../../types'
import { InstallStep } from '../../types'
import Install from './steps/install'
import Installed from '../base/installed'
import { useTranslation } from 'react-i18next'
import useRefreshPluginList from '../hooks/use-refresh-plugin-list'
import ReadyToInstallBundle from '../install-bundle/ready-to-install'
import cn from '@/utils/classnames'
import useHideLogic from '../hooks/use-hide-logic'

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
  const { refreshPluginList } = useRefreshPluginList()

  const {
    modalClassName,
    foldAnimInto,
    setIsInstalling,
    handleStartToInstall,
  } = useHideLogic(onClose)

  const getTitle = useCallback(() => {
    if (isBundle && step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`)
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`)
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`)
    return t(`${i18nPrefix}.installPlugin`)
  }, [isBundle, step, t])

  const handleInstalled = useCallback((notRefresh?: boolean) => {
    setStep(InstallStep.installed)
    if (!notRefresh)
      refreshPluginList(manifest)
    setIsInstalling(false)
  }, [manifest, refreshPluginList, setIsInstalling])

  const handleFailed = useCallback((errorMsg?: string) => {
    setStep(InstallStep.installFailed)
    setIsInstalling(false)
    if (errorMsg)
      setErrorMsg(errorMsg)
  }, [setIsInstalling])

  return (
    <Modal
      isShow={true}
      onClose={foldAnimInto}
      wrapperClassName='z-[9999]'
      className={cn(modalClassName, 'shadows-shadow-xl flex min-w-[560px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0')}
      closable
    >
      <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
        <div className='title-2xl-semi-bold self-stretch text-text-primary'>
          {getTitle()}
        </div>
      </div>
      {
        isBundle ? (
          <ReadyToInstallBundle
            step={step}
            onStepChange={setStep}
            onStartToInstall={handleStartToInstall}
            setIsInstalling={setIsInstalling}
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
                onStartToInstall={handleStartToInstall}
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
