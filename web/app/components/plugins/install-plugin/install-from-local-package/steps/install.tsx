'use client'
import type { FC } from 'react'
import type { PluginDeclaration } from '../../../types'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { gte } from 'semver'
import Button from '@/app/components/base/button'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { useAppContext } from '@/context/app-context'
import { uninstallPlugin } from '@/service/plugins'
import { useInstallPackageFromLocal, usePluginTaskList } from '@/service/use-plugins'
import Card from '../../../card'
import { TaskStatus } from '../../../types'
import checkTaskStatus from '../../base/check-task-status'
import Version from '../../base/version'
import { pluginManifestToCardPluginProps } from '../../utils'

const i18nPrefix = 'installModal'

type Props = {
  uniqueIdentifier: string
  payload: PluginDeclaration
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
  const toInstallVersion = payload.version
  const pluginId = `${payload.author}/${payload.name}`
  const { installedInfo, isLoading } = useCheckInstalled({
    pluginIds: [pluginId],
    enabled: !!pluginId,
  })
  const installedInfoPayload = installedInfo?.[pluginId]
  const installedVersion = installedInfoPayload?.installedVersion
  const hasInstalled = !!installedVersion

  useEffect(() => {
    if (hasInstalled && uniqueIdentifier === installedInfoPayload.uniqueIdentifier)
      onInstalled()
  }, [hasInstalled])

  const [isInstalling, setIsInstalling] = React.useState(false)
  const { mutateAsync: installPackageFromLocal } = useInstallPackageFromLocal()

  const {
    check,
    stop,
  } = checkTaskStatus()

  const handleCancel = () => {
    stop()
    onCancel()
  }

  const { handleRefetch } = usePluginTaskList(payload.category)
  const handleInstall = async () => {
    if (isInstalling)
      return
    setIsInstalling(true)
    onStartToInstall?.()

    try {
      if (hasInstalled)
        await uninstallPlugin(installedInfoPayload.installedId)

      const {
        all_installed,
        task_id,
      } = await installPackageFromLocal(uniqueIdentifier)
      const taskId = task_id
      const isInstalled = all_installed

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
  const isDifyVersionCompatible = useMemo(() => {
    if (!langGeniusVersionInfo.current_version)
      return true
    return gte(langGeniusVersionInfo.current_version, payload.meta.minimum_dify_version ?? '0.0.0')
  }, [langGeniusVersionInfo.current_version, payload.meta.minimum_dify_version])

  return (
    <>
      <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
        <div className="system-md-regular text-text-secondary">
          <p>{t(`${i18nPrefix}.readyToInstall`, { ns: 'plugin' })}</p>
          <p>
            <Trans
              i18nKey={`${i18nPrefix}.fromTrustSource`}
              ns="plugin"
              components={{ trustSource: <span className="system-md-semibold" /> }}
            />
          </p>
          {!isDifyVersionCompatible && (
            <p className="system-md-regular flex items-center gap-1 text-text-warning">
              {t('difyVersionNotCompatible', { ns: 'plugin', minimalDifyVersion: payload.meta.minimum_dify_version })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          <Card
            className="w-full"
            payload={pluginManifestToCardPluginProps(payload)}
            titleLeft={!isLoading && (
              <Version
                hasInstalled={hasInstalled}
                installedVersion={installedVersion}
                toInstallVersion={toInstallVersion}
              />
            )}
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
          disabled={isInstalling || isLoading}
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
