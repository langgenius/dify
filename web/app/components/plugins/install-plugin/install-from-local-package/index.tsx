'use client'

import React, { useCallback, useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { Dependency, PluginDeclaration } from '../../types'
import { InstallStep } from '../../types'
import Uploading from './steps/uploading'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import ReadyToInstallPackage from './ready-to-install'
import ReadyToInstallBundle from '../install-bundle/ready-to-install'
import useHideLogic from '../hooks/use-hide-logic'
import cn from '@/utils/classnames'

const i18nPrefix = 'plugin.installModal'

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
      return t(`${i18nPrefix}.uploadFailed`)
    if (isBundle && step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`)
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`)
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`)

    return t(`${i18nPrefix}.installPlugin`)
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
    <Modal
      isShow={true}
      onClose={foldAnimInto}
      className={cn(modalClassName, 'shadows-shadow-xl flex min-w-[560px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0')}
      closable
    >
      <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
        <div className='title-2xl-semi-bold self-stretch text-text-primary'>
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
      {isBundle ? (
        <ReadyToInstallBundle
          step={step}
          onStepChange={setStep}
          onStartToInstall={handleStartToInstall}
          setIsInstalling={setIsInstalling}
          onClose={onClose}
          allPlugins={dependencies}
        />
      ) : (
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
    </Modal>
  )
}

export default InstallFromLocalPackage
