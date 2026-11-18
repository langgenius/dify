'use client'

import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { SuspensionNotice } from '@/app/components/app/deploy/shared/suspension-notice'
import { EnvironmentMcpCard } from './environment-mcp-card'
import { EnvironmentServiceApiCard } from './environment-service-api-card'
import { EnvironmentTriggerCard } from './environment-trigger-card'
import { EnvironmentWebAppCard } from './environment-web-app-card'

type DeployedEnvironmentAccessPointsProps = {
  appId: string
  environmentId: string
  canManageAccessPoint: boolean
  canDeploy?: boolean
  highlightedAccessPoint?: AccessPoint | null
}

export function DeployedEnvironmentAccessPoints({
  appId,
  environmentId,
  canManageAccessPoint,
  canDeploy = false,
  highlightedAccessPoint,
}: DeployedEnvironmentAccessPointsProps) {
  return (
    <div className="flex flex-col gap-3">
      <SuspensionNotice
        appId={appId}
        environmentId={environmentId}
        accessPoint
        canDeploy={canDeploy}
      />
      <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
        <EnvironmentWebAppCard
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'webApp'}
        />
        <EnvironmentServiceApiCard
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'serviceApi'}
        />
        <EnvironmentMcpCard
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'mcp'}
        />
        <EnvironmentTriggerCard
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'trigger'}
        />
      </div>
    </div>
  )
}
