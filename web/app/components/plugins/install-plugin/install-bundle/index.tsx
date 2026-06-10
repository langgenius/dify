'use client'
import type { FC } from 'react'
import type { Dependency } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InstallStep } from '../../types'
import useHideLogic from '../hooks/use-hide-logic'
import ReadyToInstall from './ready-to-install'

const i18nPrefix = 'installModal'

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
      return t(`${i18nPrefix}.uploadFailed`, { ns: 'plugin' })
    if (step === InstallStep.installed)
      return t(`${i18nPrefix}.installComplete`, { ns: 'plugin' })

    return t(`${i18nPrefix}.installPlugin`, { ns: 'plugin' })
  }, [step, t])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          foldAnimInto()
      }}
    >
      <DialogContent className={cn('w-full max-w-[480px] overflow-hidden! text-left align-middle', cn(modalClassName, 'shadows-shadow-xl flex max-h-[calc(100dvh-48px)] min-w-[560px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0'))}>
        <DialogCloseButton />

        <div className="flex items-start gap-2 self-stretch pt-6 pr-14 pb-3 pl-6">
          <div className="self-stretch title-2xl-semi-bold text-text-primary">
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
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(InstallBundle)
