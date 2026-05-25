'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type DeployStatus = 'ready' | 'deploying' | 'deploy_failed' | 'drifted' | 'invalid' | 'not_deployed' | 'unknown'
type EnvironmentMode = 'shared' | 'isolated'
type EnvironmentHealth = 'ready' | 'degraded'

const statusStyles: Record<DeployStatus, string> = {
  ready: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
  deploying: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
  deploy_failed: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
  drifted: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
  invalid: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
  not_deployed: 'border-divider-subtle bg-background-default-subtle text-text-tertiary',
  unknown: 'border-divider-subtle bg-background-default-subtle text-text-tertiary',
}

const statusKey = {
  ready: 'status.ready',
  deploying: 'status.deploying',
  deploy_failed: 'status.deployFailed',
  drifted: 'status.drifted',
  invalid: 'status.invalid',
  not_deployed: 'status.notDeployed',
  unknown: 'status.unknown',
} as const satisfies Record<DeployStatus, string>

const baseBadge = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 system-xs-medium whitespace-nowrap'

export function StatusBadge({ status, className }: {
  status: DeployStatus
  className?: string
}) {
  const { t } = useTranslation('deployments')
  return (
    <span className={cn(baseBadge, statusStyles[status], className)}>
      {status === 'deploying' && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {t(statusKey[status])}
    </span>
  )
}

export function ModeBadge({ mode, className }: {
  mode: EnvironmentMode
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const style = mode === 'shared'
    ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
    : 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700'
  return (
    <span className={cn(baseBadge, style, className)}>
      {t(mode === 'shared' ? 'mode.shared' : 'mode.isolated')}
    </span>
  )
}

export function HealthBadge({ health, className }: {
  health: EnvironmentHealth
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const style = health === 'ready'
    ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
    : 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700'
  return (
    <span className={cn(baseBadge, style, className)}>
      {t(health === 'ready' ? 'health.ready' : 'health.degraded')}
    </span>
  )
}
