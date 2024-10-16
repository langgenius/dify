'use client'
import type { FC } from 'react'
import React from 'react'
import { useRouter } from 'next/navigation'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import PluginInfo from '../plugin-page/plugin-info'
import ActionButton from '../../base/action-button'
import Tooltip from '../../base/tooltip'
import Confirm from '../../base/confirm'

const i18nPrefix = 'plugin.action'

type Props = {
  pluginId: string
  pluginName: string
  usedInApps: number
  isShowFetchNewVersion: boolean
  isShowInfo: boolean
  isShowDelete: boolean
  onDelete: () => void
}

const Action: FC<Props> = ({
  pluginName,
  usedInApps,
  isShowFetchNewVersion,
  isShowInfo,
  isShowDelete,
  onDelete,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [isShowPluginInfo, {
    setTrue: showPluginInfo,
    setFalse: hidePluginInfo,
  }] = useBoolean(false)

  const handleFetchNewVersion = () => { }

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)

  // const handleDelete = () => { }
  return (
    <div className='flex space-x-1'>
      {/* Only plugin installed from GitHub need to check if it's the new version  */}
      {isShowFetchNewVersion
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.checkForUpdates`)}>
            <ActionButton onClick={handleFetchNewVersion}>
              <RiLoopLeftLine className='w-4 h-4 text-text-tertiary' />
            </ActionButton>
          </Tooltip>
        )
      }
      {
        isShowInfo
        && (
          <Tooltip popupContent={t(`${i18nPrefix}.pluginInfo`)}>
            <ActionButton onClick={showPluginInfo}>
              <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
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
              <RiDeleteBinLine className='w-4 h-4' />
            </ActionButton>
          </Tooltip>
        )
      }

      {isShowPluginInfo && (
        <PluginInfo
          repository='https://github.com/langgenius/dify-github-plugin'
          release='1.2.5'
          packageName='notion-sync.difypkg'
          onHide={hidePluginInfo}
        />
      )}
      {
        isShowDeleteConfirm && (
          <Confirm
            isShow
            title={t(`${i18nPrefix}.delete`)}
            content={
              <div>
                {t(`${i18nPrefix}.deleteContentLeft`)}<span className='system-md-semibold'>{pluginName}</span>{t(`${i18nPrefix}.deleteContentRight`)}<br />
                {usedInApps > 0 && t(`${i18nPrefix}.usedInApps`, { num: usedInApps })}
              </div>
            }
            onCancel={hideDeleteConfirm}
            onConfirm={onDelete}
          />
        )
      }
    </div>
  )
}
export default React.memo(Action)
