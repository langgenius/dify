'use client'

import type { AccessPointAvailability } from '../shared/access-point-status'
import type { AccessPointAppInfo } from '../shared/utils'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { getAccessPointStatus } from '../shared/access-point-status'
import { ServiceApiCardView } from '../shared/service-api-card-view'
import { getBuiltInAccessUrls } from '../shared/utils'

type ServiceApiAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: AccessPointAvailability
  canManage: boolean
  highlighted?: boolean
  onAppStateChanged: () => Promise<void>
}

export function ServiceApiAccessPointCard({
  appInfo,
  availability,
  canManage,
  highlighted,
  onAppStateChanged,
}: ServiceApiAccessPointCardProps) {
  const { t } = useTranslation()
  const updateApiStatus = useMutation(
    consoleQuery.apps.byAppId.apiEnable.post.mutationOptions({
      onSuccess: onAppStateChanged,
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const { api: apiUrl } = getBuiltInAccessUrls(appInfo)
  const running = availability === 'available' && appInfo.enable_api
  const status = getAccessPointStatus(availability, running)

  const handleStatusChange = (enabled: boolean) => {
    if (!canManage) return

    updateApiStatus.mutate({
      params: { app_id: appInfo.id },
      body: { enable_api: enabled },
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
      switchLoading={updateApiStatus.isPending}
      onEnabledChange={availability === 'available' ? handleStatusChange : undefined}
    />
  )
}
