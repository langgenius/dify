'use client'

import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { PluginDetail } from '../../../types'
import type { ModalStates } from './use-detail-header-state'
import type { UpdatePluginPayload } from '@/app/components/plugins/types'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { consoleQuery } from '@/service/console'
import { useInvalidateCheckInstalled } from '@/service/use-plugins'
import { PluginSource } from '../../../types'
import {
  beginGitHubPluginIntent,
  checkGitHubPluginUpdate,
} from '../../../update-plugin/check-github-update'

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
  githubDialog: DialogHandle<UpdatePluginPayload>
  deleting: boolean
}

export const usePluginOperations = ({
  canDeletePlugin = true,
  canUpdatePlugin = true,
  detail,
  modalStates,
  onUpdate,
}: UsePluginOperationsParams): UsePluginOperationsReturn => {
  const queryClient = useQueryClient()
  const [githubDialog] = useState(() => createDialogHandle<UpdatePluginPayload>())
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

    const isCurrent = beginGitHubPluginIntent(queryClient)
    if (isFromMarketplace) {
      modalStates.showUpdateModal()
      return
    }

    const update = await checkGitHubPluginUpdate(detail, isCurrent)
    if (update) githubDialog.openWithPayload(update)
  }, [canUpdatePlugin, isFromMarketplace, detail, modalStates, githubDialog, queryClient])

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
    githubDialog,
    deleting: remove.isPending,
  }
}
