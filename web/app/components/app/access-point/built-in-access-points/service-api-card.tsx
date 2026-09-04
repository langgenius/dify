'use client'

import type { AccessPointAppInfo } from '../shared/utils'
import type { AccessPointAvailability } from '@/app/components/base/access-point/status'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getAccessPointStatus } from '@/app/components/base/access-point/status'
import { consoleQuery } from '@/service/client'
import { ServiceApiCardView } from '../shared/service-api-card-view'
import { getBuiltInAccessUrls } from '../shared/utils'

type ServiceApiAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: AccessPointAvailability
  canManage: boolean
  highlighted?: boolean
}

export function ServiceApiAccessPointCard({
  appInfo,
  availability,
  canManage,
  highlighted,
}: ServiceApiAccessPointCardProps) {
  const { t } = useTranslation()
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const toggleApiMutation = useMutation(
    consoleQuery.apps.byAppId.apiEnable.post.mutationOptions({
      scope: {
        id: `app-service-api-toggle:${appInfo.id}`,
      },
      onSuccess: (updatedApp) => {
        const currentAppDetail = useAppStore.getState().appDetail
        if (!currentAppDetail || currentAppDetail.id !== appInfo.id) return

        setAppDetail({
          ...currentAppDetail,
          enable_api: updatedApp.enable_api,
          updated_at: updatedApp.updated_at ?? currentAppDetail.updated_at,
        })
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const { api: apiUrl } = getBuiltInAccessUrls(appInfo)
  const pendingEnabled = toggleApiMutation.variables?.body.enable_api
  const optimisticEnabled =
    toggleApiMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : appInfo.enable_api
  const running = availability === 'available' && optimisticEnabled
  const status = getAccessPointStatus(availability, running)

  const handleEnabledChange = (enabled: boolean) => {
    if (!canManage) return

    toggleApiMutation.mutate({
      params: {
        app_id: appInfo.id,
      },
      body: {
        enable_api: enabled,
      },
    })
  }

  return (
    <ServiceApiCardView
      apiKeyButtonProps={{
        appId: appInfo.id,
        canManage,
        disabled: availability !== 'available',
      }}
      apiUrl={apiUrl}
      appMode={appInfo.mode}
      available={availability === 'available'}
      status={status}
      highlighted={highlighted}
      switchDisabled={!canManage}
      onEnabledChange={availability === 'available' ? handleEnabledChange : undefined}
    />
  )
}
