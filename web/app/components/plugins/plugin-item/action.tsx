'use client'
import type { FC } from 'react'
import type { MetaData } from '../types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useModalContext } from '@/context/modal-context'
import { uninstallPlugin } from '@/service/plugins'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import ActionButton from '../../base/action-button'
import Confirm from '../../base/confirm'
import Tooltip from '../../base/tooltip'
import { useGitHubReleases } from '../install-plugin/hooks'
import PluginInfo from '../plugin-page/plugin-info'
import { PluginSource } from '../types'

const i18nPrefix = 'action'

type Props = {
  author: string
  installationId: string
  pluginUniqueIdentifier: string
  pluginName: string
  category: PluginCategoryEnum
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
    if (fetchedReleases.length === 0)
      return
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
    try {
      const res = await uninstallPlugin(installationId)
      if (res.success) {
        hideDeleteConfirm()
        onDelete()
      }
    }
    catch (error) {
      console.error('uninstallPlugin error', error)
    }
    finally {
      hideDeleting()
    }
  }, [installationId, onDelete])
  return (
    <div className="flex space-x-1">
      {/* Only plugin installed from GitHub need to check if it's the new version  */}
      {isShowFetchNewVersion
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.checkForUpdates`, { ns: 'plugin' })}>
            <ActionButton onClick={handleFetchNewVersion}>
              <RiLoopLeftLine className="h-4 w-4 text-text-tertiary" />
            </ActionButton>
          </Tooltip>
        )}
      {
        isShowInfo
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.pluginInfo`, { ns: 'plugin' })}>
            <ActionButton onClick={showPluginInfo}>
              <RiInformation2Line className="h-4 w-4 text-text-tertiary" />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowDelete
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.delete`, { ns: 'plugin' })}>
            <ActionButton
              className="text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
              onClick={showDeleteConfirm}
            >
              <RiDeleteBinLine className="h-4 w-4" />
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
        title={t(`${i18nPrefix}.delete`, { ns: 'plugin' })}
        content={(
          <div>
            {t(`${i18nPrefix}.deleteContentLeft`, { ns: 'plugin' })}
            <span className="system-md-semibold">{pluginName}</span>
            {t(`${i18nPrefix}.deleteContentRight`, { ns: 'plugin' })}
            <br />
            {/* // todo: add usedInApps */}
            {/* {usedInApps > 0 && t(`${i18nPrefix}.usedInApps`, { num: usedInApps })} */}
          </div>
        )}
        onCancel={hideDeleteConfirm}
        onConfirm={handleDelete}
        isLoading={deleting}
        isDisabled={deleting}
      />
    </div>
  )
}
export default React.memo(Action)
