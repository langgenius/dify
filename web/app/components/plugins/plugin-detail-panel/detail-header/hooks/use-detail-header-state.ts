'use client'

import type { PluginDetail } from '../../../types'
import { useBoolean } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useReferenceSetting from '../../../plugin-page/use-reference-setting'
import { AUTO_UPDATE_MODE } from '../../../reference-setting-modal/auto-update-setting/types'
import { PluginSource } from '../../../types'

export type VersionTarget = {
  version: string | undefined
  unique_identifier: string | undefined
  isDowngrade?: boolean
}

export type ModalStates = {
  isShowUpdateModal: boolean
  showUpdateModal: () => void
  hideUpdateModal: () => void
  isShowPluginInfo: boolean
  showPluginInfo: () => void
  hidePluginInfo: () => void
  isShowDeleteConfirm: boolean
  showDeleteConfirm: () => void
  hideDeleteConfirm: () => void
  deleting: boolean
  showDeleting: () => void
  hideDeleting: () => void
}

export type VersionPickerState = {
  isShow: boolean
  setIsShow: (show: boolean) => void
  targetVersion: VersionTarget
  setTargetVersion: (version: VersionTarget) => void
  isDowngrade: boolean
  setIsDowngrade: (downgrade: boolean) => void
}

export type UseDetailHeaderStateReturn = {
  modalStates: ModalStates
  versionPicker: VersionPickerState
  hasNewVersion: boolean
  isAutoUpgradeEnabled: boolean
  isFromGitHub: boolean
  isFromMarketplace: boolean
}

export const useDetailHeaderState = (detail: PluginDetail): UseDetailHeaderStateReturn => {
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const { referenceSetting } = useReferenceSetting()

  const {
    source,
    version,
    latest_version,
    latest_unique_identifier,
    plugin_id,
  } = detail

  const isFromGitHub = source === PluginSource.github
  const isFromMarketplace = source === PluginSource.marketplace
  const [isShow, setIsShow] = useState(false)
  const [targetVersion, setTargetVersion] = useState<VersionTarget>({
    version: latest_version,
    unique_identifier: latest_unique_identifier,
  })
  const [isDowngrade, setIsDowngrade] = useState(false)

  const [isShowUpdateModal, { setTrue: showUpdateModal, setFalse: hideUpdateModal }] = useBoolean(false)
  const [isShowPluginInfo, { setTrue: showPluginInfo, setFalse: hidePluginInfo }] = useBoolean(false)
  const [isShowDeleteConfirm, { setTrue: showDeleteConfirm, setFalse: hideDeleteConfirm }] = useBoolean(false)
  const [deleting, { setTrue: showDeleting, setFalse: hideDeleting }] = useBoolean(false)

  const hasNewVersion = useMemo(() => {
    if (isFromMarketplace)
      return !!latest_version && latest_version !== version
    return false
  }, [isFromMarketplace, latest_version, version])

  const { auto_upgrade: autoUpgradeInfo } = referenceSetting || {}

  const isAutoUpgradeEnabled = useMemo(() => {
    if (!enable_marketplace || !autoUpgradeInfo || !isFromMarketplace)
      return false
    if (autoUpgradeInfo.strategy_setting === 'disabled')
      return false
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.update_all)
      return true
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.partial && autoUpgradeInfo.include_plugins.includes(plugin_id))
      return true
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.exclude && !autoUpgradeInfo.exclude_plugins.includes(plugin_id))
      return true
    return false
  }, [autoUpgradeInfo, plugin_id, isFromMarketplace, enable_marketplace])

  const handleSetTargetVersion = useCallback((version: VersionTarget) => {
    setTargetVersion(version)
    if (version.isDowngrade !== undefined)
      setIsDowngrade(version.isDowngrade)
  }, [])

  return {
    modalStates: {
      isShowUpdateModal,
      showUpdateModal,
      hideUpdateModal,
      isShowPluginInfo,
      showPluginInfo,
      hidePluginInfo,
      isShowDeleteConfirm,
      showDeleteConfirm,
      hideDeleteConfirm,
      deleting,
      showDeleting,
      hideDeleting,
    },
    versionPicker: {
      isShow,
      setIsShow,
      targetVersion,
      setTargetVersion: handleSetTargetVersion,
      isDowngrade,
      setIsDowngrade,
    },
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromGitHub,
    isFromMarketplace,
  }
}
