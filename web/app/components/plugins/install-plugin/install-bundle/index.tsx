'use client'
import type { FC } from 'react'
import Modal from '@/app/components/base/modal'
import React, { useCallback, useState } from 'react'
import { InstallStep } from '../../types'
import type { Dependency } from '../../types'
import ReadyToInstall from './ready-to-install'
import { useTranslation } from 'react-i18next'
import useHideLogic from '../hooks/use-hide-logic'
import cn from '@/utils/classnames'

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

  const {
    modalClassName,
    foldAnimInto,
    setIsInstalling,
    handleStartToInstall,
  } = useHideLogic(onClose)

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
      onClose={foldAnimInto}
      className={cn(modalClassName, 'shadows-shadow-xl flex min-w-[560px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0')}
      closable
    >
      <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
        <div className='title-2xl-semi-bold self-stretch text-text-primary'>
          {getTitle()}
        </div>
      </div>
      <ReadyToInstall
        step={step}
        onStepChange={setStep}
        onStartToInstall={handleStartToInstall}
        setIsInstalling={setIsInstalling}
        allPlugins={fromDSLPayload}
        onClose={onClose}
      />
    </Modal>
  )
}

export default React.memo(InstallBundle)
