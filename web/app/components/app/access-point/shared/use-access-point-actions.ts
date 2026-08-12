'use client'

import type { ConfigParams } from '@/app/components/app/overview/settings'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import type { App } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import {
  fetchAppDetail,
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { asyncRunSafe } from '@/utils'

export function useAccessPointActions(appId: string, canEdit: boolean) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const setAppDetail = useAppStore((state) => state.setAppDetail)

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
    [appId, refreshAppDetail, t],
  )

  useEffect(() => {
    if (!appId) return

    return collaborationManager.onAppStateUpdate(refreshAppDetail)
  }, [appId, refreshAppDetail])

  const changeSiteStatus = useCallback(
    async (enabled: boolean) => {
      if (!canEdit) return
      const [error] = await asyncRunSafe<App>(
        updateAppSiteStatus({
          url: `/apps/${appId}/site-enable`,
          body: { enable_site: enabled },
        }) as Promise<App>,
      )
      handleResult(error)
    },
    [appId, canEdit, handleResult],
  )

  const changeApiStatus = useCallback(
    async (enabled: boolean) => {
      const [error] = await asyncRunSafe<App>(
        updateAppSiteStatus({
          url: `/apps/${appId}/api-enable`,
          body: { enable_api: enabled },
        }) as Promise<App>,
      )
      handleResult(error)
    },
    [appId, handleResult],
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
    const [error] = await asyncRunSafe<UpdateAppSiteCodeResponse>(
      updateAppSiteAccessToken({
        url: `/apps/${appId}/site/access-token-reset`,
      }) as Promise<UpdateAppSiteCodeResponse>,
    )
    handleResult(error, error ? 'generatedUnsuccessfully' : 'generatedSuccessfully')
  }, [appId, canEdit, handleResult])

  return {
    changeApiStatus,
    changeSiteStatus,
    handleResult,
    refreshAppDetail,
    regenerateSiteCode,
    saveSiteConfig,
  }
}
