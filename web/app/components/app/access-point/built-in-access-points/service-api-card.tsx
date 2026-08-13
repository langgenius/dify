'use client'

import type { AccessPointAvailability } from '../shared/access-point-status'
import type { AccessPointAppInfo } from '../shared/utils'
import { getAccessPointStatus } from '../shared/access-point-status'
import { ServiceApiCardView } from '../shared/service-api-card-view'
import { getBuiltInAccessUrls } from '../shared/utils'

type ServiceApiAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: AccessPointAvailability
  canManage: boolean
  highlighted?: boolean
  onChangeStatus: (enabled: boolean) => Promise<void>
}

export function ServiceApiAccessPointCard({
  appInfo,
  availability,
  canManage,
  highlighted,
  onChangeStatus,
}: ServiceApiAccessPointCardProps) {
  const { api: apiUrl } = getBuiltInAccessUrls(appInfo)
  const running = availability === 'available' && appInfo.enable_api
  const status = getAccessPointStatus(availability, running)

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
      onEnabledChange={availability === 'available' ? onChangeStatus : undefined}
    />
  )
}
