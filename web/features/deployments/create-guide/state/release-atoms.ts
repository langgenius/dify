'use client'

import { atom } from 'jotai'
import { stepAtom } from './workflow-atoms'

const RANDOM_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_SUFFIX_LENGTH = 4
const RANDOM_SUFFIX_FALLBACK_LENGTH = 6
const RANDOM_SUFFIX_MAX_ATTEMPTS = 16

function randomLetterCombination(length: number) {
  const randomValues = new Uint8Array(length)

  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(randomValues)
  }
  else {
    randomValues.forEach((_, index) => {
      randomValues[index] = Math.floor(Math.random() * 256)
    })
  }

  return Array.from(randomValues, value => RANDOM_SUFFIX_ALPHABET[value % RANDOM_SUFFIX_ALPHABET.length]).join('')
}

function availableInstanceName(baseName: string, existingNames: readonly string[]) {
  const existingNameSet = new Set(existingNames)
  if (!existingNameSet.has(baseName))
    return baseName

  for (let attempt = 0; attempt < RANDOM_SUFFIX_MAX_ATTEMPTS; attempt++) {
    const candidate = `${baseName}-${randomLetterCombination(RANDOM_SUFFIX_LENGTH)}`
    if (!existingNameSet.has(candidate))
      return candidate
  }

  return `${baseName}-${randomLetterCombination(RANDOM_SUFFIX_FALLBACK_LENGTH)}`
}

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
