'use client'

import { atom } from 'jotai'
import { dslDefaultAppNameAtom } from './dsl-atoms'
import { existingInstanceNamesAtom } from './query-atoms'
import {
  instanceNameAtom,
  releaseNameAtom,
} from './release-atoms'
import {
  effectiveSelectedAppAtom,
  sourceCanGoNextAtom,
} from './source-derived-atoms'
import { selectSourceAppAtom } from './source-selection-action-atoms'
import {
  methodAtom,
  stepAtom,
} from './workflow-atoms'

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

export const continueFromSourceAtom = atom(null, (get, set, {
  defaultDslAppName,
  defaultReleaseName,
}: {
  defaultDslAppName: string
  defaultReleaseName: string
}) => {
  if (!get(sourceCanGoNextAtom))
    return

  const method = get(methodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  if (method === 'bindApp' && effectiveSelectedApp)
    set(selectSourceAppAtom, effectiveSelectedApp)

  const sourceName = method === 'importDsl'
    ? get(dslDefaultAppNameAtom) || defaultDslAppName
    : effectiveSelectedApp?.name
  const nextInstanceName = sourceName?.trim()

  if (!get(instanceNameAtom).trim() && nextInstanceName)
    set(instanceNameAtom, availableInstanceName(nextInstanceName, get(existingInstanceNamesAtom)))
  if (!get(releaseNameAtom).trim())
    set(releaseNameAtom, defaultReleaseName)
  set(stepAtom, 'release')
})
