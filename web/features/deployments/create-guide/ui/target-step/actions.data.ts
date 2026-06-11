'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetBindings } from '../../models/deployment-target/bindings'
import { createDeploymentTargetEnvVars } from '../../models/deployment-target/env-vars'
import { createDeploymentTargetEnvironment } from '../../models/deployment-target/environment'
import {
  useCreateGuideDeployableEnvironmentsQuery,
  useCreateGuideDeploymentOptionsQuery,
  useCreateGuideDeploymentTargetEnabled,
} from '../../models/deployment-target/query-config'
import { useCreateGuideSourceReady } from '../../models/source-readiness'
import { dslContentAtom } from '../../state/dsl-atoms'
import { submittedReleaseFieldsAtom } from '../../state/release-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import { methodAtom } from '../../state/workflow-atoms'
import { useCreateDeploymentSubmission } from '../../submission'

function useTargetSubmittedReleaseReady(sourceReady: boolean) {
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)

  return Boolean(
    sourceReady
    && submittedInstanceName
    && submittedReleaseName,
  )
}

type QueryFetchState = {
  data: unknown
  isError: boolean
  isFetching: boolean
  isLoading: boolean
}

function queryIsLoading(query: QueryFetchState) {
  return query.isLoading || (query.isFetching && !query.data)
}

function useTargetDeployReady() {
  const sourceReady = useCreateGuideSourceReady()
  const dslContent = useAtomValue(dslContentAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const method = useAtomValue(methodAtom)
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const deployableEnvironmentsQuery = useCreateGuideDeployableEnvironmentsQuery()
  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsQuery.data?.options?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget,
    slots: deploymentOptionsQuery.data?.options?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(sourceReady)
  const deploymentTargetReady = shouldLoadDeploymentTarget
    && !queryIsLoading(deployableEnvironmentsQuery)
    && !deployableEnvironmentsQuery.isError
    && !queryIsLoading(deploymentOptionsQuery)
    && !deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0

  return Boolean(
    targetEnvironment.selectedEnvironment?.id
    && deploymentTargetReady
    && targetBindings.requiredBindingsReady
    && targetEnvVars.requiredEnvVarsReady
    && submittedReleaseReady,
  )
}

function useTargetSkipDeploymentReady() {
  const sourceReady = useCreateGuideSourceReady()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const submittedReleaseReady = useTargetSubmittedReleaseReady(sourceReady)

  return Boolean(
    submittedReleaseReady
    && !deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0,
  )
}

function useTargetDeploymentSubmissionAction() {
  const sourceReady = useCreateGuideSourceReady()
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const method = useAtomValue(methodAtom)
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const deployableEnvironmentsQuery = useCreateGuideDeployableEnvironmentsQuery()
  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsQuery.data?.options?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget,
    slots: deploymentOptionsQuery.data?.options?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(sourceReady)
  const { createDeploymentAndRelease } = useCreateDeploymentSubmission({
    effectiveSelectedApp: selectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: submittedReleaseReady,
    targetSubmissionState: {
      bindingSelections: targetBindings.bindingSelections,
      bindingSlots: targetBindings.bindingSlots,
      deployableEnvironmentsQuery,
      deploymentOptions: deploymentOptionsQuery.data?.options,
      envVarSlots: targetEnvVars.envVarSlots,
      envVarValues,
      requiredEnvVarsReady: targetEnvVars.requiredEnvVarsReady,
      selectedEnvironment: targetEnvironment.selectedEnvironment,
      selectedEnvironmentId,
    },
  })

  return createDeploymentAndRelease
}

export function useTargetDeployDisabled() {
  return !useTargetDeployReady()
}

export function useTargetSkipDeploymentDisabled() {
  return !useTargetSkipDeploymentReady()
}

export function useTargetDeployAction() {
  const deployReady = useTargetDeployReady()
  const createDeploymentAndRelease = useTargetDeploymentSubmissionAction()

  async function handleDeploy() {
    if (!deployReady)
      return

    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  return handleDeploy
}

export function useTargetSkipDeploymentAction() {
  const skipDeploymentReady = useTargetSkipDeploymentReady()
  const createDeploymentAndRelease = useTargetDeploymentSubmissionAction()

  async function handleSkipDeployment() {
    if (!skipDeploymentReady)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return handleSkipDeployment
}
