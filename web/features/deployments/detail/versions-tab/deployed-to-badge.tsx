'use client'

import type { ReleaseDeployment, ReleaseDeploymentState } from './release-deployments'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

const RELEASE_DEPLOYMENT_STYLES: Record<ReleaseDeploymentState, string> = {
  active: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
  deploying: 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
  failed: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
}

export function DeployedToBadge({ item }: {
  item: ReleaseDeployment
}) {
  const { t } = useTranslation('deployments')
  const statusLabel = t(`versions.deployedStatus.${item.state}`)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs',
              RELEASE_DEPLOYMENT_STYLES[item.state],
            )}
          >
            {item.state === 'deploying'
              ? <span className="i-ri-loader-4-line size-3.5 animate-spin" />
              : item.state === 'failed'
                ? <span className="i-ri-alert-line size-3.5" />
                : <span className="size-1.5 rounded-full bg-current" />}
            {item.environmentName}
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
