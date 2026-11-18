'use client'

import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SuspensionNotice } from '@/app/components/app/deploy/shared/suspension-notice'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
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
  const { t } = useTranslation(['common', 'deployments'])
  const docLink = useDocLink()
  // Whether the serving version starts from triggers; the MCP card reads the same query.
  const { data: servesTriggers = false } = useQuery(
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentMcpServer.queryOptions({
      input: { params: { app_id: appId, environment_id: environmentId } },
      select: (server) => Boolean(server.trigger_workflow),
    }),
  )

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
          servesTriggers={servesTriggers}
        />
        <EnvironmentServiceApiCard
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'serviceApi'}
          servesTriggers={servesTriggers}
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

      {servesTriggers && (
        <div className="mt-2 flex min-h-10 items-center gap-2 rounded-xl bg-background-section-burn px-3 py-2 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-information-line size-4 shrink-0" />
          <span>
            {t(($) => $['studio.accessPoint.triggerExclusiveNotice'], {
              ns: 'deployments',
            })}{' '}
            <Link
              href={docLink('/use-dify/nodes/start')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-accent hover:underline"
            >
              {t(($) => $['operation.learnMore'], { ns: 'common' })}
            </Link>
          </span>
        </div>
      )}
    </div>
  )
}
