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

export function DeploymentStatus({ status }: { status?: DeploymentStatusValue }) {
  const { t } = useTranslation('deployments')
  const resolvedStatus = status ?? DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYED
  const label =
    resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_DEPLOYING
      ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_DEPLOYING'])
      : resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_RUNNING
        ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_READY'])
        : resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_UNDEPLOYING
          ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING'])
          : resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_FAILED
            ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_FAILED'])
            : resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_INVALID
              ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_INVALID'])
              : resolvedStatus === DeploymentStatusEnum.DEPLOYMENT_STATUS_UNSPECIFIED
                ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNSPECIFIED'])
                : t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYED'])
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
