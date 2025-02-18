'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { type PluginDeclaration, TaskStatus } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { Trans, useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import checkTaskStatus from '../../base/check-task-status'
import { useInstallPackageFromLocal, usePluginTaskList } from '@/service/use-plugins'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { uninstallPlugin } from '@/service/plugins'
import Version from '../../base/version'

const i18nPrefix = 'plugin.installModal'

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isInstalling) return
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

  return (
    <>
      <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
          <p>
            <Trans
              i18nKey={`${i18nPrefix}.fromTrustSource`}
              components={{ trustSource: <span className='system-md-semibold' /> }}
            />
          </p>
        </div>
        <div className='bg-background-section-burn flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl p-2'>
          <Card
            className='w-full'
            payload={pluginManifestToCardPluginProps(payload)}
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
