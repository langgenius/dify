'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { RiInformation2Line } from '@remixicon/react'
import type { Plugin, PluginManifestInMarket } from '../../../types'
import Card from '../../../card'
import { pluginManifestInMarketToPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'

const i18nPrefix = 'plugin.installModal'

type Props = {
  uniqueIdentifier: string
  payload: PluginManifestInMarket | Plugin
  onCancel: () => void
  onStartToInstall?: () => void
  onInstalled: () => void
  onFailed: (message?: string) => void
}

const Installed: FC<Props> = ({
  uniqueIdentifier,
  payload,
  onCancel,
  onStartToInstall,
  onInstalled,
  onFailed,
}) => {
  const { t } = useTranslation()
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const [isInstalling, setIsInstalling] = React.useState(false)
  const {
    check,
    stop,
  } = checkTaskStatus()

  const handleCancel = () => {
    stop()
    onCancel()
  }

  const handleInstall = async () => {
    if (isInstalling) return
    onStartToInstall?.()
    setIsInstalling(true)

    try {
      const {
        all_installed: isInstalled,
        task_id: taskId,
      } = await installPackageFromMarketPlace(uniqueIdentifier)
      if (isInstalled) {
        onInstalled()
        return
      }
      await check({
        taskId,
        pluginUniqueIdentifier: uniqueIdentifier,
      })
      onInstalled()
    }
    catch (e) {
      if (typeof e === 'string') {
        onFailed(e)
        return
      }
      onFailed()
    }
  }

  const toInstallVersion = '1.3.0'
  const supportCheckInstalled = false // TODO: check installed in beta version.

  const versionInfo = useMemo(() => {
    return (<>{
      payload.latest_version === toInstallVersion || !supportCheckInstalled
        ? (
          <Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version || payload.latest_version}</Badge>
        )
        : (
          <>
            <Badge className='mx-1' size="s" state={BadgeState.Warning}>
              {`${payload.latest_version} -> ${toInstallVersion}`}
            </Badge>
            <div className='flex px-0.5 justify-center items-center gap-0.5'>
              <div className='text-text-warning system-xs-medium'>Used in 3 apps</div>
              <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
            </div>
          </>
        )
    }</>)
  }, [payload.latest_version, payload.version, supportCheckInstalled])

  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket)}
            titleLeft={versionInfo}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={handleCancel}>
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px] flex space-x-0.5'
          disabled={isInstalling}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
