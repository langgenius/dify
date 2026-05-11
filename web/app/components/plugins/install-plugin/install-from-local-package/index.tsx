'use client'

import type { Dependency, PluginDeclaration } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { InstallStep } from '../../types'
import useHideLogic from '../hooks/use-hide-logic'
import ReadyToInstallBundle from '../install-bundle/ready-to-install'
import ReadyToInstallPackage from './ready-to-install'
import Uploading from './steps/uploading'

const i18nPrefix = 'installModal'

type InstallFromLocalPackageProps = {
  file: File
  onSuccess: () => void
  onClose: () => void
}

const InstallFromLocalPackage: React.FC<InstallFromLocalPackageProps> = ({
  file,
  onClose,
}) => {
  const { t } = useTranslation()
  // uploading -> !uploadFailed -> readyToInstall -> installed/failed
  const [step, setStep] = useState<InstallStep>(InstallStep.uploading)
  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)
  const [manifest, setManifest] = useState<PluginDeclaration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const isBundle = file.name.endsWith('.difybndl')
  const [dependencies, setDependencies] = useState<Dependency[]>([])

  const {
    modalClassName,
    foldAnimInto,
    setIsInstalling,
    handleStartToInstall,
  } = useHideLogic(onClose)

  const getTitle = useCallback(() => {
    if (step === InstallStep.uploadFailed)
      return t(`${i18nPrefix}.uploadFailed`, { ns: 'plugin' })
    if (isBundle && step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`, { ns: 'plugin' })
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`, { ns: 'plugin' })
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`, { ns: 'plugin' })

    return t(`${i18nPrefix}.installPlugin`, { ns: 'plugin' })
  }, [isBundle, step, t])

  const { getIconUrl } = useGetIcon()

  const handlePackageUploaded = useCallback(async (result: {
    uniqueIdentifier: string
    manifest: PluginDeclaration
  }) => {
    const {
      manifest,
      uniqueIdentifier,
    } = result
    const icon = await getIconUrl(manifest!.icon)
    const iconDark = manifest.icon_dark ? await getIconUrl(manifest.icon_dark) : undefined
    setUniqueIdentifier(uniqueIdentifier)
    setManifest({
      ...manifest,
      icon,
      icon_dark: iconDark,
    })
    setStep(InstallStep.readyToInstall)
  }, [getIconUrl])

  const handleBundleUploaded = useCallback((result: Dependency[]) => {
    setDependencies(result)
    setStep(InstallStep.readyToInstall)
  }, [])

  const handleUploadFail = useCallback((errorMsg: string) => {
    setErrorMsg(errorMsg)
    setStep(InstallStep.uploadFailed)
  }, [])

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
        {step === InstallStep.uploading && (
          <Uploading
            isBundle={isBundle}
            file={file}
            onCancel={onClose}
            onPackageUploaded={handlePackageUploaded}
            onBundleUploaded={handleBundleUploaded}
            onFailed={handleUploadFail}
          />
        )}
        {isBundle
          ? (
              <ReadyToInstallBundle
                step={step}
                onStepChange={setStep}
                onStartToInstall={handleStartToInstall}
                setIsInstalling={setIsInstalling}
                onClose={onClose}
                allPlugins={dependencies}
              />
            )
          : (
              <ReadyToInstallPackage
                step={step}
                onStepChange={setStep}
                onStartToInstall={handleStartToInstall}
                setIsInstalling={setIsInstalling}
                onClose={onClose}
                uniqueIdentifier={uniqueIdentifier}
                manifest={manifest}
                errorMsg={errorMsg}
                onError={setErrorMsg}
              />
            )}
      </DialogContent>
    </Dialog>
  )
}

export default InstallFromLocalPackage
