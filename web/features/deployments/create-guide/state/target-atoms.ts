'use client'

import type { EnvVarValues, EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import { atom } from 'jotai'

export const selectedEnvironmentIdAtom = atom('')
export const manualBindingSelectionsAtom = atom<RuntimeCredentialBindingSelections>({})
export const envVarValuesAtom = atom<EnvVarValues>({})

export const resetDeploymentTargetOptionsAtom = atom(null, (_get, set) => {
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
})

export const selectEnvironmentAtom = atom(null, (_get, set, selectedEnvironmentId: string) => {
  set(selectedEnvironmentIdAtom, selectedEnvironmentId)
})

export const selectBindingAtom = atom(null, (get, set, {
  slot,
  value,
}: {
  slot: string
  value: string
}) => {
  set(manualBindingSelectionsAtom, {
    ...get(manualBindingSelectionsAtom),
    [slot]: value,
  })
})

export const setEnvVarAtom = atom(null, (get, set, {
  key,
  value,
}: {
  key: string
  value: EnvVarValueSelection
}) => {
  set(envVarValuesAtom, {
    ...get(envVarValuesAtom),
    [key]: value,
  })
})
