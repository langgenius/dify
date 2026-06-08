import type { GuideStep } from './types'

export function canContinueGuideStep({
  hasUnsupportedDslNodes,
  isBindingError,
  isBindingLoading,
  isEnvironmentError,
  isEnvironmentLoading,
  isInitialReleaseReady,
  isSourceReady,
  requiredBindingsReady,
  requiredEnvVarsReady,
  selectedEnvironmentId,
  shouldLoadDeploymentTarget,
  step,
}: {
  hasUnsupportedDslNodes: boolean
  isBindingError: boolean
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  isInitialReleaseReady: boolean
  isSourceReady: boolean
  requiredBindingsReady: boolean
  requiredEnvVarsReady: boolean
  selectedEnvironmentId?: string
  shouldLoadDeploymentTarget: boolean
  step: GuideStep
}) {
  if (step === 'source')
    return isSourceReady && !hasUnsupportedDslNodes
  if (step === 'release')
    return isInitialReleaseReady && !hasUnsupportedDslNodes
  if (step !== 'target')
    return false

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

export function canSkipDeploymentGuideStep({
  hasUnsupportedDslNodes,
  isBindingError,
  isInitialReleaseReady,
  step,
}: {
  hasUnsupportedDslNodes: boolean
  isBindingError: boolean
  isInitialReleaseReady: boolean
  step: GuideStep
}) {
  return Boolean(
    step === 'target'
    && isInitialReleaseReady
    && !isBindingError
    && !hasUnsupportedDslNodes,
  )
}
