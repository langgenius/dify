'use client'

import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { asyncRunSafe } from '@/utils'

export function useAccessPointActions(appId: string, canManageAccessPoint: boolean) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const { mutateAsync: updateSiteConfig } = useMutation(
    consoleQuery.apps.byAppId.site.post.mutationOptions(),
  )
  const refreshAppDetail = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: appId } },
        }),
      }),
    [appId, queryClient],
  )

  const saveSiteConfig = useCallback(
    async (params: AppSiteUpdatePayload) => {
      if (!canManageAccessPoint) return
      const [error] = await asyncRunSafe(
        updateSiteConfig({
          params: { app_id: appId },
          body: params,
        }),
      )
      toast(
        t(($) => $[`actionMsg.${error ? 'modifiedUnsuccessfully' : 'modifiedSuccessfully'}`], {
          ns: 'common',
        }) as string,
        {
          type: error ? 'error' : 'success',
        },
      )
    },
    [appId, canManageAccessPoint, t, updateSiteConfig],
  )

  return {
    refreshAppDetail,
    saveSiteConfig,
  }
}
