'use client'

import { atom } from 'jotai'
import {
  dslReadErrorAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import { dslUnsupportedModeAtom } from './dsl-derived-atoms'
import {
  existingInstanceNamesAtom,
  instanceNameConflictQueryAtom,
} from './query-atoms'
import {
  instanceNameAtom,
  releaseNameAtom,
} from './release-atoms'
import { selectedAppAtom } from './source-atoms'
import { unsupportedDslNodesAtom } from './unsupported-dsl-derived-atoms'
import { methodAtom } from './workflow-atoms'

export const hasInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return Boolean(
    submittedInstanceName
    && (
      get(existingInstanceNamesAtom).includes(submittedInstanceName)
      || (instanceNameConflictQuery.data?.data.some(appInstance => appInstance.name.trim() === submittedInstanceName) ?? false)
    ),
  )
})

export const submittedReleaseReadyAtom = atom((get) => {
  const method = get(methodAtom)
  const sourceReady = method === 'importDsl'
    ? get(hasDslContentAtom) && !get(isReadingDslAtom) && !get(dslReadErrorAtom) && !get(dslUnsupportedModeAtom)
    : Boolean(get(selectedAppAtom)?.id)
  const submittedInstanceName = get(instanceNameAtom).trim()
  const submittedReleaseName = get(releaseNameAtom).trim()

  return Boolean(sourceReady && submittedInstanceName && submittedReleaseName)
})

export const releaseCanGoNextAtom = atom((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()
  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return get(submittedReleaseReadyAtom)
    && !get(hasInstanceNameConflictAtom)
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && get(unsupportedDslNodesAtom).length === 0
})
