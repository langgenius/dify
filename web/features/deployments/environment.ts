import type { AppDeployEnvironment } from '@dify/contracts/enterprise/types.gen'

export function environmentId(environment?: AppDeployEnvironment) {
  return environment?.id ?? ''
}

export function environmentName(environment?: AppDeployEnvironment) {
  return environment?.name || environment?.id || '—'
}

export function environmentMode(environment?: AppDeployEnvironment) {
  const type = environment?.type?.toLowerCase() ?? ''
  return type.includes('isolated') ? 'isolated' : 'shared'
}

function environmentRuntimeName(environment?: AppDeployEnvironment) {
  return environment?.backend ?? ''
}

export function environmentBackend(environment?: AppDeployEnvironment) {
  const runtime = environmentRuntimeName(environment).toLowerCase()
  return runtime.includes('host') ? 'host' : 'k8s'
}

export function environmentHealth(environment?: AppDeployEnvironment) {
  const status = environment?.status?.toLowerCase() ?? ''
  return status.includes('ready') ? 'ready' : 'degraded'
}
