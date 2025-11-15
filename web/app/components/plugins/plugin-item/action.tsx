'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { type MetaData, PluginSource } from '../types'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import PluginInfo from '../plugin-page/plugin-info'
import ActionButton from '../../base/action-button'
import Tooltip from '../../base/tooltip'
import Confirm from '../../base/confirm'
import CredentialCheckbox from './credential-checkbox'
import { checkPluginCredentials, uninstallPlugin } from '@/service/plugins'
import { useGitHubReleases } from '../install-plugin/hooks'
import Toast from '@/app/components/base/toast'
import { useModalContext } from '@/context/modal-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'

const i18nPrefix = 'plugin.action'

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

  const [credentials, setCredentials] = React.useState<Array<{
    credential_id: string
    credential_name: string
    credential_type: string
    provider_name: string
  }>>([])

  const [deleteCredentials, setDeleteCredentials] = React.useState(false)

  const handleShowDeleteConfirm = useCallback(async () => {
    try {
      const credentialsData = await checkPluginCredentials(installationId)
      setCredentials(credentialsData.credentials || [])
      setDeleteCredentials(credentialsData.has_credentials) // Default to delete if there are credentials
    }
    catch (error) {
      console.error('checkPluginCredentials error', error)
      setCredentials([])
    }
    showDeleteConfirm()
  }, [installationId, showDeleteConfirm])

  const handleDelete = useCallback(async () => {
    showDeleting()
    try {
      const res = await uninstallPlugin(
        installationId,
        deleteCredentials && credentials.length > 0,
        deleteCredentials ? credentials.map(c => c.credential_id) : undefined,
      )
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
  }, [installationId, deleteCredentials, credentials, onDelete, hideDeleteConfirm])

  const confirmContent = useMemo(() => (
    <div className='space-y-3'>
      <div>
        {t(`${i18nPrefix}.deleteContentLeft`)}<span className='system-md-semibold'>{pluginName}</span>{t(`${i18nPrefix}.deleteContentRight`)}
      </div>
      {credentials.length > 0 && (
        <div className='space-y-2'>
          <div className='system-sm-semibold text-text-secondary'>
            {t(`${i18nPrefix}.credentialsWarning`)}
          </div>
          <div className='max-h-32 overflow-y-auto space-y-1 rounded-lg border border-divider-subtle bg-background-section-burn p-2'>
            {credentials.map(cred => (
              <div key={cred.credential_id} className='system-xs-regular text-text-tertiary'>
                • {cred.credential_name} ({cred.credential_type})
              </div>
            ))}
          </div>
          <div className='space-y-2 pt-2'>
            <div className='system-sm-semibold text-text-secondary'>
              What should happen to these API keys?
            </div>
            <div className='flex flex-col gap-2'>
              <label
                className='flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-background-default-hover transition-colors'
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteCredentials(true)
                }}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${deleteCredentials ? 'border-blue-600' : 'border-gray-300'}`}>
                  {deleteCredentials && <div className='w-2 h-2 rounded-full bg-blue-600' />}
                </div>
                <span className='system-sm-regular'>Delete these API keys</span>
              </label>
              <label
                className='flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-background-default-hover transition-colors'
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteCredentials(false)
                }}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${!deleteCredentials ? 'border-blue-600' : 'border-gray-300'}`}>
                  {!deleteCredentials && <div className='w-2 h-2 rounded-full bg-blue-600' />}
                </div>
                <span className='system-sm-regular'>Keep these API keys (reuse if reinstalling plugin)</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  ), [t, pluginName, credentials, deleteCredentials])

  return (
    <div className='flex space-x-1'>
      {/* Only plugin installed from GitHub need to check if it's the new version  */}
      {isShowFetchNewVersion
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.checkForUpdates`)}>
            <ActionButton onClick={handleFetchNewVersion}>
              <RiLoopLeftLine className='h-4 w-4 text-text-tertiary' />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowInfo
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.pluginInfo`)}>
            <ActionButton onClick={showPluginInfo}>
              <RiInformation2Line className='h-4 w-4 text-text-tertiary' />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowDelete
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.delete`)}>
            <ActionButton
              className='text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive'
              onClick={handleShowDeleteConfirm}
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
        content={confirmContent}
        onCancel={hideDeleteConfirm}
        onConfirm={handleDelete}
        isLoading={deleting}
        isDisabled={deleting}
      />
    </div>
  )
}
export default React.memo(Action)
