'use client'

import type { RuntimeState as RuntimeStateValue } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import { RuntimeState } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'

type RuntimeStateIndicatorProps = {
  runtimeState: RuntimeStateValue
}

const RUNTIME_STATE_TEXT_CLASS_NAMES: Record<RuntimeStateValue, string> = {
  [RuntimeState.RUNTIME_STATE_UNSPECIFIED]: 'text-text-tertiary',
  [RuntimeState.RUNTIME_STATE_UNDEPLOYED]: 'text-text-tertiary',
  [RuntimeState.RUNTIME_STATE_RUNNING]: 'text-util-colors-green-green-600',
  [RuntimeState.RUNTIME_STATE_STARTING]: 'text-util-colors-blue-light-blue-light-600',
  [RuntimeState.RUNTIME_STATE_STOPPING]: 'text-util-colors-blue-light-blue-light-600',
  [RuntimeState.RUNTIME_STATE_ERROR]: 'text-util-colors-red-red-600',
  [RuntimeState.RUNTIME_STATE_UNKNOWN]: 'text-text-warning',
}

const RUNTIME_STATE_DOT: Partial<Record<RuntimeStateValue, StatusDotStatus>> = {
  [RuntimeState.RUNTIME_STATE_UNSPECIFIED]: 'disabled',
  [RuntimeState.RUNTIME_STATE_UNDEPLOYED]: 'disabled',
  [RuntimeState.RUNTIME_STATE_RUNNING]: 'success',
  [RuntimeState.RUNTIME_STATE_ERROR]: 'error',
  [RuntimeState.RUNTIME_STATE_UNKNOWN]: 'warning',
}

function getRuntimeStateLabel(
  runtimeState: RuntimeStateValue,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  switch (runtimeState) {
    case RuntimeState.RUNTIME_STATE_STARTING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_DEPLOYING'])
    case RuntimeState.RUNTIME_STATE_RUNNING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_READY'])
    case RuntimeState.RUNTIME_STATE_STOPPING:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING'])
    case RuntimeState.RUNTIME_STATE_ERROR:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_INVALID'])
    case RuntimeState.RUNTIME_STATE_UNKNOWN:
    case RuntimeState.RUNTIME_STATE_UNSPECIFIED:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNSPECIFIED'])
    case RuntimeState.RUNTIME_STATE_UNDEPLOYED:
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYED'])
    default: {
      const exhaustiveState: never = runtimeState
      return exhaustiveState
    }
  }
}

export function RuntimeStateIndicator({ runtimeState }: RuntimeStateIndicatorProps) {
  const { t } = useTranslation('deployments')
  const label = getRuntimeStateLabel(runtimeState, t)
  const isInProgress =
    runtimeState === RuntimeState.RUNTIME_STATE_STARTING ||
    runtimeState === RuntimeState.RUNTIME_STATE_STOPPING

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 system-xs-semibold-uppercase',
        RUNTIME_STATE_TEXT_CLASS_NAMES[runtimeState],
      )}
    >
      {isInProgress ? (
        <span
          aria-hidden
          className="i-ri-loader-2-line size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <StatusDot size="small" status={RUNTIME_STATE_DOT[runtimeState]} />
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}
