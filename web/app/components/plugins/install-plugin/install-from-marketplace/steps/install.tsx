'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
// import { RiInformation2Line } from '@remixicon/react'
import { type Plugin, type PluginManifestInMarket, TaskStatus } from '../../../types'
import Card from '../../../card'
import { pluginManifestInMarketToPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import { useInstallPackageFromMarketPlace, useUpdatePackageFromMarketPlace } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import Version from '../../base/version'
import { usePluginTaskList } from '@/service/use-plugins'

const i18nPrefix = 'plugin.installModal'

type Props = {
  uniqueIdentifier: string
  payload: PluginManifestInMarket | Plugin
  onCancel: () => void
  onStartToInstall?: () => void
  onInstalled: (notRefresh?: boolean) => void
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
  const toInstallVersion = payload.version || payload.latest_version
  const pluginId = (payload as Plugin).plugin_id
  const { installedInfo, isLoading } = useCheckInstalled({
    pluginIds: [pluginId],
    enabled: !!pluginId,
  })
  const installedInfoPayload = installedInfo?.[pluginId]
  const installedVersion = installedInfoPayload?.installedVersion
  const hasInstalled = !!installedVersion

  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { mutateAsync: updatePackageFromMarketPlace } = useUpdatePackageFromMarketPlace()
  const [isInstalling, setIsInstalling] = React.useState(false)
  const {
    check,
    stop,
  } = checkTaskStatus()
  const { handleRefetch } = usePluginTaskList(payload.category)

  useEffect(() => {
    if (hasInstalled && uniqueIdentifier === installedInfoPayload.uniqueIdentifier)
      onInstalled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInstalled])

  const handleCancel = () => {
    stop()
    onCancel()
  }

  const handleInstall = async () => {
    if (isInstalling) return
    onStartToInstall?.()
    setIsInstalling(true)
    try {
      let taskId
      let isInstalled
      if (hasInstalled) {
        const {
          all_installed,
          task_id,
        } = await updatePackageFromMarketPlace({
          original_plugin_unique_identifier: installedInfoPayload.uniqueIdentifier,
          new_plugin_unique_identifier: uniqueIdentifier,
        })
        taskId = task_id
        isInstalled = all_installed
      }
      else {
        const {
          all_installed,
          task_id,
        } = await installPackageFromMarketPlace(uniqueIdentifier)
        taskId = task_id
        isInstalled = all_installed
      }

      if (isInstalled) {
        onInstalled()
        return
      }

      handleRefetch()

      const { status, error } = await check({
        taskId,
        pluginUniqueIdentifier: uniqueIdentifier,
      })
      if (status === TaskStatus.failed) {
        onFailed(error)
        return
      }
      onInstalled(true)
    }
    catch (e) {
      if (typeof e === 'string') {
        onFailed(e)
        return
      }
      onFailed()
    }
  }

  return (
    <>
      <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
        </div>
        <div className='bg-background-section-burn flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl p-2'>
          <Card
            className='w-full'
            payload={pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket)}
            titleLeft={!isLoading && <Version
              hasInstalled={hasInstalled}
              installedVersion={installedVersion}
              toInstallVersion={toInstallVersion}
            />}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex items-center justify-end gap-2 self-stretch p-6 pt-5'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={handleCancel}>
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          className='flex min-w-[72px] space-x-0.5'
          disabled={isInstalling || isLoading}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className='animate-spin-slow h-4 w-4' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
