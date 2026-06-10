export function canDeployToTarget({
  hasUnsupportedDslNodes,
  isBindingError,
  isBindingLoading,
  isEnvironmentError,
  isEnvironmentLoading,
  isInitialReleaseReady,
  requiredBindingsReady,
  requiredEnvVarsReady,
  selectedEnvironmentId,
  shouldLoadDeploymentTarget,
}: {
  hasUnsupportedDslNodes: boolean
  isBindingError: boolean
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  isInitialReleaseReady: boolean
  requiredBindingsReady: boolean
  requiredEnvVarsReady: boolean
  selectedEnvironmentId?: string
  shouldLoadDeploymentTarget: boolean
}) {
  const deploymentTargetReady = shouldLoadDeploymentTarget
    && !isEnvironmentLoading
    && !isEnvironmentError
    && !isBindingLoading
    && !isBindingError
    && !hasUnsupportedDslNodes

  return Boolean(
    selectedEnvironmentId
    && deploymentTargetReady
    && requiredBindingsReady
    && requiredEnvVarsReady
    && isInitialReleaseReady,
  )
}

export function canSkipDeployment({
  hasUnsupportedDslNodes,
  isBindingError,
  isInitialReleaseReady,
}: {
  hasUnsupportedDslNodes: boolean
  isBindingError: boolean
  isInitialReleaseReady: boolean
}) {
  return Boolean(
    isInitialReleaseReady
    && !isBindingError
    && !hasUnsupportedDslNodes,
  )
}
