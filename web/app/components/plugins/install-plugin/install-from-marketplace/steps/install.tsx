'use client'
import type { FC } from 'react'
import type { Plugin, PluginManifestInMarket } from '../../../types'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { gte } from 'semver'
import Button from '@/app/components/base/button'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { useAppContext } from '@/context/app-context'
import { useInstallPackageFromMarketPlace, usePluginDeclarationFromMarketPlace, usePluginTaskList, useUpdatePackageFromMarketPlace } from '@/service/use-plugins'
import Card from '../../../card'
// import { RiInformation2Line } from '@remixicon/react'
import { TaskStatus } from '../../../types'
import checkTaskStatus from '../../base/check-task-status'
import Version from '../../base/version'
import useInstallPluginLimit from '../../hooks/use-install-plugin-limit'
import { pluginManifestInMarketToPluginProps } from '../../utils'

const i18nPrefix = 'installModal'

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
  }, [hasInstalled])

  const handleCancel = () => {
    stop()
    onCancel()
  }

  const handleInstall = async () => {
    if (isInstalling)
      return
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

  const { langGeniusVersionInfo } = useAppContext()
  const { data: pluginDeclaration } = usePluginDeclarationFromMarketPlace(uniqueIdentifier)
  const isDifyVersionCompatible = useMemo(() => {
    if (!pluginDeclaration || !langGeniusVersionInfo.current_version)
      return true
    return gte(langGeniusVersionInfo.current_version, pluginDeclaration?.manifest.meta.minimum_dify_version ?? '0.0.0')
  }, [langGeniusVersionInfo.current_version, pluginDeclaration])

  const { canInstall } = useInstallPluginLimit({ ...payload, from: 'marketplace' })
  return (
    <>
      <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
        <div className="system-md-regular text-text-secondary">
          <p>{t(`${i18nPrefix}.readyToInstall`, { ns: 'plugin' })}</p>
          {!isDifyVersionCompatible && (
            <p className="system-md-regular text-text-warning">
              {t('difyVersionNotCompatible', { ns: 'plugin', minimalDifyVersion: pluginDeclaration?.manifest.meta.minimum_dify_version })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          <Card
            className="w-full"
            payload={pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket)}
            titleLeft={!isLoading && (
              <Version
                hasInstalled={hasInstalled}
                installedVersion={installedVersion}
                toInstallVersion={toInstallVersion}
              />
            )}
            limitedInstall={!canInstall}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 self-stretch p-6 pt-5">
        {!isInstalling && (
          <Button variant="secondary" className="min-w-[72px]" onClick={handleCancel}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
        )}
        <Button
          variant="primary"
          className="flex min-w-[72px] space-x-0.5"
          disabled={isInstalling || isLoading || !canInstall}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className="h-4 w-4 animate-spin-slow" />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`, { ns: 'plugin' })}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
