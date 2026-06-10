'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import {
  canContinueGuideStep,
  canSkipDeploymentGuideStep,
} from '../models/guide-readiness'
import { useSubmittedReleaseReadiness } from '../models/release'
import { useTargetStepSourceSnapshot } from '../models/source'
import { useDeploymentTargetActionSnapshot } from '../queries/target'
import {
  unsupportedDslNodesAtom,
} from '../state/unsupported-dsl-atoms'
import { setStepAtom } from '../state/workflow-atoms'
import { useCreateDeploymentSubmission } from '../submission'

export function useCreateDeploymentGuideTargetAction() {
  const source = useTargetStepSourceSnapshot()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const release = useSubmittedReleaseReadiness({
    isSourceReady: source.isSourceReady,
  })
  const targetActionState = useDeploymentTargetActionSnapshot({
    effectiveSelectedApp: source.effectiveSelectedApp,
    shouldResolveDeploymentTarget: true,
  })
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const canDeploy = canContinueGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: targetActionState.deploymentOptionsQuery.isError,
    isBindingLoading: targetActionState.isBindingLoading,
    isEnvironmentError: targetActionState.deployableEnvironmentsQuery.isError,
    isEnvironmentLoading: targetActionState.isEnvironmentLoading,
    isInitialReleaseReady: release.isInitialReleaseReady,
    isSourceReady: source.isSourceReady,
    requiredBindingsReady: targetActionState.requiredBindingsReady,
    requiredEnvVarsReady: targetActionState.requiredEnvVarsReady,
    selectedEnvironmentId: targetActionState.selectedEnvironment?.id,
    shouldLoadDeploymentTarget: targetActionState.shouldLoadDeploymentTarget,
    step: 'target',
  })
  const canSkipDeployment = canSkipDeploymentGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: targetActionState.deploymentOptionsQuery.isError,
    isInitialReleaseReady: release.isInitialReleaseReady,
    step: 'target',
  })
  const {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  } = useCreateDeploymentSubmission({
    effectiveSelectedApp: source.effectiveSelectedApp,
    hasInstanceNameConflict: release.hasInstanceNameConflict,
    isInitialReleaseReady: release.isInitialReleaseReady,
    targetSubmissionState: targetActionState,
  })

  function handleBack() {
    if (!isDeploying)
      setStep('release')
  }

  async function handleDeploy() {
    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return {
    canDeploy,
    canSkipDeployment,
    handleBack,
    handleDeploy,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment: isSkippingReleaseOnly,
  }
}
