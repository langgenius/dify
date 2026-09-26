'use client'

import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

export function useAccessPointActions(appId: string, canManageAccessPoint: boolean) {
  const { t } = useTranslation(['common'])
  const { mutateAsync: updateSite } = useMutation(
    consoleQuery.apps.byAppId.site.post.mutationOptions(),
  )
  const saveSiteConfig = useCallback(
    async (params: AppSiteUpdatePayload) => {
      if (!canManageAccessPoint) return
      try {
        await updateSite({ params: { app_id: appId }, body: params })
        toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      } catch {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      }
    },
    [appId, canManageAccessPoint, t, updateSite],
  )

  return { saveSiteConfig }
}
