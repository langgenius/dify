'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { atom } from 'jotai'
import { loadable } from 'jotai/utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import {
  deploymentTargetEnvVarSlots,
  deploymentTargetRequiredEnvVarsReady,
} from './deployment-target-env-vars'
import {
  deploymentTargetQueryEnabledAtom,
} from './deployment-target-query-atoms'
import {
  dslContentAtom,
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import {
  deployableEnvironmentsQueryAtom,
  deploymentOptionsQueryAtom,
  existingInstanceNamesAtom,
  instanceNameConflictQueryAtom,
  remoteInstanceNameConflictAtom,
  sourceAppsAtom,
} from './query-atoms'
import { submittedReleaseFieldsAtom } from './release-atoms'
import { selectedAppAtom } from './source-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from './target-atoms'
import {
  submissionUnsupportedDslNodesAtom,
} from './unsupported-dsl-atoms'
import { methodAtom } from './workflow-atoms'

const deploymentOptionsUnsupportedDslNodesAsyncAtom = atom(async (get): Promise<UnsupportedDslNode[]> => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  if (!enabled || !deploymentOptionsQuery.isError)
    return []

  return (await unsupportedDslNodeError(deploymentOptionsQuery.error))?.nodes ?? []
})

const deploymentOptionsUnsupportedDslNodesLoadableAtom = loadable(deploymentOptionsUnsupportedDslNodesAsyncAtom)

export const unsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  const deploymentOptionsUnsupportedDslNodes = get(deploymentOptionsUnsupportedDslNodesLoadableAtom)

  return deploymentOptionsUnsupportedDslNodes.state === 'hasData'
    ? deploymentOptionsUnsupportedDslNodes.data
    : []
})

export const effectiveSelectedAppAtom = atom((get) => {
  return get(selectedAppAtom) ?? get(sourceAppsAtom)[0]
})

export const sourceReadyAtom = atom((get) => {
  const method = get(methodAtom)

  return method === 'importDsl'
    ? get(hasDslContentAtom) && !get(isReadingDslAtom) && !get(dslReadErrorAtom) && !get(dslUnsupportedModeAtom)
    : Boolean(get(selectedAppAtom)?.id)
})

export const sourceCanGoNextAtom = atom((get) => {
  const method = get(methodAtom)
  const importDslReady = method === 'importDsl'
    && get(hasDslContentAtom)
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !get(dslUnsupportedModeAtom)
  const bindAppReady = method === 'bindApp' && Boolean(get(effectiveSelectedAppAtom)?.id)

  return (importDslReady || bindAppReady) && get(unsupportedDslNodesAtom).length === 0
})

export const hasInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(submittedReleaseFieldsAtom).submittedInstanceName

  return Boolean(
    submittedInstanceName
    && (
      get(existingInstanceNamesAtom).includes(submittedInstanceName)
      || get(remoteInstanceNameConflictAtom)
    ),
  )
})

export const submittedReleaseReadyAtom = atom((get) => {
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = get(submittedReleaseFieldsAtom)

  return Boolean(get(sourceReadyAtom) && submittedInstanceName && submittedReleaseName)
})

export const releaseCanGoNextAtom = atom((get) => {
  const submittedInstanceName = get(submittedReleaseFieldsAtom).submittedInstanceName
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return get(submittedReleaseReadyAtom)
    && !get(hasInstanceNameConflictAtom)
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && get(unsupportedDslNodesAtom).length === 0
})

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

export const selectedDeploymentEnvironmentAtom = atom((get) => {
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

export const deploymentTargetRequiredBindingsReadyAtom = atom((get) => {
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

export const deploymentTargetRequiredEnvVarsReadyAtom = atom((get) => {
  return deploymentTargetRequiredEnvVarsReady(
    get(deploymentTargetEnvVarSlotsAtom),
    get(envVarValuesAtom),
  )
})

export const deploymentTargetReadyAtom = atom((get) => {
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
