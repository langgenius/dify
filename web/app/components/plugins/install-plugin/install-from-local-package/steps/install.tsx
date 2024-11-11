'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { Trans, useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { useInstallPackageFromLocal } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'
import { usePluginTasksStore } from '@/app/components/plugins/plugin-page/store'

const i18nPrefix = 'plugin.installModal'

type Props = {
  uniqueIdentifier: string
  payload: PluginDeclaration
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

  const setPluginTasksWithPolling = usePluginTasksStore(s => s.setPluginTasksWithPolling)
  const handleInstall = async () => {
    if (isInstalling) return
    setIsInstalling(true)
    onStartToInstall?.()

    try {
      const {
        all_installed: isInstalled,
        task_id: taskId,
      } = await installPackageFromLocal(uniqueIdentifier)
      if (isInstalled) {
        onInstalled()
        return
      }
      setPluginTasksWithPolling()
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

  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
          <p>
            <Trans
              i18nKey={`${i18nPrefix}.fromTrustSource`}
              components={{ trustSource: <span className='system-md-semibold' /> }}
            />
          </p>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={pluginManifestToCardPluginProps(payload)}
            titleLeft={<Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version}</Badge>}
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
