import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'

export function createDeploymentTargetEnvironment({
  environments,
  selectedEnvironmentId,
}: {
  environments: Environment[]
  selectedEnvironmentId: string
}) {
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined

  return {
    effectiveSelectedEnvironmentId,
    selectedEnvironment,
  }
}
