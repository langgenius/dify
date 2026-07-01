'use client'

import type { EnvVarBindingSlot, EnvVarValueSelection } from '@/features/deployments/shared/components/env-var-bindings'
import { atom } from 'jotai'
import { envVarBindingSlotFromContract, envVarBindingValueType } from '@/features/deployments/shared/components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '@/features/deployments/shared/components/runtime-credential-bindings-utils'
import { dslEnvVarSlots } from '@/features/deployments/shared/domain/dsl'
import { environmentMatchesIdentifier } from './environment'
import { effectiveMethodAtom, envVarValuesAtom, manualBindingSelectionsAtom, selectedEnvironmentIdAtom } from './primitives'
import { deployableEnvironmentsQueryAtom, deploymentOptionsQueryAtom, deploymentOptionsReadyAtom } from './queries'
import { submittedReleaseReadyAtom } from './release'
import { dslContentAtom, sourceReady } from './source'
import { envVarSelectionReady } from './utils'

export const deployableEnvironmentsAtom = atom((get) => {
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return sourceReady(get)
    ? deployableEnvironmentsQuery.data?.environments ?? []
    : []
})

const deployableEnvironmentsReadyAtom = atom((get) => {
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)

  return sourceReady(get) && deployableEnvironmentsQuery.isSuccess
})

export const effectiveSelectedEnvironmentIdAtom = atom((get) => {
  return get(selectedEnvironmentIdAtom) || get(deployableEnvironmentsAtom)[0]?.id
})

export const deploymentTargetBindingSlotsAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return sourceReady(get)
    ? deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
})

export const deploymentTargetBindingSelectionsAtom = atom((get) => {
  return selectedRuntimeCredentialSelections(
    get(deploymentTargetBindingSlotsAtom),
    get(manualBindingSelectionsAtom),
  )
})

export const requiredBindingsReadyAtom = atom((get) => {
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)

  return get(deploymentTargetBindingSlotsAtom).every(slot =>
    !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]),
  )
})

export const deploymentTargetEnvVarSlotsAtom = atom((get) => {
  const method = get(effectiveMethodAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)
  const slots = sourceReady(get) ? deploymentOptionsQuery.data?.options?.envVarSlots : undefined
  const dslContent = get(dslContentAtom)

  // Deployment options own the canonical slot list; DSL metadata only enriches import-DSL defaults.
  const deploymentOptionEnvVarSlots = slots?.flatMap((slot): EnvVarBindingSlot[] => {
    const bindingSlot = envVarBindingSlotFromContract(slot)
    return bindingSlot ? [bindingSlot] : []
  }) ?? []
  const dslEnvVarMetadataSlots = method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot) => {
        const key = slot.key.trim()
        if (!key)
          return []

        return [{
          key,
          ...(slot.description ? { description: slot.description } : {}),
          ...(slot.defaultValue !== undefined ? { defaultValue: slot.defaultValue, hasDefaultValue: true } : {}),
          ...(slot.valueType ? { valueType: envVarBindingValueType(slot.valueType) } : {}),
        }]
      })
    : []

  if (dslEnvVarMetadataSlots.length === 0)
    return deploymentOptionEnvVarSlots

  const metadataByKey = new Map(
    dslEnvVarMetadataSlots.map(slot => [slot.key, slot] as const),
  )

  return deploymentOptionEnvVarSlots.map((slot) => {
    const metadata = metadataByKey.get(slot.key)
    if (!metadata)
      return slot

    const nextSlot = { ...slot }

    if (!nextSlot.description && metadata.description)
      nextSlot.description = metadata.description
    if (!nextSlot.hasDefaultValue && metadata.defaultValue !== undefined) {
      nextSlot.defaultValue = metadata.defaultValue
      nextSlot.hasDefaultValue = true
    }
    if (nextSlot.valueType === 'string' && metadata.valueType)
      nextSlot.valueType = metadata.valueType

    return nextSlot
  })
})

export const requiredEnvVarsReadyAtom = atom((get) => {
  const envVarValues = get(envVarValuesAtom)

  return get(deploymentTargetEnvVarSlotsAtom).every(slot =>
    envVarSelectionReady(slot, envVarValues[slot.key]),
  )
})

export const canDeployAtom = atom((get) => {
  const effectiveSelectedEnvironmentId = get(effectiveSelectedEnvironmentIdAtom)
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined

  return Boolean(
    selectedEnvironment?.id
    && get(deployableEnvironmentsReadyAtom)
    && get(deploymentOptionsReadyAtom)
    && get(requiredBindingsReadyAtom)
    && get(requiredEnvVarsReadyAtom)
    && get(submittedReleaseReadyAtom),
  )
})

export const canSkipDeploymentAtom = atom((get) => {
  return get(submittedReleaseReadyAtom) && get(deploymentOptionsReadyAtom)
})

export const selectBindingAtom = atom(null, (get, set, slot: string, value: string) => {
  set(manualBindingSelectionsAtom, {
    ...get(manualBindingSelectionsAtom),
    [slot]: value,
  })
})

export const setEnvVarAtom = atom(null, (get, set, key: string, value: EnvVarValueSelection) => {
  set(envVarValuesAtom, {
    ...get(envVarValuesAtom),
    [key]: value,
  })
})
