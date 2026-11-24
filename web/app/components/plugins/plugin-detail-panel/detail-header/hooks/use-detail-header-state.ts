'use client'

import type { GetWorkspacesCurrentPluginAutoUpgradeFetchResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { UseQueryResult } from '@tanstack/react-query'
import type { PluginDetail } from '../../../types'
import { useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useMemo, useState } from 'react'
import { useMarketplace } from '@/features/marketplace/client'
import { consoleQuery } from '@/service/console'
import { AUTO_UPDATE_MODE } from '../../../reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum, PluginSource } from '../../../types'

export type VersionTarget = {
  plugin: PluginDetail
  version: string
  unique_identifier: string
  warnAboutAutoUpdate?: boolean
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
}

type VersionPickerState = {
  isShow: boolean
  setIsShow: (show: boolean) => void
  targetVersion: VersionTarget | undefined
  setTargetVersion: (version: VersionTarget) => void
}

type UseDetailHeaderStateReturn = {
  modalStates: ModalStates
  versionPicker: VersionPickerState
  hasNewVersion: boolean
  isAutoUpgradeEnabled: boolean
  autoUpgradeSettings: UseQueryResult<GetWorkspacesCurrentPluginAutoUpgradeFetchResponse>
  isFromGitHub: boolean
  isFromMarketplace: boolean
}

export const useDetailHeaderState = (detail: PluginDetail): UseDetailHeaderStateReturn => {
  const enable_marketplace = useMarketplace() !== null
  const category = detail.declaration?.category ?? PluginCategoryEnum.tool
  const autoUpgradeSettings = useQuery(
    consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryOptions({
      input: { query: { category } },
    }),
  )

  const { source, version, latest_version, plugin_id } = detail

  const isFromGitHub = source === PluginSource.github
  const isFromMarketplace = source === PluginSource.marketplace
  const [isShow, setIsShow] = useState(false)
  const [targetVersion, setTargetVersion] = useState<VersionTarget>()

  const [isShowUpdateModal, { setTrue: showUpdateModal, setFalse: hideUpdateModal }] =
    useBoolean(false)
  const [isShowPluginInfo, { setTrue: showPluginInfo, setFalse: hidePluginInfo }] =
    useBoolean(false)
  const [isShowDeleteConfirm, { setTrue: showDeleteConfirm, setFalse: hideDeleteConfirm }] =
    useBoolean(false)

  const hasNewVersion = useMemo(() => {
    if (isFromMarketplace) return !!latest_version && latest_version !== version
    return false
  }, [isFromMarketplace, latest_version, version])

  const { auto_upgrade: autoUpgradeInfo } = autoUpgradeSettings.data || {}

  const isAutoUpgradeEnabled = useMemo(() => {
    if (!enable_marketplace || !autoUpgradeInfo || !isFromMarketplace) return false
    if (autoUpgradeInfo.strategy_setting === 'disabled') return false
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.update_all) return true
    if (
      autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.partial &&
      autoUpgradeInfo.include_plugins.includes(plugin_id)
    )
      return true
    if (
      autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.exclude &&
      !autoUpgradeInfo.exclude_plugins.includes(plugin_id)
    )
      return true
    return false
  }, [autoUpgradeInfo, plugin_id, isFromMarketplace, enable_marketplace])

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
    },
    versionPicker: {
      isShow,
      setIsShow,
      targetVersion,
      setTargetVersion,
    },
    hasNewVersion,
    isAutoUpgradeEnabled,
    autoUpgradeSettings,
    isFromGitHub,
    isFromMarketplace,
  }
}
