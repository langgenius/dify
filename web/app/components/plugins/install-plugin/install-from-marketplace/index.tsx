'use client'

import type { Dependency, Plugin, PluginManifestInMarket } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InstallStep } from '../../types'
import Installed from '../base/installed'
import useHideLogic from '../hooks/use-hide-logic'
import useRefreshPluginList from '../hooks/use-refresh-plugin-list'
import ReadyToInstallBundle from '../install-bundle/ready-to-install'
import Install from './steps/install'

const i18nPrefix = 'installModal'

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
      return t(`${i18nPrefix}.installComplete`, { ns: 'plugin' })
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`, { ns: 'plugin' })
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`, { ns: 'plugin' })
    return t(`${i18nPrefix}.installPlugin`, { ns: 'plugin' })
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          foldAnimInto()
      }}
    >
      <DialogContent className={cn('w-[560px] max-w-none! overflow-hidden! text-left align-middle', cn(modalClassName, 'shadows-shadow-xl flex min-w-[560px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0'))}>
        <DialogCloseButton />

        <div className="flex items-start gap-2 self-stretch pt-6 pr-14 pb-3 pl-6">
          <div className="self-stretch title-2xl-semi-bold text-text-primary">
            {getTitle()}
          </div>
        </div>
        {
          isBundle
            ? (
                <ReadyToInstallBundle
                  step={step}
                  onStepChange={setStep}
                  onStartToInstall={handleStartToInstall}
                  setIsInstalling={setIsInstalling}
                  onClose={onClose}
                  allPlugins={dependencies!}
                  isFromMarketPlace
                />
              )
            : (
                <>
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
                    )
                  }
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
      </DialogContent>
    </Dialog>
  )
}

export default InstallFromMarketplace
