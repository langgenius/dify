'use client'

import type { DeploymentUiStatus } from '../../runtime-status'
import type { ReleaseDeployment } from './release-deployments'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import {
  deploymentStatusToneClassNames,
} from '../../deployment-ui-utils'

const RELEASE_DEPLOYMENT_STATUS: Record<ReleaseDeployment['state'], DeploymentUiStatus> = {
  active: 'ready',
  deploying: 'deploying',
  failed: 'deploy_failed',
}

export function DeployedToBadge({ item }: {
  item: ReleaseDeployment
}) {
  const { t } = useTranslation('deployments')
  const statusLabel = t(`versions.deployedStatus.${item.state}`)
  const status = RELEASE_DEPLOYMENT_STATUS[item.state]
  const toneClassNames = deploymentStatusToneClassNames(status)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className={cn(
              'inline-flex h-5 max-w-full cursor-default items-center gap-1 rounded-md border px-1.5 system-xs-medium',
              toneClassNames.badge,
            )}
          >
            <span
              aria-hidden
              className={cn('size-1.5 shrink-0 rounded-full', toneClassNames.dot, status === 'deploying' && 'animate-pulse')}
            />
            <span className="truncate">{item.environmentName}</span>
            <span className="shrink-0 opacity-70">·</span>
            <span className="shrink-0 system-2xs-medium-uppercase">{statusLabel}</span>
          </span>
        )}
      />
      <TooltipContent>
        {statusLabel}
        {' · '}
        {item.environmentName}
      </TooltipContent>
    </Tooltip>
  )
}
