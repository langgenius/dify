import type { Environment } from '@dify/contracts/enterprise/types.gen'

const ENVIRONMENT_MODE_ISOLATED = 'ENVIRONMENT_MODE_ISOLATED' satisfies NonNullable<Environment['mode']>
const RUNTIME_BACKEND_EXTERNAL = 'RUNTIME_BACKEND_EXTERNAL' satisfies NonNullable<Environment['backend']>
const ENVIRONMENT_STATUS_READY = 'ENVIRONMENT_STATUS_READY' satisfies NonNullable<Environment['status']>
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function environmentId(environment?: Environment) {
  return environment?.id ?? ''
}

export function environmentDeploymentId(environment?: Environment) {
  const id = environment?.id?.trim()

  return id && UUID_PATTERN.test(id) ? id : ''
}

export function environmentMatchesIdentifier(environment: Environment | undefined, identifier: string) {
  const normalizedIdentifier = identifier.trim()
  if (!environment || !normalizedIdentifier)
    return false

  return environment.id === normalizedIdentifier || environment.name === normalizedIdentifier
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
