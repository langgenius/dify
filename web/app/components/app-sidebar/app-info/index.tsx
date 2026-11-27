import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { consoleClient, consoleQuery } from '@/service/console'
import { createAppInfoDialogHandles } from './app-info-dialog-handles'
import { AppInfoDialogs } from './app-info-dialogs'
import { AppInfoTrigger } from './app-info-trigger'
import { updateCachedAppMetadata } from './metadata'

type AppInfoViewProps = { appDetail: AppDetailWithSite; expand: boolean }

export function AppInfoView({ appDetail, expand }: AppInfoViewProps) {
  const appId = appDetail.id
  const queryClient = useQueryClient()
  const [handles] = useState(createAppInfoDialogHandles)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let disposed = false

    void import('@/app/components/workflow/collaboration/core/collaboration-manager')
      .then(({ collaborationManager }) => {
        if (disposed) return

        unsubscribe = collaborationManager.onAppMetaUpdate(async () => {
          try {
            const res = await consoleClient.apps.byAppId.get({ params: { app_id: appId } })
            if (disposed) return
            queryClient.setQueryData(
              consoleQuery.apps.byAppId.get.queryKey({
                input: { params: { app_id: appId } },
              }),
              (cachedApp) => updateCachedAppMetadata(cachedApp, res),
            )
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
          } catch (error) {
            console.error('failed to refresh app detail from collaboration update:', error)
          }
        })
      })
      .catch(() => {})

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [appId, queryClient])

  return (
    <>
      <AppInfoTrigger appDetail={appDetail} expand={expand} handles={handles} />
      <AppInfoDialogs appDetail={appDetail} handles={handles} />
    </>
  )
}
