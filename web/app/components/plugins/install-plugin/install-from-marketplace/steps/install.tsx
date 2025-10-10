'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo } from 'react'
// import { RiInformation2Line } from '@remixicon/react'
import { type Plugin, type PluginManifestInMarket, TaskStatus } from '../../../types'
import Card from '../../../card'
import { pluginManifestInMarketToPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import { useInstallPackageFromMarketPlace, usePluginDeclarationFromMarketPlace, useUpdatePackageFromMarketPlace } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import Version from '../../base/version'
import { usePluginTaskList } from '@/service/use-plugins'
import { gte } from 'semver'
import { useAppContext } from '@/context/app-context'
import useInstallPluginLimit from '../../hooks/use-install-plugin-limit'

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
  const [blueGreen, setBlueGreen] = React.useState(false)
  const [blueGreenMode, setBlueGreenMode] = React.useState<'auto' | 'manual'>('auto')
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
        const { all_installed, task_id } = await updatePackageFromMarketPlace({
          original_plugin_unique_identifier: installedInfoPayload.uniqueIdentifier,
          new_plugin_unique_identifier: uniqueIdentifier,
          blue_green: blueGreen,
          blue_green_mode: blueGreen ? blueGreenMode : undefined,
        })
        taskId = task_id
        isInstalled = all_installed
      }
      else {
        const { all_installed, task_id } = await installPackageFromMarketPlace({ uniqueIdentifier, blueGreen, blueGreenMode })
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

  const { langGeniusVersionInfo } = useAppContext()
  const { data: pluginDeclaration } = usePluginDeclarationFromMarketPlace(uniqueIdentifier)
  const isDifyVersionCompatible = useMemo(() => {
    if (!pluginDeclaration || !langGeniusVersionInfo.current_version) return true
    return gte(langGeniusVersionInfo.current_version, pluginDeclaration?.manifest.meta.minimum_dify_version ?? '0.0.0')
  }, [langGeniusVersionInfo.current_version, pluginDeclaration])

  const { canInstall } = useInstallPluginLimit({ ...payload, from: 'marketplace' })
  return (
    <>
      <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
        <div className='system-md-regular text-text-secondary'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
          {!isDifyVersionCompatible && (
            <p className='system-md-regular text-text-warning'>
              {t('plugin.difyVersionNotCompatible', { minimalDifyVersion: pluginDeclaration?.manifest.meta.minimum_dify_version })}
            </p>
          )}
        </div>
        <div className='flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2'>
          <Card
            className='w-full'
            payload={pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket)}
            titleLeft={!isLoading && <Version
              hasInstalled={hasInstalled}
              installedVersion={installedVersion}
              toInstallVersion={toInstallVersion}
            />}
            limitedInstall={!canInstall}
          />
        </div>
      </div>
      <div className='flex w-full items-center justify-between px-8'>
        <div className='system-md-regular text-text-secondary'>
          {t('plugin.installModal.blueGreenInstall')}
        </div>
        <div className='flex items-center gap-4'>
          <Switch defaultValue={blueGreen} onChange={setBlueGreen} size='md' />
          {blueGreen && (
            <div className='flex items-center gap-2'>
              <label className='system-md-regular text-text-secondary'>
                {t('plugin.runtimeTraffic.modePrefix')}
              </label>
              <div className='flex items-center gap-2'>
                <label className='flex items-center gap-1'>
                  <input type='radio' name='bg-mode' checked={blueGreenMode === 'auto'} onChange={() => setBlueGreenMode('auto')} />
                  {t('plugin.runtimeTraffic.modeAuto')}
                </label>
                <label className='flex items-center gap-1'>
                  <input type='radio' name='bg-mode' checked={blueGreenMode === 'manual'} onChange={() => setBlueGreenMode('manual')} />
                  {t('plugin.runtimeTraffic.modeManual')}
                </label>
              </div>
            </div>
          )}
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
          disabled={isInstalling || isLoading || !canInstall}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className='h-4 w-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
