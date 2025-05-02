'use client'

import React, { useEffect } from 'react'
import Button from '@/app/components/base/button'
import { type Plugin, type PluginDeclaration, TaskStatus, type UpdateFromGitHubPayload } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useTranslation } from 'react-i18next'
import { updateFromGitHub } from '@/service/plugins'
import { useInstallPackageFromGitHub } from '@/service/use-plugins'
import { RiLoader2Line } from '@remixicon/react'
import { usePluginTaskList } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { parseGitHubUrl } from '../../utils'
import Version from '../../base/version'

type LoadedProps = {
  updatePayload: UpdateFromGitHubPayload
  uniqueIdentifier: string
  payload: PluginDeclaration | Plugin
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  onBack: () => void
  onStartToInstall?: () => void
  onInstalled: (notRefresh?: boolean) => void
  onFailed: (message?: string) => void
}

const i18nPrefix = 'plugin.installModal'

const Loaded: React.FC<LoadedProps> = ({
  updatePayload,
  uniqueIdentifier,
  payload,
  repoUrl,
  selectedVersion,
  selectedPackage,
  onBack,
  onStartToInstall,
  onInstalled,
  onFailed,
}) => {
  const { t } = useTranslation()
  const toInstallVersion = payload.version
  const pluginId = (payload as Plugin).plugin_id
  const { installedInfo, isLoading } = useCheckInstalled({
    pluginIds: [pluginId],
    enabled: !!pluginId,
  })
  const installedInfoPayload = installedInfo?.[pluginId]
  const installedVersion = installedInfoPayload?.installedVersion
  const hasInstalled = !!installedVersion

  const [isInstalling, setIsInstalling] = React.useState(false)
  const { mutateAsync: installPackageFromGitHub } = useInstallPackageFromGitHub()
  const { handleRefetch } = usePluginTaskList(payload.category)
  const { check } = checkTaskStatus()

  useEffect(() => {
    if (hasInstalled && uniqueIdentifier === installedInfoPayload.uniqueIdentifier)
      onInstalled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInstalled])

  const handleInstall = async () => {
    if (isInstalling) return
    setIsInstalling(true)
    onStartToInstall?.()

    try {
      const { owner, repo } = parseGitHubUrl(repoUrl)
      let taskId
      let isInstalled
      if (updatePayload) {
        const { all_installed, task_id } = await updateFromGitHub(
          `${owner}/${repo}`,
          selectedVersion,
          selectedPackage,
          updatePayload.originalPackageInfo.id,
          uniqueIdentifier,
        )

        taskId = task_id
        isInstalled = all_installed
      }
      else {
        if (hasInstalled) {
          const {
            all_installed,
            task_id,
          } = await updateFromGitHub(
            `${owner}/${repo}`,
            selectedVersion,
            selectedPackage,
            installedInfoPayload.uniqueIdentifier,
            uniqueIdentifier,
          )
          taskId = task_id
          isInstalled = all_installed
        }
        else {
          const { all_installed, task_id } = await installPackageFromGitHub({
            repoUrl: `${owner}/${repo}`,
            selectedVersion,
            selectedPackage,
            uniqueIdentifier,
          })

          taskId = task_id
          isInstalled = all_installed
        }
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
    finally {
      setIsInstalling(false)
    }
  }

  return (
    <>
      <div className='text-text-secondary system-md-regular'>
        <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
      </div>
      <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
        <Card
          className='w-full'
          payload={pluginManifestToCardPluginProps(payload as PluginDeclaration)}
          titleLeft={!isLoading && <Version
            hasInstalled={hasInstalled}
            installedVersion={installedVersion}
            toInstallVersion={toInstallVersion}
          />}
        />
      </div>
      <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={onBack}>
            {t('plugin.installModal.back')}
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px] flex space-x-0.5'
          onClick={handleInstall}
          disabled={isInstalling || isLoading}
        >
          {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}

export default Loaded
