'use client'

import type { PluginDetail } from '../../../types'
import type { ModalStates } from './use-detail-header-state'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { useModalContext } from '@/context/modal-context'
import { consoleQuery } from '@/service/console'
import { useInvalidateCheckInstalled } from '@/service/use-plugins'
import { PluginSource } from '../../../types'
import { checkGitHubPluginUpdate } from '../../../update-plugin/check-github-update'

type UsePluginOperationsParams = {
  canDeletePlugin?: boolean
  canUpdatePlugin?: boolean
  detail: PluginDetail
  modalStates: ModalStates
  onUpdate?: (isDelete?: boolean) => void | Promise<void>
}

type UsePluginOperationsReturn = {
  handleUpdate: () => Promise<void>
  handleUpdatedFromMarketplace: () => Promise<void>
  handleDelete: () => void
  deleting: boolean
}

export const usePluginOperations = ({
  canDeletePlugin = true,
  canUpdatePlugin = true,
  detail,
  modalStates,
  onUpdate,
}: UsePluginOperationsParams): UsePluginOperationsReturn => {
  const { setShowUpdatePluginModal } = useModalContext()
  const { refreshPluginList } = useRefreshPluginList()
  const invalidateCheckInstalled = useInvalidateCheckInstalled()

  const isFromMarketplace = detail.source === PluginSource.marketplace
  const { id, plugin_id } = detail
  const { category, name } = detail.declaration || detail
  const handlePluginUpdated = useCallback(
    async (isDelete?: boolean) => {
      invalidateCheckInstalled()
      await onUpdate?.(isDelete)
    },
    [invalidateCheckInstalled, onUpdate],
  )

  const handleUpdate = useCallback(async () => {
    if (!canUpdatePlugin) return

    if (isFromMarketplace) {
      modalStates.showUpdateModal()
      return
    }

    await checkGitHubPluginUpdate(detail, setShowUpdatePluginModal, handlePluginUpdated)
  }, [
    canUpdatePlugin,
    isFromMarketplace,
    setShowUpdatePluginModal,
    detail,
    handlePluginUpdated,
    modalStates,
  ])

  const remove = useMutation(
    consoleQuery.workspaces.current.plugin.uninstall.post.mutationOptions({
      onSuccess: async (response) => {
        if (!response.success) return
        await handlePluginUpdated(true)
        refreshPluginList({ category })
        trackEvent('plugin_uninstalled', { plugin_id, plugin_name: name })
        modalStates.hideDeleteConfirm()
      },
    }),
  )
  const handleDelete = () => {
    if (!canDeletePlugin) return
    remove.mutate({ body: { plugin_installation_id: id, preserve_credentials: false } })
  }

  return {
    handleUpdate,
    handleUpdatedFromMarketplace: handlePluginUpdated,
    handleDelete,
    deleting: remove.isPending,
  }
}
