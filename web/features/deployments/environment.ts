import type { Environment } from '@dify/contracts/enterprise/types.gen'

const ENVIRONMENT_MODE_ISOLATED = 'ENVIRONMENT_MODE_ISOLATED' satisfies NonNullable<Environment['mode']>
const RUNTIME_BACKEND_EXTERNAL = 'RUNTIME_BACKEND_EXTERNAL' satisfies NonNullable<Environment['backend']>
const ENVIRONMENT_STATUS_READY = 'ENVIRONMENT_STATUS_READY' satisfies NonNullable<Environment['status']>

export function environmentId(environment?: Environment) {
  return environment?.id ?? ''
}

export function environmentName(environment?: Environment) {
  return environment?.name || environment?.id || '—'
}

export function environmentMode(environment?: Environment) {
  return environment?.mode === ENVIRONMENT_MODE_ISOLATED ? 'isolated' : 'shared'
}

export function environmentBackend(environment?: Environment) {
  return environment?.backend === RUNTIME_BACKEND_EXTERNAL ? 'host' : 'k8s'
}

export function environmentHealth(environment?: Environment) {
  return environment?.status === ENVIRONMENT_STATUS_READY ? 'ready' : 'degraded'
}
