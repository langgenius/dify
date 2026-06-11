'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import { consoleQuery } from '@/service/client'
import {
  deploymentTargetEnvVarSlots,
  deploymentTargetRequiredEnvVarsReady,
} from '../../models/deployment-target/env-vars'
import {
  useCreateGuideDeploymentOptionsQuery,
} from '../../models/deployment-target/query-config'
import { deploymentTargetQueryEnabledAtom } from '../../state/deployment-target-query-atoms'
import {
  dslContentAtom,
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
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

export function useTargetCanDeploy() {
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const enabled = useAtomValue(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled,
  }))
  const environments = enabled
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
  const bindingSlots = enabled
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
  const envVarSlots = deploymentTargetEnvVarSlots({
    dslContent,
    method,
    slots: enabled ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined,
  })
  const sourceReady = method === 'importDsl'
    ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
    : Boolean(selectedApp?.id)
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const submittedReleaseReady = Boolean(sourceReady && submittedInstanceName && submittedReleaseName)
  const deploymentTargetReady = enabled
    && !(deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
    && !deployableEnvironmentsQuery.isError
    && !(deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
    && !deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0

  return Boolean(
    selectedEnvironment?.id
    && deploymentTargetReady
    && requiredBindingsReady
    && deploymentTargetRequiredEnvVarsReady(envVarSlots, envVarValues)
    && submittedReleaseReady,
  )
}

export function useTargetCanSkipDeployment() {
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const sourceReady = method === 'importDsl'
    ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
    : Boolean(selectedApp?.id)
  const submittedReleaseReady = Boolean(sourceReady && submittedInstanceName && submittedReleaseName)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()

  return Boolean(
    submittedReleaseReady
    && !deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0,
  )
}

export function useTargetDeploymentSubmissionAction() {
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const method = useAtomValue(methodAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const enabled = useAtomValue(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled,
  }))
  const environments = enabled
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
  const bindingSlots = enabled
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const envVarSlots = deploymentTargetEnvVarSlots({
    dslContent,
    method,
    slots: enabled ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined,
  })
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const sourceReady = method === 'importDsl'
    ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
    : Boolean(selectedApp?.id)
  const submittedReleaseReady = Boolean(sourceReady && submittedInstanceName && submittedReleaseName)
  const { createDeploymentAndRelease } = useCreateDeploymentSubmission({
    effectiveSelectedApp: selectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: submittedReleaseReady,
    targetSubmissionState: {
      bindingSelections,
      bindingSlots,
      deployableEnvironmentsQuery,
      deploymentOptions: deploymentOptionsQuery.data?.options,
      envVarSlots,
      envVarValues,
      requiredEnvVarsReady: deploymentTargetRequiredEnvVarsReady(envVarSlots, envVarValues),
      selectedEnvironment,
      selectedEnvironmentId,
    },
  })

  return createDeploymentAndRelease
}
