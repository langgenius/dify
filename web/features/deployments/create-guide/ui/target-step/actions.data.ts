'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetBindings } from '../../models/deployment-target/bindings'
import { createDeploymentTargetEnvVars } from '../../models/deployment-target/env-vars'
import { createDeploymentTargetEnvironment } from '../../models/deployment-target/environment'
import { useDeploymentTargetQueryGate } from '../../models/deployment-target/query-gate'
import { useSourceReady } from '../../models/source'
import { useDeployableEnvironmentsQuery } from '../../queries/target-environments'
import { useDeploymentOptionsQuery } from '../../queries/target-options'
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
import { useCreateDeploymentSubmission } from '../../submission'

function useDeploymentOptionsForTargetActions() {
  const {
    encodedDslContent,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useDeploymentTargetQueryGate()

  return useDeploymentOptionsQuery({
    encodedDslContent,
    effectiveSelectedApp,
    method,
    queryGate,
  })
}

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

function useTargetActionDraft() {
  const sourceReady = useSourceReady()
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const { method, queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetActions()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)
  const environments = queryGate.shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(sourceReady)

  return {
    deployableEnvironmentsQuery,
    deploymentOptions: deploymentOptionsResult.deploymentOptions,
    deploymentOptionsQuery: deploymentOptionsResult.deploymentOptionsQuery,
    envVarValues,
    queryGate,
    selectedApp,
    selectedEnvironmentId,
    submittedReleaseReady,
    targetBindings,
    targetEnvironment,
    targetEnvVars,
    unsupportedDslNodes,
  }
}

type TargetActionDraft = ReturnType<typeof useTargetActionDraft>

function targetCanDeploy(draft: TargetActionDraft) {
  const deploymentTargetReady = draft.queryGate.shouldLoadDeploymentTarget
    && !queryIsLoading(draft.deployableEnvironmentsQuery)
    && !draft.deployableEnvironmentsQuery.isError
    && !queryIsLoading(draft.deploymentOptionsQuery)
    && !draft.deploymentOptionsQuery.isError
    && draft.unsupportedDslNodes.length === 0

  return Boolean(
    draft.targetEnvironment.selectedEnvironment?.id
    && deploymentTargetReady
    && draft.targetBindings.requiredBindingsReady
    && draft.targetEnvVars.requiredEnvVarsReady
    && draft.submittedReleaseReady,
  )
}

function targetCanSkipDeployment(draft: TargetActionDraft) {
  return Boolean(
    draft.submittedReleaseReady
    && !draft.deploymentOptionsQuery.isError
    && draft.unsupportedDslNodes.length === 0,
  )
}

function useTargetDeploymentSubmission(draft: TargetActionDraft) {
  const { createDeploymentAndRelease } = useCreateDeploymentSubmission({
    effectiveSelectedApp: draft.selectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: draft.submittedReleaseReady,
    targetSubmissionState: {
      bindingSelections: draft.targetBindings.bindingSelections,
      bindingSlots: draft.targetBindings.bindingSlots,
      deployableEnvironmentsQuery: draft.deployableEnvironmentsQuery,
      deploymentOptions: draft.deploymentOptions,
      envVarSlots: draft.targetEnvVars.envVarSlots,
      envVarValues: draft.envVarValues,
      requiredEnvVarsReady: draft.targetEnvVars.requiredEnvVarsReady,
      selectedEnvironment: draft.targetEnvironment.selectedEnvironment,
      selectedEnvironmentId: draft.selectedEnvironmentId,
    },
  })

  return createDeploymentAndRelease
}

export function useTargetDeployDisabled() {
  return !targetCanDeploy(useTargetActionDraft())
}

export function useTargetSkipDeploymentDisabled() {
  return !targetCanSkipDeployment(useTargetActionDraft())
}

export function useTargetDeployAction() {
  const draft = useTargetActionDraft()
  const createDeploymentAndRelease = useTargetDeploymentSubmission(draft)

  async function handleDeploy() {
    if (!targetCanDeploy(draft))
      return

    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  return handleDeploy
}

export function useTargetSkipDeploymentAction() {
  const draft = useTargetActionDraft()
  const createDeploymentAndRelease = useTargetDeploymentSubmission(draft)

  async function handleSkipDeployment() {
    if (!targetCanSkipDeployment(draft))
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return handleSkipDeployment
}
