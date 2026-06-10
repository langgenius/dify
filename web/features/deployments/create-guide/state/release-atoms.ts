'use client'

import { atom } from 'jotai'
import { availableInstanceName } from '../models/instance-name'
import { stepAtom } from './workflow-atoms'

export type CreateGuideSubmittedReleaseFields = {
  submittedInstanceName: string
  submittedReleaseDescription: string
  submittedReleaseName: string
}

export const instanceNameAtom = atom('')
export const instanceDescriptionAtom = atom('')
export const releaseNameAtom = atom('')
export const releaseDescriptionAtom = atom('')

export const releaseLocalAtoms = [
  instanceNameAtom,
  instanceDescriptionAtom,
  releaseNameAtom,
  releaseDescriptionAtom,
] as const

export const submittedReleaseFieldsAtom = atom((get): CreateGuideSubmittedReleaseFields => ({
  submittedInstanceName: get(instanceNameAtom).trim(),
  submittedReleaseDescription: get(releaseDescriptionAtom).trim(),
  submittedReleaseName: get(releaseNameAtom).trim(),
}))

export const setInstanceNameAtom = atom(null, (_get, set, instanceName: string) => {
  set(instanceNameAtom, instanceName)
  set(stepAtom, 'release')
})

export const setInstanceDescriptionAtom = atom(null, (_get, set, instanceDescription: string) => {
  set(instanceDescriptionAtom, instanceDescription)
  set(stepAtom, 'release')
})

export const setReleaseNameAtom = atom(null, (_get, set, releaseName: string) => {
  set(releaseNameAtom, releaseName)
  set(stepAtom, 'release')
})

export const setReleaseDescriptionAtom = atom(null, (_get, set, releaseDescription: string) => {
  set(releaseDescriptionAtom, releaseDescription)
  set(stepAtom, 'release')
})

export const applyReleaseDefaultsAtom = atom(null, (get, set, {
  defaultReleaseName,
  existingNames,
  sourceName,
}: {
  defaultReleaseName: string
  existingNames: readonly string[]
  sourceName: string | undefined
}) => {
  const nextInstanceName = sourceName?.trim()

  if (!get(instanceNameAtom).trim() && nextInstanceName)
    set(instanceNameAtom, availableInstanceName(nextInstanceName, existingNames))
  if (!get(releaseNameAtom).trim())
    set(releaseNameAtom, defaultReleaseName)
})
