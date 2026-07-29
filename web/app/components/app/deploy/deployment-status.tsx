'use client'

import type { MockDeploymentStatus } from './mock-data'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'

const STATUS_TEXT_CLASS_NAMES: Record<MockDeploymentStatus, string> = {
  deploying: 'text-util-colors-blue-light-blue-light-600',
  failed: 'text-util-colors-red-red-600',
  running: 'text-util-colors-green-green-600',
}

export function DeploymentStatus({ status }: { status: MockDeploymentStatus }) {
  const { t } = useTranslation('deployments')
  const label =
    status === 'deploying'
      ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_DEPLOYING'])
      : status === 'failed'
        ? t(($) => $['status.RUNTIME_INSTANCE_STATUS_FAILED'])
        : t(($) => $['status.RUNTIME_INSTANCE_STATUS_READY'])

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 system-xs-semibold-uppercase',
        STATUS_TEXT_CLASS_NAMES[status],
      )}
    >
      {status === 'deploying' ? (
        <span aria-hidden className="i-ri-loader-2-line size-4 shrink-0 animate-spin" />
      ) : (
        <StatusDot size="small" status={status === 'failed' ? 'error' : 'success'} />
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}
