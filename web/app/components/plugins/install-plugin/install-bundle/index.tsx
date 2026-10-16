'use client'
import type { FC } from 'react'
import type { Dependency, InstallStatus, Plugin, VersionProps } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InstallStep } from '../../types'
import useHideLogic from '../hooks/use-hide-logic'
import ReadyToInstall from './ready-to-install'

const i18nPrefix = 'installModal'

export type InstallBundleCompleteCallback = (
  plugins: Plugin[],
  installStatus: InstallStatus[],
  versionInfo: VersionProps[],
) => void

export const InstallType = {
  fromLocal: 'fromLocal',
  fromMarketplace: 'fromMarketplace',
  fromDSL: 'fromDSL',
} as const

export type InstallType = (typeof InstallType)[keyof typeof InstallType]

type Props = Readonly<{
  installType?: InstallType
  fromDSLPayload: Dependency[]
  // plugins?: PluginDeclaration[]
  onClose: () => void
  onInstallComplete?: InstallBundleCompleteCallback
}>

const InstallBundle: FC<Props> = ({
  installType = InstallType.fromMarketplace,
  fromDSLPayload,
  onClose,
  onInstallComplete,
}) => {
  const { t } = useTranslation(['common', 'plugin'])
  const [step, setStep] = useState<InstallStep>(
    installType === InstallType.fromMarketplace
      ? InstallStep.readyToInstall
      : InstallStep.uploading,
  )

  const { modalClassName, foldAnimInto, setIsInstalling, handleStartToInstall } =
    useHideLogic(onClose)

  const getTitle = useCallback(() => {
    if (step === InstallStep.uploadFailed)
      return t(($) => $[`${i18nPrefix}.uploadFailed`], { ns: 'plugin' })
    if (step === InstallStep.installed)
      return t(($) => $[`${i18nPrefix}.installedSuccessfully`], { ns: 'plugin' })

    return t(($) => $[`${i18nPrefix}.installPlugin`], { ns: 'plugin' })
  }, [step, t])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) foldAnimInto()
      }}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className={cn('w-full max-w-120', modalClassName, 'max-h-[calc(100dvh-48px)] min-w-140')}
      >
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <ReadyToInstall
          step={step}
          onStepChange={setStep}
          onStartToInstall={handleStartToInstall}
          setIsInstalling={setIsInstalling}
          allPlugins={fromDSLPayload}
          onClose={onClose}
          onInstallComplete={onInstallComplete}
        />
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(InstallBundle)
