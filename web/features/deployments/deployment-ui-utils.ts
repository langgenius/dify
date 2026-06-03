import type { DeploymentUiStatus } from './runtime-status'

type DeploymentStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const STATUS_TONE: Record<DeploymentUiStatus, DeploymentStatusTone> = {
  deploy_failed: 'danger',
  deploying: 'info',
  drifted: 'warning',
  invalid: 'danger',
  not_deployed: 'neutral',
  ready: 'success',
  unknown: 'neutral',
}

const TONE_CLASS_NAMES: Record<DeploymentStatusTone, { badge: string, dot: string }> = {
  danger: {
    badge: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
    dot: 'bg-util-colors-red-red-500',
  },
  info: {
    badge: 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
    dot: 'bg-util-colors-blue-blue-500',
  },
  neutral: {
    badge: 'border-divider-subtle bg-background-section-burn text-text-tertiary',
    dot: 'bg-text-quaternary',
  },
  success: {
    badge: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
    dot: 'bg-util-colors-green-green-500',
  },
  warning: {
    badge: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
    dot: 'bg-util-colors-warning-warning-500',
  },
}

const STATUS_LABEL_KEYS = {
  deploy_failed: 'status.deployFailed',
  deploying: 'status.deploying',
  drifted: 'status.drifted',
  invalid: 'status.invalid',
  not_deployed: 'status.notDeployed',
  ready: 'status.ready',
  unknown: 'status.unknown',
} as const satisfies Record<DeploymentUiStatus, string>

export function deploymentStatusLabelKey(status: DeploymentUiStatus) {
  return STATUS_LABEL_KEYS[status]
}

function deploymentStatusTone(status: DeploymentUiStatus) {
  return STATUS_TONE[status]
}

export function deploymentStatusToneClassNames(status: DeploymentUiStatus) {
  return TONE_CLASS_NAMES[deploymentStatusTone(status)]
}
