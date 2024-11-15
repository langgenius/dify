'use client'

import React from 'react'
import Button from '@/app/components/base/button'
import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../../types'
import Card from '../../../card'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useTranslation } from 'react-i18next'
import { updateFromGitHub } from '@/service/plugins'
import { useInstallPackageFromGitHub } from '@/service/use-plugins'
import { RiLoader2Line } from '@remixicon/react'
import { usePluginTaskList } from '@/service/use-plugins'
import checkTaskStatus from '../../base/check-task-status'
import { parseGitHubUrl } from '../../utils'

type LoadedProps = {
  updatePayload: UpdateFromGitHubPayload
  uniqueIdentifier: string
  payload: PluginDeclaration
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  onBack: () => void
  onInstalled: () => void
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
  onInstalled,
  onFailed,
}) => {
  const { t } = useTranslation()
  const [isInstalling, setIsInstalling] = React.useState(false)
  const { mutateAsync: installPackageFromGitHub } = useInstallPackageFromGitHub()
  const { handleRefetch } = usePluginTaskList()
  const { check } = checkTaskStatus()

  const handleInstall = async () => {
    if (isInstalling) return
    setIsInstalling(true)

    try {
      const { owner, repo } = parseGitHubUrl(repoUrl)
      if (updatePayload) {
        const { all_installed: isInstalled, task_id: taskId } = await updateFromGitHub(
          `${owner}/${repo}`,
          selectedVersion,
          selectedPackage,
          updatePayload.originalPackageInfo.id,
          uniqueIdentifier,
        )

        if (isInstalled) {
          onInstalled()
          return
        }

        handleRefetch()
        await check({
          taskId,
          pluginUniqueIdentifier: uniqueIdentifier,
        })

        onInstalled()
      }
      else {
        const { all_installed: isInstalled, task_id: taskId } = await installPackageFromGitHub({
          repoUrl: `${owner}/${repo}`,
          selectedVersion,
          selectedPackage,
          uniqueIdentifier,
        })

        if (isInstalled) {
          onInstalled()
          return
        }

        handleRefetch()
        await check({
          taskId,
          pluginUniqueIdentifier: uniqueIdentifier,
        })

        onInstalled()
      }
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
          payload={pluginManifestToCardPluginProps(payload)}
          titleLeft={<Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version}</Badge>}
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
          disabled={isInstalling}
        >
          {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}

export default Loaded
