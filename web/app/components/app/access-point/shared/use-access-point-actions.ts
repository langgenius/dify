'use client'

import type { ConfigParams } from '@/app/components/app/overview/settings'
import type { App } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { fetchAppDetail, updateAppSiteConfig } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { asyncRunSafe } from '@/utils'

export function useAccessPointActions(appId: string, canEdit: boolean) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const { mutateAsync: updateSiteStatus } = useMutation(
    consoleQuery.apps.byAppId.siteEnable.post.mutationOptions(),
  )
  const { mutateAsync: updateApiStatus } = useMutation(
    consoleQuery.apps.byAppId.apiEnable.post.mutationOptions(),
  )
  const { mutateAsync: resetSiteAccessToken } = useMutation(
    consoleQuery.apps.byAppId.site.accessTokenReset.post.mutationOptions(),
  )

  const refreshAppDetail = useCallback(async () => {
    try {
      const appDetail = await fetchAppDetail({ url: '/apps', id: appId })
      setAppDetail({ ...appDetail })
    } catch (error) {
      console.error('Failed to refresh app detail:', error)
    }
  }, [appId, setAppDetail])

  const handleResult = useCallback(
    (error: Error | null, message?: I18nKeysByPrefix<'common', 'actionMsg.'>) => {
      const type = error ? 'error' : 'success'
      const resolvedMessage = message ?? (error ? 'modifiedUnsuccessfully' : 'modifiedSuccessfully')

      if (!error) {
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: appId } },
          }),
        })
        void refreshAppDetail()
        const socket = webSocketClient.getSocket(appId)
        if (socket) {
          const timestamp = Date.now()
          socket.emit('collaboration_event', {
            type: 'app_state_update',
            data: { timestamp },
            timestamp,
          })
        }
      }

      toast(t(($) => $[`actionMsg.${resolvedMessage}`], { ns: 'common' }) as string, {
        type,
      })
    },
    [appId, queryClient, refreshAppDetail, t],
  )

  useEffect(() => {
    if (!appId) return

    return collaborationManager.onAppStateUpdate(refreshAppDetail)
  }, [appId, refreshAppDetail])

  const changeSiteStatus = useCallback(
    async (enabled: boolean) => {
      if (!canEdit) return
      const [error] = await asyncRunSafe(
        updateSiteStatus({
          params: { app_id: appId },
          body: { enable_site: enabled },
        }),
      )
      handleResult(error)
    },
    [appId, canEdit, handleResult, updateSiteStatus],
  )

  const changeApiStatus = useCallback(
    async (enabled: boolean) => {
      const [error] = await asyncRunSafe(
        updateApiStatus({
          params: { app_id: appId },
          body: { enable_api: enabled },
        }),
      )
      handleResult(error)
    },
    [appId, handleResult, updateApiStatus],
  )

  const saveSiteConfig = useCallback(
    async (params: ConfigParams) => {
      if (!canEdit) return
      const [error] = await asyncRunSafe<App>(
        updateAppSiteConfig({
          url: `/apps/${appId}/site`,
          body: params,
        }) as Promise<App>,
      )
      if (!error) {
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
      }
      handleResult(error)
    },
    [appId, canEdit, handleResult, queryClient],
  )

  const regenerateSiteCode = useCallback(async () => {
    if (!canEdit) return
    const [error] = await asyncRunSafe(
      resetSiteAccessToken({
        params: { app_id: appId },
      }),
    )
    handleResult(error, error ? 'generatedUnsuccessfully' : 'generatedSuccessfully')
  }, [appId, canEdit, handleResult, resetSiteAccessToken])

  return {
    changeApiStatus,
    changeSiteStatus,
    handleResult,
    refreshAppDetail,
    regenerateSiteCode,
    saveSiteConfig,
  }
}
