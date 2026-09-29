'use client'

import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import { asyncRunSafe } from '@/utils'

export function useAccessPointActions(appId: string, canManageAccessPoint: boolean) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const refreshAppDetail = useCallback(async () => {
    try {
      const appDetail = await consoleClient.apps.byAppId.get({ params: { app_id: appId } })
      setAppDetail(appDetail)
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
    async (params: AppSiteUpdatePayload) => {
      if (!canManageAccessPoint) return
      const [error] = await asyncRunSafe(
        consoleClient.apps.byAppId.site.post({
          params: { app_id: appId },
          body: params,
        }),
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
