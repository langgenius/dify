'use client'

import type {
  GuideMethod,
} from './types'
import type { App } from '@/types/app'
import { useTranslation } from 'react-i18next'
import { isWorkflowApp } from '../app-mode'
import {
  hasMissingRequiredEnvVarValue,
} from '../components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
} from '../components/runtime-credential-bindings-utils'
import {
  dslAppName,
  encodeDslContent,
} from '../dsl'
import { useDslFileReader } from '../use-dsl-file-reader'
import {
  createGuideSourceName,
  createGuideUnsupportedDslNodes,
  isCreateGuideDslUnsupportedMode,
  isCreateGuideInitialReleaseReady,
  isCreateGuideSourceReady,
} from './guide-derived-state'
import {
  canContinueGuideStep,
  canSkipDeploymentGuideStep,
} from './guide-readiness'
import {
  createCreationSectionsProps,
  createTargetReviewSectionsProps,
} from './guide-section-props'
import { useCreateDeploymentSubmission } from './use-create-deployment-submission'
import { useDeploymentGuideProgress } from './use-deployment-guide-progress'
import { useDeploymentGuideReleaseFields } from './use-deployment-guide-release-fields'
import { useDeploymentGuideSource } from './use-deployment-guide-source'
import { useDeploymentTargetOptions } from './use-deployment-target-options'

export function useCreateDeploymentGuide() {
  const { t } = useTranslation('deployments')

  const {
    clearSubmissionUnsupportedDslNodes,
    method,
    setMethod,
    setStep,
    setSubmissionUnsupportedDslNodes,
    step,
    submissionUnsupportedDslNodes,
  } = useDeploymentGuideProgress()
  const source = useDeploymentGuideSource()
  const dslFileReader = useDslFileReader()

  const hasDslContent = Boolean(dslFileReader.dslContent.trim())
  const dslUnsupportedMode = isCreateGuideDslUnsupportedMode({
    dslContent: dslFileReader.dslContent,
    dslReadError: dslFileReader.dslReadError,
    hasDslContent,
    isReadingDsl: dslFileReader.isReadingDsl,
    method,
  })
  const encodedDslContent = hasDslContent ? encodeDslContent(dslFileReader.dslContent) : ''
  const shouldResolveDeploymentTarget = step === 'target'
  const targetOptions = useDeploymentTargetOptions({
    dslContent: dslFileReader.dslContent,
    dslReadError: dslFileReader.dslReadError,
    dslUnsupportedMode,
    effectiveSelectedApp: source.effectiveSelectedApp,
    encodedDslContent,
    hasDslContent,
    isReadingDsl: dslFileReader.isReadingDsl,
    method,
    shouldResolveDeploymentTarget,
  })
  const unsupportedDslNodes = createGuideUnsupportedDslNodes({
    deploymentOptionsError: targetOptions.deploymentOptionsQuery.isError,
    deploymentOptionsUnsupportedDslNodes: targetOptions.unsupportedDslNodes,
    submissionUnsupportedDslNodes,
  })
  const requiredBindingsReady = targetOptions.bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, targetOptions.bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
  const requiredEnvVarsReady = targetOptions.envVarSlots.every(slot =>
    !hasMissingRequiredEnvVarValue(slot, targetOptions.effectiveEnvVarValues),
  )
  const dslDefaultAppName = dslFileReader.dslContent ? dslAppName(dslFileReader.dslContent) : ''
  const sourceName = createGuideSourceName({
    dslDefaultAppName,
    dslFallbackAppName: t('createGuide.dsl.defaultAppName'),
    method,
    selectedApp: source.effectiveSelectedApp,
  })
  const defaultedReleaseName = t('createGuide.release.defaultName')
  const releaseFields = useDeploymentGuideReleaseFields({
    defaultedReleaseName,
    existingInstanceNames: source.existingInstanceNames,
    onFieldChange: () => setStep('release'),
    sourceName,
  })
  const hasInstanceNameConflict = Boolean(
    releaseFields.submittedInstanceName
    && source.existingInstanceNames.includes(releaseFields.submittedInstanceName),
  )
  const instanceNameError = hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
  const isSourceReady = isCreateGuideSourceReady({
    dslReadError: dslFileReader.dslReadError,
    dslUnsupportedMode,
    hasDslContent,
    isReadingDsl: dslFileReader.isReadingDsl,
    method,
    selectedApp: source.effectiveSelectedApp,
  })
  const isInitialReleaseReady = isCreateGuideInitialReleaseReady({
    hasInstanceNameConflict,
    isSourceReady,
    submittedInstanceName: releaseFields.submittedInstanceName,
    submittedReleaseName: releaseFields.submittedReleaseName,
  })
  const showTargetConfiguration = step === 'target'
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const canContinue = canContinueGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: targetOptions.deploymentOptionsQuery.isError,
    isBindingLoading: targetOptions.isBindingLoading,
    isEnvironmentError: targetOptions.deployableEnvironmentsQuery.isError,
    isEnvironmentLoading: targetOptions.isEnvironmentLoading,
    isInitialReleaseReady,
    isSourceReady,
    requiredBindingsReady,
    requiredEnvVarsReady,
    selectedEnvironmentId: targetOptions.selectedEnvironment?.id,
    shouldLoadDeploymentTarget: targetOptions.shouldLoadDeploymentTarget,
    step,
  })
  const canSkipDeployment = canSkipDeploymentGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: targetOptions.deploymentOptionsQuery.isError,
    isInitialReleaseReady,
    step,
  })
  const {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  } = useCreateDeploymentSubmission({
    bindingSelections: targetOptions.bindingSelections,
    bindingSlots: targetOptions.bindingSlots,
    deploymentOptionsDslDigest: targetOptions.deploymentOptions?.dslDigest,
    dslContent: dslFileReader.dslContent,
    effectiveEnvVarValues: targetOptions.effectiveEnvVarValues,
    effectiveSelectedApp: source.effectiveSelectedApp,
    encodedDslContent,
    envVarSlots: targetOptions.envVarSlots,
    hasDslContent,
    hasInstanceNameConflict,
    instanceDescription: releaseFields.instanceDescription,
    isInitialReleaseReady,
    method,
    refetchDeployableEnvironments: targetOptions.deployableEnvironmentsQuery.refetch,
    selectedEnvironment: targetOptions.selectedEnvironment,
    selectedEnvironmentId: targetOptions.selectedEnvironmentId,
    setSubmissionUnsupportedDslNodes,
    submittedInstanceName: releaseFields.submittedInstanceName,
    submittedReleaseDescription: releaseFields.submittedReleaseDescription,
    submittedReleaseName: releaseFields.submittedReleaseName,
  })

  function clearUnsupportedDslNodes() {
    clearSubmissionUnsupportedDslNodes()
    targetOptions.clearUnsupportedDslNodes()
  }

  function selectMethod(nextMethod: GuideMethod) {
    clearUnsupportedDslNodes()
    setMethod(nextMethod)
    targetOptions.resetTargetOptions()
  }

  function handleDslFileChange(file?: File) {
    clearUnsupportedDslNodes()
    dslFileReader.selectDslFile(file)
    targetOptions.resetTargetOptions()
  }

  function handleSelectMethod(nextMethod: GuideMethod) {
    selectMethod(nextMethod)
    setStep('source')
  }

  function handleSelectSourceApp(app: App) {
    if (!isWorkflowApp(app))
      return
    clearUnsupportedDslNodes()
    source.setSelectedApp(app)
  }

  function handleBack() {
    if (isDeploying)
      return
    if (step === 'release')
      setStep('source')
    else if (step === 'target')
      setStep('release')
  }

  async function createReleaseArtifactsAndContinue() {
    if (method === 'bindApp' && (!source.effectiveSelectedApp?.id || !isWorkflowApp(source.effectiveSelectedApp) || isDeploying))
      return
    if (method === 'importDsl' && (!hasDslContent || dslFileReader.isReadingDsl || dslFileReader.dslReadError || dslUnsupportedMode || isDeploying))
      return

    targetOptions.resetTargetOptions()
    setStep('target')
  }

  async function handleDeploy() {
    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  function handlePrimaryAction() {
    if (!canContinue)
      return

    if (step === 'source') {
      if (method === 'bindApp' && source.effectiveSelectedApp)
        source.setSelectedApp(source.effectiveSelectedApp)
      releaseFields.applyReleaseDefaults()
      setStep('release')
      return
    }
    if (step === 'release') {
      if (method === 'bindApp' && source.effectiveSelectedApp)
        source.setSelectedApp(source.effectiveSelectedApp)
      void createReleaseArtifactsAndContinue()
      return
    }
    if (step === 'target') {
      void handleDeploy()
    }
  }

  return {
    canContinue,
    canSkipDeployment,
    creationSectionsProps: createCreationSectionsProps({
      defaultedReleaseName,
      dslFileReader,
      dslUnsupportedMode,
      instanceNameError,
      method,
      onDslFileChange: handleDslFileChange,
      onSelectMethod: handleSelectMethod,
      onSelectSourceApp: handleSelectSourceApp,
      releaseFields,
      source,
      sourceName,
      step,
      unsupportedDslNodes,
    }),
    handleBack,
    handlePrimaryAction,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment: isSkippingReleaseOnly,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps: createTargetReviewSectionsProps({
      targetOptions,
      unsupportedDslNodes,
    }),
  }
}
