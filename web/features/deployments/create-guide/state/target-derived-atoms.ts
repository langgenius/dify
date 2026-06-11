'use client'

import { atom } from 'jotai'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import {
  deploymentTargetEnvVarSlots,
  deploymentTargetRequiredEnvVarsReady,
} from './deployment-target-env-vars'
import { deploymentTargetQueryEnabledAtom } from './deployment-target-gate-atoms'
import { dslContentAtom } from './dsl-atoms'
import {
  deployableEnvironmentsQueryAtom,
  deploymentOptionsQueryAtom,
} from './query-atoms'
import { submittedReleaseReadyAtom } from './release-derived-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from './target-atoms'
import { unsupportedDslNodesAtom } from './unsupported-dsl-derived-atoms'
import { methodAtom } from './workflow-atoms'

export const deployableEnvironmentsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return enabled
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
})

export const effectiveSelectedEnvironmentIdAtom = atom((get) => {
  return get(selectedEnvironmentIdAtom) || get(deployableEnvironmentsAtom)[0]?.id
})

const selectedDeploymentEnvironmentAtom = atom((get) => {
  const effectiveSelectedEnvironmentId = get(effectiveSelectedEnvironmentIdAtom)

  return effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
})

export const deploymentTargetBindingSlotsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return enabled
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
})

export const deploymentTargetBindingSelectionsAtom = atom((get) => {
  return selectedRuntimeCredentialSelections(
    get(deploymentTargetBindingSlotsAtom),
    get(manualBindingSelectionsAtom),
  )
})

const deploymentTargetRequiredBindingsReadyAtom = atom((get) => {
  const bindingSlots = get(deploymentTargetBindingSlotsAtom)
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)

  return bindingSlots.every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
})

export const deploymentTargetEnvVarSlotsAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return deploymentTargetEnvVarSlots({
    dslContent: get(dslContentAtom),
    method: get(methodAtom),
    slots: enabled ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined,
  })
})

const deploymentTargetRequiredEnvVarsReadyAtom = atom((get) => {
  return deploymentTargetRequiredEnvVarsReady(
    get(deploymentTargetEnvVarSlotsAtom),
    get(envVarValuesAtom),
  )
})

const deploymentTargetReadyAtom = atom((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return enabled
    && !(deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
    && !deployableEnvironmentsQuery.isError
    && !(deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
    && !deploymentOptionsQuery.isError
    && get(unsupportedDslNodesAtom).length === 0
})

export const canDeployAtom = atom((get) => {
  return Boolean(
    get(selectedDeploymentEnvironmentAtom)?.id
    && get(deploymentTargetReadyAtom)
    && get(deploymentTargetRequiredBindingsReadyAtom)
    && get(deploymentTargetRequiredEnvVarsReadyAtom)
    && get(submittedReleaseReadyAtom),
  )
})

export const canSkipDeploymentAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return Boolean(
    get(submittedReleaseReadyAtom)
    && !deploymentOptionsQuery.isError
    && get(unsupportedDslNodesAtom).length === 0,
  )
})

export const deploymentTargetSubmissionStateAtom = atom(get => ({
  bindingSelections: get(deploymentTargetBindingSelectionsAtom),
  bindingSlots: get(deploymentTargetBindingSlotsAtom),
  deployableEnvironmentsQuery: get(deployableEnvironmentsQueryAtom),
  deploymentOptions: get(deploymentOptionsQueryAtom).data?.options,
  envVarSlots: get(deploymentTargetEnvVarSlotsAtom),
  envVarValues: get(envVarValuesAtom),
  requiredEnvVarsReady: get(deploymentTargetRequiredEnvVarsReadyAtom),
  selectedEnvironment: get(selectedDeploymentEnvironmentAtom),
  selectedEnvironmentId: get(selectedEnvironmentIdAtom),
}))
