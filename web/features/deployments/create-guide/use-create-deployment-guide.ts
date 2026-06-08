'use client'

import type { UnsupportedDslNode } from '../error'
import type {
  GuideMethod,
  GuideStep,
} from './types'
import type { App } from '@/types/app'
import { useState } from 'react'
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
  isWorkflowDsl,
} from '../dsl'
import { useDslFileReader } from '../use-dsl-file-reader'
import {
  canContinueGuideStep,
  canSkipDeploymentGuideStep,
} from './guide-readiness'
import { useCreateDeploymentSubmission } from './use-create-deployment-submission'
import { useDeploymentGuideReleaseFields } from './use-deployment-guide-release-fields'
import { useDeploymentGuideSource } from './use-deployment-guide-source'
import { useDeploymentTargetOptions } from './use-deployment-target-options'

export function useCreateDeploymentGuide() {
  const { t } = useTranslation('deployments')

  const [step, setStep] = useState<GuideStep>('source')
  const [method, setMethod] = useState<GuideMethod>('bindApp')
  const [submissionUnsupportedDslNodes, setSubmissionUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])
  const {
    effectiveSelectedApp,
    existingInstanceNames,
    setSelectedApp,
    setSourceSearchText,
    sourceApps,
    sourceAppsLoading,
    sourceSearchText,
  } = useDeploymentGuideSource()
  const {
    dslContent,
    dslFile,
    dslReadError,
    isReadingDsl,
    selectDslFile,
  } = useDslFileReader()

  const hasDslContent = Boolean(dslContent.trim())
  const dslUnsupportedMode = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !isWorkflowDsl(dslContent)
  const encodedDslContent = hasDslContent ? encodeDslContent(dslContent) : ''
  const shouldResolveDeploymentTarget = step === 'target'
  const {
    bindingSelections,
    bindingSlots,
    clearUnsupportedDslNodes: clearDeploymentOptionsUnsupportedDslNodes,
    deployableEnvironmentsQuery,
    deploymentOptions,
    deploymentOptionsQuery,
    effectiveEnvVarValues,
    effectiveSelectedEnvironmentId,
    environments,
    envVarSlots,
    envVarValues: targetEnvVarValues,
    isBindingLoading,
    isEnvironmentLoading,
    onSelectBinding,
    onSelectEnvironment,
    onSetEnvVar,
    resetTargetOptions,
    selectedEnvironment,
    selectedEnvironmentId,
    shouldLoadDeploymentTarget,
    unsupportedDslNodes: deploymentOptionsUnsupportedDslNodes,
  } = useDeploymentTargetOptions({
    dslContent,
    dslReadError,
    dslUnsupportedMode,
    effectiveSelectedApp,
    encodedDslContent,
    hasDslContent,
    isReadingDsl,
    method,
    shouldResolveDeploymentTarget,
  })
  const unsupportedDslNodes = submissionUnsupportedDslNodes.length > 0
    ? submissionUnsupportedDslNodes
    : deploymentOptionsQuery.isError ? deploymentOptionsUnsupportedDslNodes : []
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
  const requiredEnvVarsReady = envVarSlots.every(slot => !hasMissingRequiredEnvVarValue(slot, effectiveEnvVarValues))
  const dslDefaultAppName = dslContent ? dslAppName(dslContent) : ''
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : method === 'bindApp'
      ? effectiveSelectedApp?.name ?? ''
      : ''
  const defaultedReleaseName = t('createGuide.release.defaultName')
  const {
    applyReleaseDefaults,
    handleInstanceDescriptionChange,
    handleInstanceNameChange,
    handleReleaseDescriptionChange,
    handleReleaseNameChange,
    instanceDescription,
    instanceName,
    releaseDescription,
    releaseName,
    submittedInstanceName,
    submittedReleaseDescription,
    submittedReleaseName,
  } = useDeploymentGuideReleaseFields({
    defaultedReleaseName,
    existingInstanceNames,
    onFieldChange: () => setStep('release'),
    sourceName,
  })
  const hasInstanceNameConflict = Boolean(submittedInstanceName && existingInstanceNames.includes(submittedInstanceName))
  const instanceNameError = hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
  const isSourceReady = Boolean(method && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode : effectiveSelectedApp?.id))
  const isInitialReleaseReady = Boolean(isSourceReady && submittedInstanceName && submittedReleaseName && !hasInstanceNameConflict)
  const showTargetConfiguration = Boolean(method && step === 'target')
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const canContinue = canContinueGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: deploymentOptionsQuery.isError,
    isBindingLoading,
    isEnvironmentError: deployableEnvironmentsQuery.isError,
    isEnvironmentLoading,
    isInitialReleaseReady,
    isSourceReady,
    requiredBindingsReady,
    requiredEnvVarsReady,
    selectedEnvironmentId: selectedEnvironment?.id,
    shouldLoadDeploymentTarget,
    step,
  })
  const canSkipDeployment = canSkipDeploymentGuideStep({
    hasUnsupportedDslNodes,
    isBindingError: deploymentOptionsQuery.isError,
    isInitialReleaseReady,
    step,
  })
  const {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  } = useCreateDeploymentSubmission({
    bindingSelections,
    bindingSlots,
    deploymentOptionsDslDigest: deploymentOptions?.dslDigest,
    dslContent,
    effectiveEnvVarValues,
    effectiveSelectedApp,
    encodedDslContent,
    envVarSlots,
    hasDslContent,
    hasInstanceNameConflict,
    instanceDescription,
    isInitialReleaseReady,
    method,
    refetchDeployableEnvironments: deployableEnvironmentsQuery.refetch,
    selectedEnvironment,
    selectedEnvironmentId,
    setSubmissionUnsupportedDslNodes,
    submittedInstanceName,
    submittedReleaseDescription,
    submittedReleaseName,
  })

  function clearUnsupportedDslNodes() {
    setSubmissionUnsupportedDslNodes([])
    clearDeploymentOptionsUnsupportedDslNodes()
  }

  function selectMethod(nextMethod: GuideMethod) {
    clearUnsupportedDslNodes()
    setMethod(nextMethod)
    resetTargetOptions()
  }

  function handleDslFileChange(file?: File) {
    clearUnsupportedDslNodes()
    selectDslFile(file)
    resetTargetOptions()
  }

  function handleSelectMethod(nextMethod: GuideMethod) {
    selectMethod(nextMethod)
    setStep('source')
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
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || !isWorkflowApp(effectiveSelectedApp) || isDeploying))
      return
    if (method === 'importDsl' && (!hasDslContent || isReadingDsl || dslReadError || dslUnsupportedMode || isDeploying))
      return

    resetTargetOptions()
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
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      applyReleaseDefaults()
      setStep('release')
      return
    }
    if (step === 'release') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
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
    creationSectionsProps: {
      defaultedReleaseName,
      dslFile,
      dslReadError,
      dslUnsupportedMode,
      instanceDescription,
      instanceName,
      instanceNameError,
      isReadingDsl,
      method,
      onDslFileChange: handleDslFileChange,
      onInstanceDescriptionChange: handleInstanceDescriptionChange,
      onInstanceNameChange: handleInstanceNameChange,
      onReleaseDescriptionChange: handleReleaseDescriptionChange,
      onReleaseNameChange: handleReleaseNameChange,
      onSearchTextChange: setSourceSearchText,
      onSelectMethod: handleSelectMethod,
      onSelectSourceApp: (app: App) => {
        if (!isWorkflowApp(app))
          return
        clearUnsupportedDslNodes()
        setSelectedApp(app)
      },
      releaseDescription,
      releaseName,
      selectedApp: effectiveSelectedApp,
      sourceApps,
      sourceAppsLoading,
      sourceName,
      sourceSearchText,
      stage: step === 'release' ? 'release' as const : 'source' as const,
      unsupportedDslNodes,
    },
    handleBack,
    handlePrimaryAction,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment: isSkippingReleaseOnly,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps: {
      bindingSelections,
      bindingSlots,
      environments,
      envVarSlots,
      envVarValues: targetEnvVarValues,
      isBindingError: deploymentOptionsQuery.isError,
      isBindingLoading,
      isEnvironmentError: deployableEnvironmentsQuery.isError,
      isEnvironmentLoading,
      onSelectBinding,
      onSelectEnvironment,
      onSetEnvVar,
      selectedEnvironmentId: effectiveSelectedEnvironmentId,
      unsupportedDslNodes,
    },
  }
}
