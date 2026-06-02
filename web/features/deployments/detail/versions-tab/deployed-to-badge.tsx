'use client'

import type { DeploymentUiStatus } from '../../runtime-status'
import type { ReleaseDeployment } from './release-deployments'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import {
  deploymentStatusIconClassName,
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
              'inline-flex h-6 max-w-full cursor-default items-center gap-1.5 rounded-md border px-2 system-xs-medium',
              toneClassNames.badge,
            )}
          >
            <span
              aria-hidden
              className={cn('size-3.5 shrink-0', deploymentStatusIconClassName(status), toneClassNames.icon)}
            />
            <span className="truncate">{item.environmentName}</span>
            <span className="shrink-0 opacity-70">·</span>
            <span className="shrink-0">{statusLabel}</span>
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
