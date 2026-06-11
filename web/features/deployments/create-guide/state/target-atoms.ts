'use client'

import type { EnvVarValues } from '@/features/deployments/components/env-var-bindings'
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
