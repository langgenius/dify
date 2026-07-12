import type { RuntimeInstanceStatus as RuntimeInstanceStatusValue } from '@dify/contracts/enterprise/types.gen'
import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'

type DeploymentStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
type DeploymentStatusLabelKey = `status.${RuntimeInstanceStatusValue}`

const STATUS_TONE: Record<RuntimeInstanceStatusValue, DeploymentStatusTone> = {
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED]: 'neutral',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED]: 'neutral',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING]: 'info',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY]: 'success',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED]: 'danger',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED]: 'warning',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID]: 'danger',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING]: 'info',
}

const STATUS_DOT_STATUS: Record<RuntimeInstanceStatusValue, StatusDotStatus> = {
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED]: 'disabled',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED]: 'disabled',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING]: 'normal',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY]: 'success',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED]: 'error',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED]: 'warning',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID]: 'error',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING]: 'normal',
}

const STATUS_DOT_TEXT_CLASS_NAMES: Record<StatusDotStatus, string> = {
  disabled: 'text-text-tertiary',
  error: 'text-util-colors-red-red-600',
  normal: 'text-util-colors-blue-light-blue-light-600',
  success: 'text-util-colors-green-green-600',
  warning: 'text-util-colors-warning-warning-600',
}

const TONE_CLASS_NAMES: Record<DeploymentStatusTone, { badge: string; dot: string }> = {
  danger: {
    badge: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
    dot: 'bg-util-colors-red-red-500',
  },
  info: {
    badge:
      'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
    dot: 'bg-util-colors-blue-blue-500',
  },
  neutral: {
    badge: 'border-divider-subtle bg-background-section-burn text-text-tertiary',
    dot: 'bg-text-quaternary',
  },
  success: {
    badge:
      'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
    dot: 'bg-util-colors-green-green-500',
  },
  warning: {
    badge:
      'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
    dot: 'bg-util-colors-warning-warning-500',
  },
}

export function deploymentStatusLabelKey(
  status: RuntimeInstanceStatusValue,
): DeploymentStatusLabelKey {
  return `status.${status}`
}

function deploymentStatusTone(status: RuntimeInstanceStatusValue) {
  return STATUS_TONE[status]
}

export function deploymentStatusToneClassNames(status: RuntimeInstanceStatusValue) {
  return TONE_CLASS_NAMES[deploymentStatusTone(status)]
}

export function deploymentStatusDotStatus(status: RuntimeInstanceStatusValue) {
  return STATUS_DOT_STATUS[status]
}

export function deploymentStatusDotTextClassName(status: RuntimeInstanceStatusValue) {
  return STATUS_DOT_TEXT_CLASS_NAMES[deploymentStatusDotStatus(status)]
}
