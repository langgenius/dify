'use client'

import type { GuideMethod, GuideStep, WorkflowSourceApp } from './types'
import type { EnvVarValues } from '@/features/deployments/shared/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/shared/components/runtime-credential-bindings-utils'
import type { UnsupportedDslNode } from '@/features/deployments/shared/domain/error'
import { atom } from 'jotai'
import { deploymentGuideMethod } from './utils'

export const stepAtom = atom<GuideStep>('source')
export const methodAtom = atom<GuideMethod>('bindApp')
export const effectiveMethodAtom = atom((get) => deploymentGuideMethod(get(methodAtom)))

export const sourceSearchTextAtom = atom('')
export const selectedAppAtom = atom<WorkflowSourceApp | undefined>(undefined)

export const dslFileAtom = atom<File | undefined>(undefined)
export const dslFileReadVersionAtom = atom(0)

export const instanceNameAtom = atom('')
export const instanceDescriptionAtom = atom('')
export const releaseNameAtom = atom('')
export const releaseDescriptionAtom = atom('')
export const autoFilledInstanceNameAtom = atom('')
export const autoFilledReleaseNameAtom = atom('')

export const selectedEnvironmentIdAtom = atom('')
export const manualBindingSelectionsAtom = atom<RuntimeCredentialBindingSelections>({})
export const envVarValuesAtom = atom<EnvVarValues>({})

export const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])
export const isCreatingDeploymentAtom = atom(false)
export const isCreatingReleaseOnlyAtom = atom(false)

export const isSubmittingDeploymentGuideAtom = atom(
  (get) => get(isCreatingDeploymentAtom) || get(isCreatingReleaseOnlyAtom),
)
