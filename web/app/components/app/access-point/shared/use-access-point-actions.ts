'use client'

import type { ConfigParams } from '@/app/components/app/overview/settings'
import type { App } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchAppDetail, updateAppSiteConfig } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { asyncRunSafe } from '@/utils'

export function useAccessPointActions(appId: string, canManageAccessPoint: boolean) {
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
      }

      toast(t(($) => $[`actionMsg.${resolvedMessage}`], { ns: 'common' }) as string, {
        type,
      })
    },
    [refreshAppDetail, t],
  )
  const saveSiteConfig = useCallback(
    async (params: ConfigParams) => {
      if (!canManageAccessPoint) return
      const [error] = await asyncRunSafe<App>(
        updateAppSiteConfig({
          url: `/apps/${appId}/site`,
          body: params,
        }) as Promise<App>,
      )
      if (!error) {
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: appId } },
          }),
        })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
      }
      handleResult(error)
    },
    [appId, canManageAccessPoint, handleResult, queryClient],
  )

  return {
    handleResult,
    refreshAppDetail,
    saveSiteConfig,
  }
}
