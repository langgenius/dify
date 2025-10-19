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
      <div className='system-md-regular text-text-secondary'>
        <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
      </div>
      <div className='flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2'>
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
      <div className='mt-4 flex items-center justify-end gap-2 self-stretch'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={onBack}>
            {t('plugin.installModal.back')}
          </Button>
        )}
        <Button
          variant='primary'
          className='flex min-w-[72px] space-x-0.5'
          onClick={handleInstall}
          disabled={isInstalling || isLoading}
        >
          {isInstalling && <RiLoader2Line className='h-4 w-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}

export default Loaded
