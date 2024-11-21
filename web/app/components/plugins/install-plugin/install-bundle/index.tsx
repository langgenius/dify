'use client'
import type { FC } from 'react'
import Modal from '@/app/components/base/modal'
import React, { useCallback, useState } from 'react'
import { InstallStep } from '../../types'
import type { Dependency } from '../../types'
import ReadyToInstall from './ready-to-install'
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

  const getTitle = useCallback(() => {
    if (step === InstallStep.uploadFailed)
      return t(`${i18nPrefix}.uploadFailed`)
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`)

    return t(`${i18nPrefix}.installPlugin`)
  }, [step, t])

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
      <ReadyToInstall
        step={step}
        onStepChange={setStep}
        allPlugins={fromDSLPayload}
        onClose={onClose}
      />
    </Modal>
  )
}

export default React.memo(InstallBundle)
