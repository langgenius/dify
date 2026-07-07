'use client'

import { atom } from 'jotai'
import {
  autoFilledInstanceNameAtom,
  autoFilledReleaseNameAtom,
  envVarValuesAtom,
  instanceDescriptionAtom,
  instanceNameAtom,
  manualBindingSelectionsAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
  selectedEnvironmentIdAtom,
  stepAtom,
} from './primitives'
import { deploymentOptionsContentCheckedAtom, existingInstanceNamesQueryAtom, instanceNameConflictQueryAtom } from './queries'
import { sourceReady } from './source'

export const hasInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)
  const existingInstanceNamesQuery = get(existingInstanceNamesQueryAtom)
  const existingInstanceNames = existingInstanceNamesQuery.data?.pages.flatMap(page =>
    page.appInstances.flatMap((appInstance) => {
      const name = appInstance.displayName.trim()

      return name ? [name] : []
    }),
  ) ?? []

  return Boolean(
    submittedInstanceName
    && (
      existingInstanceNames.includes(submittedInstanceName)
      || (instanceNameConflictQuery.data?.appInstances.some(appInstance => appInstance.displayName.trim() === submittedInstanceName) ?? false)
    ),
  )
})

export const submittedReleaseReadyAtom = atom((get) => {
  return Boolean(sourceReady(get) && get(instanceNameAtom).trim() && get(releaseNameAtom).trim())
})

export const releaseCanGoNextAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return Boolean(get(submittedReleaseReadyAtom))
    && !get(hasInstanceNameConflictAtom)
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && get(deploymentOptionsContentCheckedAtom)
})

export const setInstanceNameAtom = atom(null, (_get, set, value: string) => {
  set(instanceNameAtom, value)
  set(autoFilledInstanceNameAtom, '')
  set(stepAtom, 'release')
})

export const setInstanceDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(instanceDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseNameAtom = atom(null, (_get, set, value: string) => {
  set(releaseNameAtom, value)
  set(autoFilledReleaseNameAtom, '')
  set(stepAtom, 'release')
})

export const setReleaseDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(releaseDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const continueFromReleaseAtom = atom(null, (get, set) => {
  if (!get(releaseCanGoNextAtom))
    return

  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(stepAtom, 'target')
})
