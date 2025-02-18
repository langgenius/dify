'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { type MetaData, PluginSource } from '../types'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import PluginInfo from '../plugin-page/plugin-info'
import ActionButton from '../../base/action-button'
import Tooltip from '../../base/tooltip'
import Confirm from '../../base/confirm'
import { uninstallPlugin } from '@/service/plugins'
import { useGitHubReleases } from '../install-plugin/hooks'
import Toast from '@/app/components/base/toast'
import { useModalContext } from '@/context/modal-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import type { PluginType } from '@/app/components/plugins/types'

const i18nPrefix = 'plugin.action'

type Props = {
  author: string
  installationId: string
  pluginUniqueIdentifier: string
  pluginName: string
  category: PluginType
  usedInApps: number
  isShowFetchNewVersion: boolean
  isShowInfo: boolean
  isShowDelete: boolean
  onDelete: () => void
  meta?: MetaData
}
const Action: FC<Props> = ({
  author,
  installationId,
  pluginUniqueIdentifier,
  pluginName,
  category,
  isShowFetchNewVersion,
  isShowInfo,
  isShowDelete,
  onDelete,
  meta,
}) => {
  const { t } = useTranslation()
  const [isShowPluginInfo, {
    setTrue: showPluginInfo,
    setFalse: hidePluginInfo,
  }] = useBoolean(false)
  const [deleting, {
    setTrue: showDeleting,
    setFalse: hideDeleting,
  }] = useBoolean(false)
  const { checkForUpdates, fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  const handleFetchNewVersion = async () => {
    const owner = meta!.repo.split('/')[0] || author
    const repo = meta!.repo.split('/')[1] || pluginName
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0) return
    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta!.version)
    Toast.notify(toastProps)
    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          invalidateInstalledPluginList()
        },
        payload: {
          type: PluginSource.github,
          category,
          github: {
            originalPackageInfo: {
              id: pluginUniqueIdentifier,
              repo: meta!.repo,
              version: meta!.version,
              package: meta!.package,
              releases: fetchedReleases,
            },
          },
        },
      })
    }
  }

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)

  const handleDelete = useCallback(async () => {
    showDeleting()
    const res = await uninstallPlugin(installationId)
    hideDeleting()
    if (res.success) {
      hideDeleteConfirm()
      onDelete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId, onDelete])
  return (
    <div className='flex space-x-1'>
      {/* Only plugin installed from GitHub need to check if it's the new version  */}
      {isShowFetchNewVersion
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.checkForUpdates`)}>
            <ActionButton onClick={handleFetchNewVersion}>
              <RiLoopLeftLine className='text-text-tertiary h-4 w-4' />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowInfo
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.pluginInfo`)}>
            <ActionButton onClick={showPluginInfo}>
              <RiInformation2Line className='text-text-tertiary h-4 w-4' />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowDelete
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.delete`)}>
            <ActionButton
              className='hover:bg-state-destructive-hover text-text-tertiary hover:text-text-destructive'
              onClick={showDeleteConfirm}
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </ActionButton>
          </Tooltip>
        )
      }

      {isShowPluginInfo && (
        <PluginInfo
          repository={meta!.repo}
          release={meta!.version}
          packageName={meta!.package}
          onHide={hidePluginInfo}
        />
      )}
      <Confirm
        isShow={isShowDeleteConfirm}
        title={t(`${i18nPrefix}.delete`)}
        content={
          <div>
            {t(`${i18nPrefix}.deleteContentLeft`)}<span className='system-md-semibold'>{pluginName}</span>{t(`${i18nPrefix}.deleteContentRight`)}<br />
            {/* // todo: add usedInApps */}
            {/* {usedInApps > 0 && t(`${i18nPrefix}.usedInApps`, { num: usedInApps })} */}
          </div>
        }
        onCancel={hideDeleteConfirm}
        onConfirm={handleDelete}
        isLoading={deleting}
        isDisabled={deleting}
      />
    </div>
  )
}
export default React.memo(Action)
