'use client'

import React, { useCallback, useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { PluginDeclaration } from '../../types'
import { InstallStep } from '../../types'
import Uploading from './steps/uploading'
import Install from './steps/install'
import Installed from './steps/installed'
import { useTranslation } from 'react-i18next'
import { toolNotionManifest } from '../../card/card-mock'

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
  // uploading -> readyToInstall -> installed/failed
  const [step, setStep] = useState<InstallStep>(InstallStep.uploading)

  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)

  const getTitle = useCallback(() => {
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installedSuccessfully`)
    if (step === InstallStep.installFailed)
      return t(`${i18nPrefix}.installFailed`)
    return t(`${i18nPrefix}.installPlugin`)
  }, [])
  const [manifest, setManifest] = useState<PluginDeclaration | null>(toolNotionManifest)

  const handleUploaded = useCallback((result: {
    uniqueIdentifier: string
    manifest: PluginDeclaration
  }) => {
    setUniqueIdentifier(result.uniqueIdentifier)
    setManifest(result.manifest)
    setStep(InstallStep.readyToInstall)
  }, [])

  const handleInstalled = useCallback(async () => {
    setStep(InstallStep.installed)
  }, [])

  const handleFailed = useCallback(() => {
    setStep(InstallStep.installFailed)
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
      {step === InstallStep.uploading && (
        <Uploading
          file={file}
          onCancel={onClose}
          onUploaded={handleUploaded}
        />
      )}
      {
        step === InstallStep.readyToInstall && (
          <Install
            payload={manifest!}
            onCancel={onClose}
            onInstalled={handleInstalled}
            onFailed={handleFailed}
          />
        )
      }
      {
        ([InstallStep.installed, InstallStep.installFailed].includes(step)) && (
          <Installed
            payload={manifest!}
            isFailed={step === InstallStep.installFailed}
            onCancel={onClose}
          />
        )
      }
    </Modal>
  )
}

export default InstallFromLocalPackage
