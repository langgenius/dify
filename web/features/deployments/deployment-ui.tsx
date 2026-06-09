'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { ComponentPropsWithRef } from 'react'
import type { DeploymentUiStatus } from './runtime-status'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  deploymentStatusLabelKey,
  deploymentStatusToneClassNames,
} from './deployment-ui-utils'
import { environmentName } from './environment'
import { deploymentStatus } from './runtime-status'

type DeploymentStatusBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  status: DeploymentUiStatus
  label: string
}

export function DeploymentStatusBadge({
  status,
  label,
  className,
  ref,
  ...props
}: DeploymentStatusBadgeProps) {
  const toneClassNames = deploymentStatusToneClassNames(status)
  const isInProgress = status === 'deploying' || status === 'undeploying'

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex h-5 max-w-full cursor-default items-center gap-1 rounded-md border px-1.5 system-2xs-medium-uppercase',
        toneClassNames.badge,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', toneClassNames.dot, isInProgress && 'animate-pulse')}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

type EnvironmentDeploymentBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children' | 'title'> & {
  row: EnvironmentDeployment
  showStatus?: boolean
  summaryLabel?: string
}

export function EnvironmentDeploymentBadge({
  row,
  className,
  showStatus = true,
  summaryLabel,
  'aria-label': ariaLabel,
  ref,
  ...props
}: EnvironmentDeploymentBadgeProps) {
  const { t } = useTranslation('deployments')
  const name = environmentName(row.environment)
  const status = deploymentStatus(row)
  const toneClassNames = deploymentStatusToneClassNames(status)
  const isInProgress = status === 'deploying' || status === 'undeploying'
  const statusLabel = t(deploymentStatusLabelKey(status))
  const label = summaryLabel ?? `${name} · ${statusLabel}`
  const visibleLabel = showStatus ? `${name} · ${statusLabel}` : name

  return (
    <span
      ref={ref}
      aria-label={ariaLabel ?? label}
      className={cn(
        'inline-flex h-5 max-w-full cursor-default items-center gap-1 rounded-md border px-1.5 system-xs-medium',
        toneClassNames.badge,
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', toneClassNames.dot, isInProgress && 'animate-pulse')} />
      <span className="truncate">{visibleLabel}</span>
    </span>
  )
}
