'use client'

import type { AccessPointStatus } from '@/app/components/base/access-point/status'
import { useTranslation } from 'react-i18next'

export function useAccessPointStatusLabel(status: AccessPointStatus) {
  const { t } = useTranslation()
  const labels: Record<AccessPointStatus, string> = {
    disabled: t(($) => $['overview.status.disable'], { ns: 'appOverview' }),
    inService: t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' }),
    loading: t(($) => $.loading, { ns: 'common' }),
    unavailable: t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' }),
    unsupported: t(($) => $['studio.accessPoint.notSupported'], { ns: 'deployments' }),
  }

  return labels[status]
}
