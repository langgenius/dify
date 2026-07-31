'use client'

import type { AccessPoint } from '@/app/components/app/deploy/access-point'
import { useTranslation } from 'react-i18next'
import { AccessPointCard, AccessPointEmptyContent, AccessPointEndpoint } from './access-point-card'
import { EnvironmentServiceApiCard } from './environment-service-api-card'
import { EnvironmentWebAppCard } from './environment-web-app-card'

const ACCESS_POINT_CONFIG: Record<
  Exclude<AccessPoint, 'serviceApi' | 'webApp'>,
  {
    description: 'mcp' | 'trigger'
    icon: string
    title: 'mcp' | 'trigger'
  }
> = {
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

const UNAVAILABLE_ACCESS_POINTS = ['mcp', 'trigger'] as const

type DeployedEnvironmentAccessPointsProps = {
  appId: string
  environmentId: string
  canEdit: boolean
  canManage: boolean
  highlightedAccessPoint?: AccessPoint | null
}

export function DeployedEnvironmentAccessPoints({
  appId,
  environmentId,
  canEdit,
  canManage,
  highlightedAccessPoint,
}: DeployedEnvironmentAccessPointsProps) {
  const { t } = useTranslation()

  const title = (accessPoint: (typeof UNAVAILABLE_ACCESS_POINTS)[number]) => {
    const key = ACCESS_POINT_CONFIG[accessPoint].title
    if (key === 'mcp') return t(($) => $['mcp.server.title'], { ns: 'tools' })
    return t(($) => $['settings.trigger'], { ns: 'common' })
  }

  const description = (accessPoint: (typeof UNAVAILABLE_ACCESS_POINTS)[number]) => {
    const key = ACCESS_POINT_CONFIG[accessPoint].description
    if (key === 'mcp')
      return t(($) => $['studio.accessPoint.mcpDescription'], {
        ns: 'deployments',
      })
    return t(($) => $['studio.accessPoint.triggerDescription'], {
      ns: 'deployments',
    })
  }

  return (
    <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
      <EnvironmentWebAppCard
        appId={appId}
        environmentId={environmentId}
        canEdit={canEdit}
        canManage={canManage}
        highlighted={highlightedAccessPoint === 'webApp'}
      />
      <EnvironmentServiceApiCard
        appId={appId}
        environmentId={environmentId}
        canManage={canManage}
        highlighted={highlightedAccessPoint === 'serviceApi'}
      />
      {UNAVAILABLE_ACCESS_POINTS.map((accessPoint) => {
        const statusLabel = t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
          ns: 'deployments',
        })

        return (
          <AccessPointCard
            key={accessPoint}
            title={title(accessPoint)}
            description={description(accessPoint)}
            icon={ACCESS_POINT_CONFIG[accessPoint].icon}
            status="unavailable"
            statusLabel={statusLabel}
            highlighted={highlightedAccessPoint === accessPoint}
          >
            {accessPoint === 'trigger' ? (
              <AccessPointEmptyContent>
                {t(($) => $['studio.accessPoint.triggerServiceModeUnavailable'], {
                  ns: 'deployments',
                })}
              </AccessPointEmptyContent>
            ) : (
              <AccessPointEndpoint
                label={t(($) => $['mcp.server.url'], { ns: 'tools' })}
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
