'use client'

import React, { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import Modal from '@/app/components/base/modal'
import I18n from '@/context/i18n'
import type { PluginDeclaration } from '../../types'
import { InstallStep } from '../../types'
import Uploading from './steps/uploading'
import Install from './steps/install'
import Installed from './steps/installed'

type InstallFromLocalPackageProps = {
  file: File
  onSuccess: () => void
  onClose: () => void
}

const InstallFromLocalPackage: React.FC<InstallFromLocalPackageProps> = ({
  file,
  onClose
}) => {
  const [step, setStep] = useState<InstallStep>(InstallStep.uploading)
  const { locale } = useContext(I18n)

  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)
  const [manifest, setManifest] = useState<PluginDeclaration | null>({
    name: 'Notion Sync',
    description: 'Sync your Notion notes with Dify',
  } as any)

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

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] p-0 flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          Install plugin
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
          />
        )
      }
      {
        step === InstallStep.installed && (
          <Installed
            payload={manifest!}
            onCancel={onClose}
          />
        )
      }
    </Modal>
  )
}

export default InstallFromLocalPackage
