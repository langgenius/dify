'use client'

import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from './use-detail-header-state'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/components/base/ui/toast'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { uninstallPlugin } from '@/service/plugins'
import { useInvalidateCheckInstalled } from '@/service/use-plugins'
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
  const { t } = useTranslation()
  const { checkForUpdates, fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()
  const { refreshModelProviders } = useProviderContext()
  const invalidateCheckInstalled = useInvalidateCheckInstalled()
  const invalidateAllToolProviders = useInvalidateAllToolProviders()

  const { id, meta, plugin_id } = detail
  const { author, category, name } = detail.declaration || detail
  const handlePluginUpdated = useCallback((isDelete?: boolean) => {
    invalidateCheckInstalled()
    onUpdate?.(isDelete)
  }, [invalidateCheckInstalled, onUpdate])

  const handleUpdate = useCallback(async (isDowngrade?: boolean) => {
    if (isFromMarketplace) {
      versionPicker.setIsDowngrade(!!isDowngrade)
      modalStates.showUpdateModal()
      return
    }

    if (!meta?.repo || !meta?.version || !meta?.package) {
      toast.error('Missing plugin metadata for GitHub update')
      return
    }

    const owner = meta.repo.split('/')[0] || author
    const repo = meta.repo.split('/')[1] || name
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0)
      return

    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta.version)
    toast(toastProps.message, { type: toastProps.type })

    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          handlePluginUpdated()
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
    handlePluginUpdated,
    modalStates,
    versionPicker,
  ])

  const handleUpdatedFromMarketplace = useCallback(() => {
    handlePluginUpdated()
    modalStates.hideUpdateModal()
  }, [handlePluginUpdated, modalStates])

  const handleDelete = useCallback(async () => {
    modalStates.showDeleting()
    const res = await uninstallPlugin(id)
    modalStates.hideDeleting()

    if (res.success) {
      modalStates.hideDeleteConfirm()
      toast.success(t('action.deleteSuccess', { ns: 'plugin' }))
      handlePluginUpdated(true)

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
    handlePluginUpdated,
    refreshModelProviders,
    invalidateAllToolProviders,
  ])

  return {
    handleUpdate,
    handleUpdatedFromMarketplace,
    handleDelete,
  }
}
