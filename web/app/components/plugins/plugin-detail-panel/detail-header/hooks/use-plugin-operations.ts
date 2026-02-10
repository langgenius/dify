'use client'

import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from './use-detail-header-state'
import { useCallback } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import Toast from '@/app/components/base/toast'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { uninstallPlugin } from '@/service/plugins'
import { useInvalidateAllToolProviders } from '@/service/use-tools'
import { useGitHubReleases } from '../../../install-plugin/hooks'
import { PluginCategoryEnum, PluginSource } from '../../../types'

type UsePluginOperationsParams = {
  detail: PluginDetail
  modalStates: ModalStates
  versionPicker: {
    setTargetVersion: (version: VersionTarget) => void
    setIsDowngrade: (downgrade: boolean) => void
  }
  isFromMarketplace: boolean
  onUpdate?: (isDelete?: boolean) => void
}

type UsePluginOperationsReturn = {
  handleUpdate: (isDowngrade?: boolean) => Promise<void>
  handleUpdatedFromMarketplace: () => void
  handleDelete: () => Promise<void>
}

export const usePluginOperations = ({
  detail,
  modalStates,
  versionPicker,
  isFromMarketplace,
  onUpdate,
}: UsePluginOperationsParams): UsePluginOperationsReturn => {
  const { checkForUpdates, fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()
  const { refreshModelProviders } = useProviderContext()
  const invalidateAllToolProviders = useInvalidateAllToolProviders()

  const { id, meta, plugin_id } = detail
  const { author, category, name } = detail.declaration || detail

  const handleUpdate = useCallback(async (isDowngrade?: boolean) => {
    if (isFromMarketplace) {
      versionPicker.setIsDowngrade(!!isDowngrade)
      modalStates.showUpdateModal()
      return
    }

    if (!meta?.repo || !meta?.version || !meta?.package) {
      Toast.notify({
        type: 'error',
        message: 'Missing plugin metadata for GitHub update',
      })
      return
    }

    const owner = meta.repo.split('/')[0] || author
    const repo = meta.repo.split('/')[1] || name
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0)
      return

    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta.version)
    Toast.notify(toastProps)

    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          onUpdate?.()
        },
        payload: {
          type: PluginSource.github,
          category,
          github: {
            originalPackageInfo: {
              id: detail.plugin_unique_identifier,
              repo: meta.repo,
              version: meta.version,
              package: meta.package,
              releases: fetchedReleases,
            },
          },
        },
      })
    }
  }, [
    isFromMarketplace,
    meta,
    author,
    name,
    fetchReleases,
    checkForUpdates,
    setShowUpdatePluginModal,
    detail,
    onUpdate,
    modalStates,
    versionPicker,
  ])

  const handleUpdatedFromMarketplace = useCallback(() => {
    onUpdate?.()
    modalStates.hideUpdateModal()
  }, [onUpdate, modalStates])

  const handleDelete = useCallback(async () => {
    modalStates.showDeleting()
    const res = await uninstallPlugin(id)
    modalStates.hideDeleting()

    if (res.success) {
      modalStates.hideDeleteConfirm()
      onUpdate?.(true)

      if (PluginCategoryEnum.model.includes(category))
        refreshModelProviders()

      if (PluginCategoryEnum.tool.includes(category))
        invalidateAllToolProviders()

      trackEvent('plugin_uninstalled', { plugin_id, plugin_name: name })
    }
  }, [
    id,
    category,
    plugin_id,
    name,
    modalStates,
    onUpdate,
    refreshModelProviders,
    invalidateAllToolProviders,
  ])

  return {
    handleUpdate,
    handleUpdatedFromMarketplace,
    handleDelete,
  }
}
