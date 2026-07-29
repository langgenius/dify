'use client'

import type { AccessPoint } from '@/app/components/app/deploy/mock-data'
import { useTranslation } from 'react-i18next'
import { MOCK_ENVIRONMENT_DEPLOYMENTS } from '@/app/components/app/deploy/mock-data'
import { AccessPointCard, AccessPointEmptyContent, AccessPointEndpoint } from './access-point-card'

const ACCESS_POINT_CONFIG: Record<
  AccessPoint,
  {
    description: 'api' | 'mcp' | 'trigger' | 'webApp'
    icon: string
    title: 'api' | 'mcp' | 'trigger' | 'webApp'
  }
> = {
  webApp: {
    description: 'webApp',
    icon: 'i-ri-robot-2-line',
    title: 'webApp',
  },
  serviceApi: {
    description: 'api',
    icon: 'i-custom-vender-knowledge-api-aggregate',
    title: 'api',
  },
  mcp: {
    description: 'mcp',
    icon: 'i-custom-vender-integrations-mcp',
    title: 'mcp',
  },
  trigger: {
    description: 'trigger',
    icon: 'i-custom-vender-integrations-trigger',
    title: 'trigger',
  },
}

const ACCESS_POINT_ORDER: AccessPoint[] = ['webApp', 'serviceApi', 'mcp', 'trigger']

type DeployedEnvironmentAccessPointsProps = {
  environmentId: string
}

export function DeployedEnvironmentAccessPoints({
  environmentId,
}: DeployedEnvironmentAccessPointsProps) {
  const { t } = useTranslation()
  const deployment = MOCK_ENVIRONMENT_DEPLOYMENTS.find(
    (candidate) => candidate.id === environmentId,
  )

  const title = (accessPoint: AccessPoint) => {
    const key = ACCESS_POINT_CONFIG[accessPoint].title
    if (key === 'webApp') return t(($) => $['agentDetail.access.webApp.title'], { ns: 'agentV2' })
    if (key === 'api') return t(($) => $['agentDetail.access.serviceApi.title'], { ns: 'agentV2' })
    if (key === 'mcp') return t(($) => $['mcp.server.title'], { ns: 'tools' })
    return t(($) => $['settings.trigger'], { ns: 'common' })
  }

  const description = (accessPoint: AccessPoint) => {
    const key = ACCESS_POINT_CONFIG[accessPoint].description
    if (key === 'webApp')
      return t(($) => $['studio.accessPoint.webAppDescription'], {
        ns: 'deployments',
      })
    if (key === 'api')
      return t(($) => $['studio.accessPoint.apiDescription'], {
        ns: 'deployments',
      })
    if (key === 'mcp')
      return t(($) => $['studio.accessPoint.mcpDescription'], {
        ns: 'deployments',
      })
    return t(($) => $['studio.accessPoint.triggerDescription'], {
      ns: 'deployments',
    })
  }

  const endpointLabel = (accessPoint: Exclude<AccessPoint, 'trigger'>) => {
    if (accessPoint === 'webApp')
      return t(($) => $['agentDetail.access.webApp.accessUrl'], { ns: 'agentV2' })
    if (accessPoint === 'serviceApi')
      return t(($) => $['overview.apiInfo.accessibleAddress'], { ns: 'appOverview' })
    return t(($) => $['mcp.server.url'], { ns: 'tools' })
  }

  return (
    <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
      {ACCESS_POINT_ORDER.map((accessPoint) => {
        const inService =
          deployment?.status === 'running' && deployment.accessPoints.includes(accessPoint)
        const statusLabel = inService
          ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
          : t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' })

        return (
          <AccessPointCard
            key={accessPoint}
            title={title(accessPoint)}
            description={description(accessPoint)}
            icon={ACCESS_POINT_CONFIG[accessPoint].icon}
            status={inService ? 'inService' : 'unavailable'}
            statusLabel={statusLabel}
          >
            {accessPoint === 'trigger' ? (
              <AccessPointEmptyContent>
                {t(($) => $['studio.accessPoint.triggerServiceModeUnavailable'], {
                  ns: 'deployments',
                })}
              </AccessPointEmptyContent>
            ) : (
              <AccessPointEndpoint
                label={endpointLabel(accessPoint)}
                value=""
                unavailableLabel={statusLabel}
                loading
              />
            )}
          </AccessPointCard>
        )
      })}
    </div>
  )
}
