'use client'

import type { DeploymentStatus as DeploymentStatusValue } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import { DeploymentStatus as DeploymentStatusEnum } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'

const STATUS_TEXT_CLASS_NAMES: Record<DeploymentStatusValue, string> = {
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_UNSPECIFIED]: 'text-text-tertiary',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYED]: 'text-text-tertiary',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_DEPLOYING]: 'text-util-colors-blue-light-blue-light-600',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_RUNNING]: 'text-util-colors-green-green-600',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYING]:
    'text-util-colors-blue-light-blue-light-600',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_INVALID]: 'text-util-colors-red-red-600',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_FAILED]: 'text-util-colors-red-red-600',
}

const STATUS_DOT: Partial<Record<DeploymentStatusValue, StatusDotStatus>> = {
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_UNSPECIFIED]: 'disabled',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYED]: 'disabled',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_RUNNING]: 'success',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_INVALID]: 'error',
  [DeploymentStatusEnum.DEPLOYMENT_STATUS_FAILED]: 'error',
}

function getStatusLabel(
  status: DeploymentStatusValue,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  switch (status) {
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_DEPLOYING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_DEPLOYING'])
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_RUNNING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_READY'])
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING'])
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_FAILED:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_FAILED'])
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_INVALID:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_INVALID'])
    case DeploymentStatusEnum.DEPLOYMENT_STATUS_UNSPECIFIED:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNSPECIFIED'])
    default:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYED'])
  }
}

export function DeploymentStatus({ status }: { status?: DeploymentStatusValue }) {
  const { t } = useTranslation('deployments')
  const resolvedStatus = status ?? DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYED
  const label = getStatusLabel(resolvedStatus, t)
  const isInProgress =
    resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_DEPLOYING ||
    resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYING

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 system-xs-semibold-uppercase',
        STATUS_TEXT_CLASS_NAMES[resolvedStatus],
      )}
    >
      {isInProgress ? (
        <span aria-hidden className="i-ri-loader-2-line size-4 shrink-0 animate-spin" />
      ) : (
        <StatusDot size="small" status={STATUS_DOT[resolvedStatus]} />
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}
